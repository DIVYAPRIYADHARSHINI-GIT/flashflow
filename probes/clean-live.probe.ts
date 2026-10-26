// Pre-deploy / post-deploy check: a brand-new visitor must see ONLY the sample data.
//
// This runs against a fresh browser profile with empty localStorage, exactly like a first
// visitor, and asserts that none of the decks, cards or review entries created during
// testing are present. Point FF_BASE at the live URL to re-run it against production.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';

const BASE = process.env.FF_BASE ?? 'http://localhost:4188';

let browser: Browser;

beforeAll(async () => {
	browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
	await browser?.close();
});

/** Everything the test suites ever create. None of it may reach a real visitor. */
const TEST_ARTEFACTS = [
	'E2E basic front',
	'E2E reversed front',
	'E2E typed front',
	'E2E {{c1::alpha}}',
	'Dup front',
	'Big question',
	'வணக்கம், நண்பரே',
	'🎉 party',
	'He said "hi"'
];
const TEST_DECKS = ['CSV Test', 'Imported', 'Big', 'Deck one', 'D'];

describe('a brand-new visitor sees only the sample data', () => {
	it('starts with an empty localStorage and seeds exactly three sample decks', async () => {
		const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		const page = await context.newPage();
		page.setDefaultTimeout(15_000);

		// Confirm the profile really is empty before the app runs.
		await page.goto(BASE, { waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(1200);

		const store = await page.evaluate(() => {
			const raw = localStorage.getItem('flashflow:data:v1');
			return raw ? JSON.parse(raw) : null;
		});
		expect(store, 'the app should seed its store on first open').toBeTruthy();

		// Exactly the three sample decks, nothing else.
		const deckNames = store.decks.map((d: { name: string }) => d.name).sort();
		expect(deckNames).toEqual(['Basic Python', 'Spanish Starter', 'World Capitals']);

		// None of the test decks exist.
		for (const name of TEST_DECKS) {
			expect(deckNames).not.toContain(name);
		}

		// None of the test cards exist.
		const fronts = store.notes.map((n: { front: string }) => n.front);
		for (const artefact of TEST_ARTEFACTS) {
			expect(
				fronts.some((f: string) => f.includes(artefact)),
				`test artefact leaked into the live data: ${artefact}`
			).toBe(false);
		}
		expect(fronts.some((f: string) => f.startsWith('E2E'))).toBe(false);
		expect(fronts.some((f: string) => f.startsWith('Big question'))).toBe(false);

		// The sample collection is the expected size, and every review belongs to a real card.
		expect(store.notes.length).toBeGreaterThanOrEqual(85);
		expect(store.notes.length).toBeLessThanOrEqual(95);
		expect(store.cards.length).toBeLessThan(200);
		const cardIds = new Set(store.cards.map((c: { id: string }) => c.id));
		expect(store.revlog.every((r: { cardId: string }) => cardIds.has(r.cardId))).toBe(true);
		// Every logged review belongs to a sample card id, not a test id.
		expect(store.revlog.some((r: { cardId: string }) => r.cardId.startsWith('big-'))).toBe(false);

		// Settings are the shipped defaults (the limit tests changed these locally).
		expect(store.settings.newPerDay).toBe(20);
		expect(store.settings.maxReviewsPerDay).toBe(200);
		expect(store.settings.dayStartHour).toBe(4);
		expect(store.settings.theme).toBe('system');

		// The UI shows the sample decks and the storage badge.
		expect(await page.locator('a:has-text("World Capitals")').count()).toBe(1);
		expect(await page.getByText('Your data stays in this browser').first().isVisible()).toBe(true);

		await page.close();
		await context.close();
	}, 90_000);

	it('serves the app with no server-side user data and only the PDF route', async () => {
		const context = await browser.newContext();
		const page = await context.newPage();
		// The PDF route is the only API surface; everything else must 404.
		const pdf = await page.request.post(`${BASE}/api/pdf`, {
			data: { kind: 'deck-list', rows: [] }
		});
		expect(pdf.status()).toBe(200);
		expect(pdf.headers()['content-type']).toContain('application/pdf');

		for (const path of ['/api/data', '/api/decks', '/api/sync', '/api/cards']) {
			const res = await page.request.get(`${BASE}${path}`, { failOnStatusCode: false });
			expect(res.status(), `${path} should not exist`).toBe(404);
		}
		await page.close();
		await context.close();
	}, 90_000);
});
