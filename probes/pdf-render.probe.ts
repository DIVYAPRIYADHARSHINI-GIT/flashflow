// PDF rendering probe.
//
// Checking extracted text is NOT enough: a PDF can carry perfect text while rendering with
// missing glyphs. That is exactly what happened here - `embedFont(..., { subset: true })`
// produced a PDF whose text layer read "What does len() return?" but whose pixels read
// "h  es  e  re ur". This probe rasterises the real PDF in Chromium's PDF viewer and
// measures the ink, so a dropped-glyph regression fails the build.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCardSheetPdf, buildDeckListPdf } from '#lib/server/pdf';

let browser: Browser;

const SAMPLE_NOTES = [
	{
		front: 'What does len() return?',
		back: 'The number of items in a sequence.',
		extra: 'Works on strings, lists and dicts.',
		deck: 'Basic Python',
		tags: ['builtins']
	},
	{ front: 'Which keyword defines a function?', back: 'def', deck: 'Basic Python', tags: ['syntax'] },
	{
		front: 'What is the difference between == and is?',
		back: '== compares values, is compares identity.',
		deck: 'Basic Python',
		tags: ['operators']
	},
	{ front: 'What does range(3) produce?', back: '0, 1, 2', deck: 'Basic Python' },
	{ front: 'How do you add an item to a list?', back: 'items.append(value)', deck: 'Basic Python' }
];

/**
 * Rasterise page 1 of a PDF with pdf.js inside a real browser and return the ratio of
 * near-black pixels. Dropped glyphs show up directly as missing ink, which is the only
 * way to catch the subsetting bug that text extraction happily hides.
 *
 * pdf.js is loaded from the local node_modules build, so this needs no network access.
 */
async function inkRatio(bytes: Uint8Array): Promise<number> {
	const context = await browser.newContext({ viewport: { width: 1000, height: 1200 } });
	const page = await context.newPage();
	page.setDefaultTimeout(30_000);
	await page.goto('about:blank');

	const pdfJsPath = fileURLToPath(
		new URL('../node_modules/pdfjs-dist/build/pdf.min.mjs', import.meta.url)
	);
	const workerPath = fileURLToPath(
		new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)
	);
	const pdfJs = readFileSync(pdfJsPath, 'utf8');
	const workerSrc = readFileSync(workerPath, 'utf8');

	// Load pdf.js as a real module script. This is done with addScriptTag rather than a
	// dynamic import inside evaluate(), because Vite rewrites `import()` in probe source
	// into its SSR helper, which does not exist in the browser.
	await page.addScriptTag({
		content: `
			const libUrl = URL.createObjectURL(new Blob([${JSON.stringify(pdfJs)}], { type: 'text/javascript' }));
			const workerUrl = URL.createObjectURL(new Blob([${JSON.stringify(workerSrc)}], { type: 'text/javascript' }));
			import(libUrl).then((m) => {
				m.GlobalWorkerOptions.workerSrc = workerUrl;
				window.__pdfjs = m;
			});
		`,
		type: 'module'
	});
	await page.waitForFunction(() => Boolean((window as unknown as { __pdfjs?: unknown }).__pdfjs), {
		timeout: 30_000
	});

	const ratio = await page.evaluate(
		async ({ data }: { data: number[] }) => {
			const pdfjs = (window as unknown as { __pdfjs: typeof import('pdfjs-dist') }).__pdfjs;
			const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
			const pdfPage = await doc.getPage(1);
			const viewport = pdfPage.getViewport({ scale: 1.6 });
			const canvas = document.createElement('canvas');
			canvas.width = Math.ceil(viewport.width);
			canvas.height = Math.ceil(viewport.height);
			const ctx = canvas.getContext('2d')!;
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			await pdfPage.render({ canvasContext: ctx, viewport, canvas }).promise;

			const { data: px } = ctx.getImageData(0, 0, canvas.width, canvas.height);
			let dark = 0;
			let total = 0;
			for (let i = 0; i < px.length; i += 4) {
				total++;
				if (px[i] < 120 && px[i + 1] < 120 && px[i + 2] < 120) dark++;
			}
			return dark / total;
		},
		{ data: Array.from(bytes) }
	);

	await page.close();
	await context.close();
	return ratio;
}

beforeAll(async () => {
	browser = await chromium.launch();
}, 90_000);

afterAll(async () => {
	await browser?.close();
});

describe('generated PDFs render with real glyphs, not just correct text', () => {
	it('embeds the full font program rather than a lossy subset', async () => {
		const bytes = await buildCardSheetPdf(SAMPLE_NOTES, 'Basic Python', '26 Oct 2026');
		const buf = Buffer.from(bytes);
		expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
		// A full Inter regular + bold embed is a few hundred KB. The dropped-glyph subset
		// build was only ~10 KB, so size is a dependable regression signal.
		expect(buf.length).toBeGreaterThan(250_000);
	}, 60_000);

	it('renders the card sheet with enough ink for the text to be readable', async () => {
		const good = await buildCardSheetPdf(SAMPLE_NOTES, 'Basic Python', '26 Oct 2026');
		const ratio = await inkRatio(good);
		expect(ratio).toBeGreaterThan(0.002);
		expect(ratio).toBeLessThan(0.2);
	}, 120_000);

	it('renders noticeably more ink than an empty deck sheet', async () => {
		const empty = await buildCardSheetPdf([], 'Empty deck', '26 Oct 2026');
		const full = await buildCardSheetPdf(SAMPLE_NOTES, 'Basic Python', '26 Oct 2026');
		const emptyInk = await inkRatio(empty);
		const fullInk = await inkRatio(full);
		// The populated sheet must carry clearly more ink than the "no cards yet" page,
		// which proves the card text actually drew.
		expect(fullInk).toBeGreaterThan(emptyInk * 1.5);
	}, 180_000);

	it('renders the deck list with its rows visible', async () => {
		const bytes = await buildDeckListPdf(
			[
				{
					name: 'World Capitals',
					description: 'Capital cities by country.',
					cards: 34,
					newCards: 8,
					due: 5,
					mature: 12
				},
				{
					name: 'Basic Python',
					description: 'Core Python syntax and built-ins.',
					cards: 35,
					newCards: 10,
					due: 4,
					mature: 9
				},
				{
					name: 'Spanish Starter',
					description: 'First Spanish nouns and verbs.',
					cards: 46,
					newCards: 11,
					due: 7,
					mature: 14
				}
			],
			'26 Oct 2026'
		);
		expect(Buffer.from(bytes).length).toBeGreaterThan(250_000);
		const ratio = await inkRatio(bytes);
		expect(ratio).toBeGreaterThan(0.001);
	}, 120_000);
});
