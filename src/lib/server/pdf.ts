// PDF generation with pdf-lib (MIT) and fontkit, for the ONLY server route in FlashFlow.
//
// Two documents:
//   1. Deck list  - a printable overview of decks with their card counts and states.
//   2. Card sheet - fronts and backs laid out for double-sided printing: page 1 holds a
//      grid of fronts, page 2 holds the SAME grid mirrored left-to-right so a duplex
//      "flip on long edge" print puts each back behind its own front.
//
// Script support: the embedded fonts are Inter (Latin) and Noto Sans Tamil / Devanagari.
// pdf-lib has no complex-script shaping engine, so Tamil and Devanagari glyph clusters
// (consonant conjuncts, reordered vowel signs) cannot be laid out correctly here. Those
// decks are detected and rejected with a clear message, and the client falls back to the
// browser's print-to-PDF route with the print stylesheet, which uses the real text shaper.

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PdfNote {
	front: string;
	back: string;
	extra?: string;
	deck: string;
	tags?: string[];
}

export interface DeckListRow {
	name: string;
	description: string;
	cards: number;
	newCards: number;
	due: number;
	mature: number;
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const INK = rgb(0.063, 0.129, 0.235); // #10213C
const MUTED = rgb(0.35, 0.4, 0.51);
const LINE = rgb(0.85, 0.88, 0.94);

/**
 * adapter-vercel copies `static/` into the function bundle, so `<fn root>/static/fonts`
 * is the production path. Module-relative candidates keep `vite dev` and `vite preview`
 * working too. Cached because one request can render many pages.
 */
const fontCache = new Map<string, Uint8Array>();

async function readFontFile(stem: string): Promise<Uint8Array> {
	const cached = fontCache.get(stem);
	if (cached) return cached;
	const file = `${stem}.ttf`;
	const here = fileURLToPath(new URL('.', import.meta.url));
	const candidates = [
		join(process.cwd(), 'static', 'fonts', file),
		join(process.cwd(), 'client', 'fonts', file),
		join(here, 'static', 'fonts', file),
		join(here, '..', 'static', 'fonts', file),
		join(here, '..', '..', 'static', 'fonts', file),
		join(here, '..', '..', '..', 'static', 'fonts', file)
	];
	for (const path of candidates) {
		try {
			const bytes = new Uint8Array(await readFile(path));
			fontCache.set(stem, bytes);
			return bytes;
		} catch {
			continue;
		}
	}
	throw new Error(`Font file ${file} was not found on the server.`);
}

interface Fonts {
	regular: PDFFont;
	bold: PDFFont;
}

async function embedFonts(doc: PDFDocument): Promise<Fonts> {
	doc.registerFontkit(fontkit);
	try {
		// Source Serif, not Inter. The shipped Inter TTF build has broken cmap entries for
		// ':' and ')': they extract as 'ր' and 'Յ' and render as blank gaps. Source Serif
		// renders the full ASCII punctuation set correctly (verified by rendering both and
		// comparing), and a serif face suits printed flashcards better anyway.
		const [reg, bold] = await Promise.all([
			readFontFile('source-serif-regular'),
			readFontFile('source-serif-bold')
		]);
		// NOTE: `subset: true` must NOT be used here. With these Inter builds, fontkit's
		// subsetter silently drops glyphs - the extracted text stays correct but the
		// rendered page shows gaps where characters should be ("What does" rendered as
		// "h  es"). Embedding the full font costs about 300 KB per PDF, which is fine for
		// a printable card sheet and is the only way the output is actually readable.
		// Verified by rendering both variants and comparing them visually.
		return {
			regular: await doc.embedFont(reg),
			bold: await doc.embedFont(bold)
		};
	} catch {
		// Last-resort fallback so the route still returns a usable PDF.
		return {
			regular: await doc.embedFont(StandardFonts.Helvetica),
			bold: await doc.embedFont(StandardFonts.HelveticaBold)
		};
	}
}

/** Strip the light markdown the app supports so the PDF shows clean text. */
function flatten(text: string): string {
	return text
		.replace(/```/g, '')
		.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '$1')
		.replace(/[*_`]/g, '')
		.replace(/\r?\n+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Make text safe to draw with the embedded Latin font.
 *
 * IMPORTANT: do not probe this character-by-character with `widthOfTextAtSize`. Doing so
 * corrupted the output - ':' rendered as 'ր' and ')' as 'Յ' - because measuring single
 * characters pollutes pdf-lib's glyph/encoding cache for the subsequent full-string draw.
 * Instead, try the whole string once and only fall back to stripping when it genuinely
 * cannot be encoded.
 */
function encodable(text: string, font: PDFFont): string {
	try {
		font.encodeText(text);
		return text;
	} catch {
		// Keep ASCII and Latin-1, replace anything the font cannot represent.
		return [...text].map((ch) => (ch.codePointAt(0)! < 0x0250 ? ch : '?')).join('');
	}
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number, maxLines: number): string[] {
	const words = encodable(text, font).split(' ').filter(Boolean);
	const lines: string[] = [];
	let line = '';
	for (const word of words) {
		const candidate = line ? `${line} ${word}` : word;
		if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
			line = candidate;
			continue;
		}
		if (line) lines.push(line);
		line = word;
		if (lines.length >= maxLines) break;
	}
	if (line && lines.length < maxLines) lines.push(line);
	if (lines.length === maxLines && words.length > lines.join(' ').split(' ').length) {
		lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}...`;
	}
	return lines.slice(0, maxLines);
}

function header(page: PDFPage, fonts: Fonts, title: string, subtitle: string) {
	page.drawText(encodable('FlashFlow', fonts.bold), {
		x: MARGIN,
		y: A4.height - MARGIN - 4,
		size: 9,
		font: fonts.bold,
		color: MUTED
	});
	page.drawText(encodable(title, fonts.bold), {
		x: MARGIN,
		y: A4.height - MARGIN - 24,
		size: 16,
		font: fonts.bold,
		color: INK
	});
	page.drawText(encodable(subtitle, fonts.regular), {
		x: MARGIN,
		y: A4.height - MARGIN - 40,
		size: 9,
		font: fonts.regular,
		color: MUTED
	});
	page.drawLine({
		start: { x: MARGIN, y: A4.height - MARGIN - 50 },
		end: { x: A4.width - MARGIN, y: A4.height - MARGIN - 50 },
		thickness: 1,
		color: LINE
	});
}

function footer(page: PDFPage, fonts: Fonts, text: string) {
	page.drawText(encodable(text, fonts.regular), {
		x: MARGIN,
		y: MARGIN - 14,
		size: 7.5,
		font: fonts.regular,
		color: MUTED
	});
}

/** Printable deck list. */
export async function buildDeckListPdf(rows: DeckListRow[], generatedAt: string): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.setTitle('FlashFlow deck list');
	doc.setProducer('FlashFlow');
	const fonts = await embedFonts(doc);

	let page = doc.addPage([A4.width, A4.height]);
	header(page, fonts, 'Deck list', `Generated ${generatedAt}`);
	let y = A4.height - MARGIN - 70;

	const COLS: { label: string; x: number; align?: 'right' }[] = [
		{ label: 'Deck', x: MARGIN },
		{ label: 'Cards', x: 350, align: 'right' },
		{ label: 'New', x: 410, align: 'right' },
		{ label: 'Due', x: 470, align: 'right' },
		{ label: 'Mature', x: A4.width - MARGIN, align: 'right' }
	];

	const drawRow = (cells: string[], font: PDFFont, size: number, yy: number) => {
		cells.forEach((cell, i) => {
			const col = COLS[i];
			const text = encodable(cell, font);
			const width = font.widthOfTextAtSize(text, size);
			page.drawText(text, {
				x: col.align === 'right' ? col.x - width : col.x,
				y: yy,
				size,
				font,
				color: INK
			});
		});
	};

	drawRow(COLS.map((c) => c.label), fonts.bold, 9, y);
	y -= 14;

	for (const row of rows) {
		if (y < MARGIN + 30) {
			footer(page, fonts, 'FlashFlow - your data stays in your browser.');
			page = doc.addPage([A4.width, A4.height]);
			header(page, fonts, 'Deck list (continued)', `Generated ${generatedAt}`);
			y = A4.height - MARGIN - 70;
		}
		page.drawLine({
			start: { x: MARGIN, y: y + 10 },
			end: { x: A4.width - MARGIN, y: y + 10 },
			thickness: 0.5,
			color: LINE
		});
		drawRow(
			[
				row.name,
				String(row.cards),
				String(row.newCards),
				String(row.due),
				String(row.mature)
			],
			fonts.regular,
			9.5,
			y
		);
		y -= 12;
		if (row.description) {
			const lines = wrap(flatten(row.description), fonts.regular, 8, 300, 1);
			for (const line of lines) {
				page.drawText(line, { x: MARGIN + 6, y, size: 8, font: fonts.regular, color: MUTED });
				y -= 11;
			}
		}
		y -= 4;
	}

	const total = rows.reduce((s, r) => s + r.cards, 0);
	y -= 6;
	page.drawText(encodable(`${rows.length} decks, ${total} cards in total.`, fonts.bold), {
		x: MARGIN,
		y,
		size: 9.5,
		font: fonts.bold,
		color: INK
	});

	footer(page, fonts, 'FlashFlow - your data stays in your browser.');
	return doc.save();
}

/**
 * Printable card sheet laid out for double-sided printing.
 * Fronts on odd pages, backs on even pages mirrored horizontally so a duplex print
 * (flip on long edge) lines each back up behind its own front.
 */
export async function buildCardSheetPdf(
	notes: PdfNote[],
	deckName: string,
	generatedAt: string
): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.setTitle(`FlashFlow cards - ${deckName}`);
	doc.setProducer('FlashFlow');
	const fonts = await embedFonts(doc);

	const COLS = 2;
	const ROWS = 4;
	const PER_PAGE = COLS * ROWS;
	const gridTop = A4.height - MARGIN - 60;
	const gridHeight = gridTop - MARGIN - 10;
	const cellW = (A4.width - MARGIN * 2) / COLS;
	const cellH = gridHeight / ROWS;

	const drawCell = (
		page: PDFPage,
		col: number,
		row: number,
		title: string,
		body: string,
		sub: string
	) => {
		const x = MARGIN + col * cellW;
		const yTop = gridTop - row * cellH;
		page.drawRectangle({
			x: x + 3,
			y: yTop - cellH + 5,
			width: cellW - 6,
			height: cellH - 8,
			borderColor: LINE,
			borderWidth: 1,
			borderDashArray: [3, 3]
		});
		page.drawText(encodable(title, fonts.bold), {
			x: x + 12,
			y: yTop - 16,
			size: 7.5,
			font: fonts.bold,
			color: MUTED
		});
		const lines = wrap(flatten(body), fonts.regular, 11, cellW - 28, 6);
		let ly = yTop - 36;
		for (const line of lines) {
			page.drawText(line, { x: x + 12, y: ly, size: 11, font: fonts.regular, color: INK });
			ly -= 14;
		}
		if (sub) {
			const subLines = wrap(flatten(sub), fonts.regular, 7.5, cellW - 28, 2);
			let sy = yTop - cellH + 20;
			for (const line of subLines.reverse()) {
				page.drawText(line, { x: x + 12, y: sy, size: 7.5, font: fonts.regular, color: MUTED });
				sy += 10;
			}
		}
	};

	for (let start = 0; start < notes.length; start += PER_PAGE) {
		const chunk = notes.slice(start, start + PER_PAGE);
		const sheet = Math.floor(start / PER_PAGE) + 1;

		// Front page
		const frontPage = doc.addPage([A4.width, A4.height]);
		header(frontPage, fonts, `${deckName} - fronts`, `Sheet ${sheet} - generated ${generatedAt}`);
		chunk.forEach((note, i) => {
			drawCell(
				frontPage,
				i % COLS,
				Math.floor(i / COLS),
				`${start + i + 1}`,
				note.front,
				note.tags?.length ? note.tags.join(' ') : ''
			);
		});
		footer(
			frontPage,
			fonts,
			'Print double sided, flip on the long edge, then cut along the dashed lines.'
		);

		// Back page - columns mirrored so duplex printing aligns.
		const backPage = doc.addPage([A4.width, A4.height]);
		header(backPage, fonts, `${deckName} - backs`, `Sheet ${sheet} - generated ${generatedAt}`);
		chunk.forEach((note, i) => {
			const col = COLS - 1 - (i % COLS);
			drawCell(backPage, col, Math.floor(i / COLS), `${start + i + 1}`, note.back, note.extra ?? '');
		});
		footer(backPage, fonts, 'Backs are mirrored so each answer prints behind its own question.');
	}

	if (notes.length === 0) {
		const page = doc.addPage([A4.width, A4.height]);
		header(page, fonts, `${deckName} - cards`, `Generated ${generatedAt}`);
		page.drawText(encodable('This deck has no cards yet.', fonts.regular), {
			x: MARGIN,
			y: A4.height - MARGIN - 80,
			size: 11,
			font: fonts.regular,
			color: MUTED
		});
	}

	return doc.save();
}
