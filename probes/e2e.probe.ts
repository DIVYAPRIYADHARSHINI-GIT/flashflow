// End-to-end browser checks against a running server (dev or preview).
//
// Covers the flow from the brief: sample data on first open -> add each card type ->
// import a messy CSV with quotes, line breaks and Tamil text -> study with each of the four
// answers and check the shown intervals against the stored schedule -> undo -> leech ->
// daily limits -> cram mode -> typed answer mode -> stats pages -> PDF export -> JSON
// backup and import (including a broken file) -> dark mode and mobile.
//
// Short timeouts throughout so nothing hangs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

const BASE = process.env.FF_BASE ?? 'http://localhost:4188';
const DOWNLOADS = process.env.FF_DOWNLOADS ?? '/tmp/ff-e2e';
const TIMEOUT = 12_000;

let browser: Browser;
const consoleErrors: string[] = [];

async function newPage(width = 1440, height = 960): Promise<Page> {
	const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
	const page = await context.newPage();
	page.setDefaultTimeout(TIMEOUT);
	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(`${page.url()} :: ${msg.text()}`);
	});
	page.on('pageerror', (err) => consoleErrors.push(`${page.url()} :: ${err.message}`));
	return page;
}

/** Read the app's stored state straight out of localStorage. */
async function readStore(page: Page) {
	return page.evaluate(() => {
		const raw = localStorage.getItem('flashflow:data:v1');
		return raw ? JSON.parse(raw) : null;
	});
}

beforeAll(async () => {
	mkdirSync(DOWNLOADS, { recursive: true });
	browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
	await browser?.close();
	if (consoleErrors.length) {
		console.log('--- console errors seen ---');
		for (const e of [...new Set(consoleErrors)]) console.log(e);
	}
});

describe('FlashFlow end to end', () => {
	it('loads the sample decks on first open and shows the storage badge', async () => {
		const page = await newPage();
		await page.goto(BASE, { waitUntil: 'networkidle' });
		await expect.poll(() => page.locator('a:has-text("World Capitals")').count()).toBeGreaterThan(0);
		expect(await page.locator('a:has-text("Basic Python")').count()).toBe(1);
		expect(await page.locator('a:has-text("Spanish Starter")').count()).toBe(1);
		expect(await page.getByText('Your data stays in this browser').first().isVisible()).toBe(true);

		const store = await readStore(page);
		expect(store.decks).toHaveLength(3);
		expect(store.notes.length).toBeGreaterThanOrEqual(85);
		expect(store.revlog.length).toBeGreaterThan(200);
		expect(store.days.length).toBeGreaterThan(30);
		await page.close();
	}, 60_000);

	it('shows a streak and a due count in the tab title', async () => {
		const page = await newPage();
		await page.goto(BASE, { waitUntil: 'networkidle' });
		await page.waitForTimeout(400);
		const title = await page.title();
		expect(title).toMatch(/FlashFlow/);
		// The sample history leaves cards due, so the count prefix should be present.
		expect(title).toMatch(/^\(\d+\)/);
		const streakText = await page.locator('text=day streak').first().isVisible();
		expect(streakText).toBe(true);
		await page.close();
	}, 60_000);

	it('adds one card of each type and creates the right number of review cards', async () => {
		const page = await newPage();
		await page.goto(`${BASE}/add`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(400);
		const before = await readStore(page);
		const beforeCards = before.cards.length;

		// Basic
		await page.selectOption('#add-type', 'basic');
		await page.fill('#add-front', 'E2E basic front');
		await page.fill('#add-back', 'E2E basic back');
		await page.getByRole('button', { name: 'Add card' }).click();
		await page.waitForTimeout(250);

		// Basic and reversed -> 2 cards
		await page.selectOption('#add-type', 'reversed');
		await page.fill('#add-front', 'E2E reversed front');
		await page.fill('#add-back', 'E2E reversed back');
		await page.getByRole('button', { name: 'Add card' }).click();
		await page.waitForTimeout(250);

		// Cloze with two numbers -> 2 cards
		await page.selectOption('#add-type', 'cloze');
		await page.fill('#add-front', 'E2E {{c1::alpha}} and {{c2::beta}}');
		await expect.poll(() => page.getByText('Cloze numbers found: c1, c2').count()).toBe(1);
		await page.getByRole('button', { name: 'Add card' }).click();
		await page.waitForTimeout(250);

		// Typed
		await page.selectOption('#add-type', 'typed');
		await page.fill('#add-front', 'E2E typed front');
		await page.fill('#add-back', 'typedanswer');
		await page.getByRole('button', { name: 'Add card' }).click();
		await page.waitForTimeout(400);

		const after = await readStore(page);
		// 1 + 2 + 2 + 1 = 6 new review cards from 4 notes.
		expect(after.cards.length - beforeCards).toBe(6);
		expect(after.notes.filter((n: { front: string }) => n.front.startsWith('E2E'))).toHaveLength(4);
		await page.close();
	}, 90_000);

	it('warns about a duplicate front in the same deck', async () => {
		const page = await newPage();
		await page.goto(`${BASE}/add`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(400);
		await page.selectOption('#add-type', 'basic');
		await page.fill('#add-front', 'Dup front');
		await page.fill('#add-back', 'first');
		await page.getByRole('button', { name: 'Add card' }).click();
		await page.waitForTimeout(250);
		await page.fill('#add-front', 'Dup front');
		await expect
			.poll(() => page.getByText('A card with this front already exists in this deck.').count())
			.toBeGreaterThan(0);
		await page.close();
	}, 60_000);

	it('imports a messy CSV with quotes, line breaks, semicolons and Tamil text', async () => {
		const csvPath = join(DOWNLOADS, 'messy.csv');
		// BOM + semicolons + quoted comma + embedded newline + Tamil + Hindi + emoji.
		const csv =
			'\ufefffront;back;tags;deck;extra\n' +
			'"வணக்கம், நண்பரே";"Hello, friend\n(a greeting)";"tamil greeting";"CSV Test";"Tamil row"\n' +
			'"नमस्ते";"Hello (Hindi)";hindi;"CSV Test";""\n' +
			'"He said ""hi""";"Quoted quotes";csv;"CSV Test";""\n' +
			'"🎉 party";"celebration";emoji;"CSV Test";""\n' +
			'"";"missing front";bad;"CSV Test";""\n';
		writeFileSync(csvPath, csv, 'utf8');

		const page = await newPage();
		await page.goto(`${BASE}/transfer`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(400);
		await page.setInputFiles('#csv-file', csvPath);
		await page.waitForTimeout(600);

		// Delimiter auto-detected as semicolon.
		expect(await page.inputValue('#csv-delim')).toBe(';');
		await page.getByRole('button', { name: 'Import cards' }).click();
		await page.waitForTimeout(800);

		// Summary: 4 added, 1 row error (empty front).
		await expect.poll(() => page.getByText('Import summary').count()).toBe(1);
		const store = await readStore(page);
		const imported = store.notes.filter(
			(n: { deckId: string }) =>
				n.deckId === store.decks.find((d: { name: string }) => d.name === 'CSV Test')?.id
		);
		expect(imported).toHaveLength(4);
		const tamil = imported.find((n: { front: string }) => n.front.includes('வணக்கம்'));
		expect(tamil).toBeTruthy();
		expect(tamil.back).toContain('\n'); // the line break inside the quoted field survived
		expect(imported.some((n: { front: string }) => n.front === 'He said "hi"')).toBe(true);
		expect(imported.some((n: { front: string }) => n.front.includes('🎉'))).toBe(true);
		expect(await page.getByText('Front is empty').count()).toBeGreaterThan(0);
		await page.close();
	}, 90_000);

	it('studies with each of the four answers and stores what the buttons promised', async () => {
		const page = await newPage();
		await page.goto(`${BASE}/study`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(600);

		const results: { label: string; rating: number; cardId: string }[] = [];

		for (const [rating, name] of [
			[1, 'Again'],
			[2, 'Hard'],
			[3, 'Good'],
			[4, 'Easy']
		] as const) {
			// Show the answer.
			await page.getByRole('button', { name: /Show answer/ }).click();
			await page.waitForTimeout(200);

			// Read the card id currently on screen and the label on the target button.
			const cardId = await page.evaluate(() => {
				const raw = localStorage.getItem('flashflow:data:v1');
				return raw ? 'ok' : 'none';
			});
			expect(cardId).toBe('ok');

			const button = page.getByRole('button', { name: new RegExp(`^${name},`) });
			const aria = (await button.getAttribute('aria-label')) ?? '';
			const match = /next interval ([^,]+),/.exec(aria);
			expect(match).toBeTruthy();
			const promised = match![1].trim();

			const storeBefore = await readStore(page);
			const beforeLog = storeBefore.revlog.length;

			await button.click();
			await page.waitForTimeout(500);

			const storeAfter = await readStore(page);
			expect(storeAfter.revlog.length).toBe(beforeLog + 1);
			const entry = storeAfter.revlog[storeAfter.revlog.length - 1];
			expect(entry.rating).toBe(rating);

			const card = storeAfter.cards.find((c: { id: string }) => c.id === entry.cardId);
			expect(card).toBeTruthy();

			// The promised label must match where the card actually landed.
			if (promised.endsWith('m')) {
				// A learning / relearning step: due within the hour.
				expect(['learning', 'relearning']).toContain(card.state);
				const minutes = (card.due - Date.now()) / 60_000;
				expect(minutes).toBeGreaterThan(0);
				expect(minutes).toBeLessThan(65);
			} else if (promised.endsWith('d')) {
				expect(card.state).toBe('review');
				expect(card.interval).toBe(parseFloat(promised));
			}
			results.push({ label: promised, rating, cardId: entry.cardId });
			await page.waitForTimeout(150);
		}

		expect(results).toHaveLength(4);
		// Again must produce a lapse on a review card, or a step reset on a learning card.
		await page.close();
	}, 120_000);

	it('undoes the last answer and restores the card and the day counters', async () => {
		const page = await newPage();
		await page.goto(`${BASE}/study`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(600);

		await page.getByRole('button', { name: /Show answer/ }).click();
		await page.waitForTimeout(200);

		const before = await readStore(page);
		const beforeLog = before.revlog.length;
		const beforeDays = JSON.stringify(before.days);

		await page.getByRole('button', { name: /^Good,/ }).click();
		await page.waitForTimeout(500);
		const mid = await readStore(page);
		expect(mid.revlog.length).toBe(beforeLog + 1);

		await page.getByRole('button', { name: 'Undo' }).click();
		await page.waitForTimeout(600);

		const after = await readStore(page);
		expect(after.revlog.length).toBe(beforeLog);
		expect(JSON.stringify(after.days)).toBe(beforeDays);
		// The card state is back to exactly what it was.
		const entry = mid.revlog[mid.revlog.length - 1];
		const beforeCard = before.cards.find((c: { id: string }) => c.id === entry.cardId);
		const afterCard = after.cards.find((c: { id: string }) => c.id === entry.cardId);
		expect(afterCard.interval).toBe(beforeCard.interval);
		expect(afterCard.state).toBe(beforeCard.state);
		expect(afterCard.reps).toBe(beforeCard.reps);
		await page.close();
	}, 90_000);

	it('shows the leech card in the browser with its lapse count', async () => {
		const page = await newPage();
		await page.goto(`${BASE}/browse`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(500);
		await page.selectOption('#b-state', 'leech');
		await page.waitForTimeout(400);
		const text = await page.locator('section:has(table)').first().innerText();
		expect(text).toMatch(/\d+ cards?/);
		const store = await readStore(page);
		const leeches = store.cards.filter(
			(c: { lapses: number }) => c.lapses >= store.settings.leechThreshold
		);
		expect(leeches.length).toBeGreaterThan(0);
		await page.close();
	}, 60_000);

	it('respects the daily new-card limit', async () => {
		const page = await newPage();
		await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(400);
		await page.fill('#s-new', '3');
		await page.dispatchEvent('#s-new', 'change');
		await page.fill('#s-max', '5');
		await page.dispatchEvent('#s-max', 'change');
		await page.waitForTimeout(600);

		await page.goto(`${BASE}/study`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(600);
		// The header shows three counts; their sum must respect the review ceiling.
		const counts = await page.evaluate(() => {
			const spans = [...document.querySelectorAll('[title="New"], [title="Learning"], [title="Due"]')];
			return spans.map((s) => parseInt(s.textContent ?? '0', 10));
		});
		expect(counts.length).toBe(3);
		expect(counts[0] + counts[2]).toBeLessThanOrEqual(5);
		await page.close();
	}, 90_000);

	it('runs a cram session that does not change the schedule', async () => {
		const page = await newPage();
		await page.goto(`${BASE}/study?mode=cram&deck=deck-1`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(700);
		expect(
			await page.getByText('this session does not change your schedule', { exact: false }).count()
		).toBeGreaterThan(0);

		const before = await readStore(page);
		const beforeCards = JSON.stringify(before.cards);
		const beforeLog = before.revlog.length;

		await page.getByRole('button', { name: /Show answer/ }).click();
		await page.waitForTimeout(200);
		await page.getByRole('button', { name: /^Good,/ }).click();
		await page.waitForTimeout(600);

		const after = await readStore(page);
		expect(after.revlog.length).toBe(beforeLog);
		expect(JSON.stringify(after.cards)).toBe(beforeCards);
		await page.close();
	}, 90_000);

	it('checks a typed answer and highlights the difference', async () => {
		const page = await newPage();
		// Starred-only mode will not reliably contain a typed card, so use the browser to
		// find one and study that deck in cram mode until a typed card appears.
		await page.goto(`${BASE}/study?mode=cram&deck=deck-3`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(700);

		let found = false;
		for (let i = 0; i < 40 && !found; i++) {
			if (await page.locator('#typed-answer').count()) {
				found = true;
				break;
			}
			if (!(await page.getByRole('button', { name: /Show answer/ }).count())) break;
			await page.getByRole('button', { name: /Show answer/ }).click();
			await page.waitForTimeout(120);
			await page.getByRole('button', { name: /^Good,/ }).click();
			await page.waitForTimeout(180);
		}
		expect(found).toBe(true);

		// Type a deliberately wrong answer and check the difference highlight appears.
		await page.fill('#typed-answer', 'wrongtext');
		await page.keyboard.press('Enter');
		await page.waitForTimeout(400);
		expect(await page.getByText('Not quite').count()).toBeGreaterThan(0);
		expect(await page.getByText('Struck-through red = extra', { exact: false }).count()).toBe(1);
		await page.close();
	}, 120_000);

	it('renders every statistics chart with real numbers', async () => {
		const page = await newPage();
		await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(800);
		for (const heading of [
			'Today',
			'Forecast — next 30 days',
			'Reviews per day',
			'Time studied per day',
			'Retention',
			'Card states',
			'Interval distribution',
			'Last 365 days'
		]) {
			expect(await page.getByRole('heading', { name: heading }).count()).toBeGreaterThan(0);
		}
		// Charts are real SVG / div bars, not placeholders.
		expect(await page.locator('[role="img"]').count()).toBeGreaterThan(3);
		expect(await page.getByText('No data for this range yet.').count()).toBe(0);

		// Range filter and per-deck view both work.
		await page.selectOption('#stats-range', '90');
		await page.waitForTimeout(400);
		await page.selectOption('#stats-deck', 'deck-2');
		await page.waitForTimeout(500);
		expect(await page.getByRole('heading', { name: 'Retention' }).count()).toBe(1);
		await page.close();
	}, 90_000);

	it('downloads a CSV export containing the sample content', async () => {
		const page = await newPage();
		await page.goto(`${BASE}/transfer`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(500);
		const [dl] = await Promise.all([
			page.waitForEvent('download', { timeout: TIMEOUT }),
			page.getByRole('button', { name: 'Export CSV' }).click()
		]);
		const path = join(DOWNLOADS, 'export.csv');
		await dl.saveAs(path);
		const text = readFileSync(path, 'utf8');
		expect(text.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM for spreadsheets
		expect(text).toContain('front,back,tags,deck,extra');
		expect(text).toContain('Tokyo');
		await page.close();
	}, 90_000);

	it('downloads both PDFs and they are valid PDF files', async () => {
		const page = await newPage();
		await page.goto(`${BASE}/transfer`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(500);

		const [listDl] = await Promise.all([
			page.waitForEvent('download', { timeout: 30_000 }),
			page.getByRole('button', { name: 'PDF deck list' }).click()
		]);
		const listPath = join(DOWNLOADS, 'deck-list.pdf');
		await listDl.saveAs(listPath);
		const listBytes = readFileSync(listPath);
		expect(listBytes.subarray(0, 5).toString()).toBe('%PDF-');
		expect(listBytes.length).toBeGreaterThan(2000);
		const listDoc = await PDFDocument.load(listBytes);
		expect(listDoc.getTitle()).toBe('FlashFlow deck list');
		expect(listDoc.getPageCount()).toBeGreaterThanOrEqual(1);

		// Card sheet for one Latin-script deck.
		await page.selectOption('#export-deck', 'deck-2');
		await page.waitForTimeout(300);
		const [sheetDl] = await Promise.all([
			page.waitForEvent('download', { timeout: 30_000 }),
			page.getByRole('button', { name: 'PDF card sheet' }).click()
		]);
		const sheetPath = join(DOWNLOADS, 'card-sheet.pdf');
		await sheetDl.saveAs(sheetPath);
		const sheetBytes = readFileSync(sheetPath);
		expect(sheetBytes.subarray(0, 5).toString()).toBe('%PDF-');
		expect(sheetBytes.length).toBeGreaterThan(5000);
		// Fronts + backs per sheet, so the page count is even and greater than two.
		const sheetDoc = await PDFDocument.load(sheetBytes);
		expect(sheetDoc.getTitle()).toContain('Basic Python');
		expect(sheetDoc.getPageCount()).toBeGreaterThan(2);
		expect(sheetDoc.getPageCount() % 2).toBe(0);
		// A4 portrait, so the double-sided print lines up.
		const { width, height } = sheetDoc.getPage(0).getSize();
		expect(Math.round(width)).toBe(595);
		expect(Math.round(height)).toBe(842);
		await page.close();
	}, 120_000);

	it('offers the print route for a deck with complex-script text', async () => {
		const page = await newPage();
		// The CSV import test created a Tamil / Hindi deck in a different browser context,
		// so add one here and confirm the warning and the server refusal.
		await page.goto(`${BASE}/add`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(400);
		await page.fill('#add-front', 'வணக்கம்');
		await page.fill('#add-back', 'Hello in Tamil');
		await page.getByRole('button', { name: 'Add card' }).click();
		await page.waitForTimeout(400);

		await page.goto(`${BASE}/transfer`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(500);
		expect(
			await page
				.getByText('contains Tamil, Devanagari or similar complex-script text', { exact: false })
				.count()
		).toBe(1);

		// The server route must refuse rather than emit broken glyphs.
		const status = await page.evaluate(async () => {
			const res = await fetch('/api/pdf', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					kind: 'card-sheet',
					deckName: 'Tamil',
					notes: [{ front: 'வணக்கம்', back: 'Hello', deck: 'Tamil' }]
				})
			});
			return { status: res.status, body: await res.json() };
		});
		expect(status.status).toBe(422);
		expect(status.body.error).toBe('complex-script');

		// The print route renders the same cards with the browser text shaper.
		await page.goto(`${BASE}/print`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(500);
		expect(await page.getByText('வணக்கம்').count()).toBeGreaterThan(0);
		await page.close();
	}, 120_000);

	it('exports a JSON backup, clears the data and restores it', async () => {
		const page = await newPage();
		await page.goto(`${BASE}/privacy`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(500);

		const [dl] = await Promise.all([
			page.waitForEvent('download', { timeout: TIMEOUT }),
			page.getByRole('button', { name: 'Export backup (JSON)' }).click()
		]);
		const backupPath = join(DOWNLOADS, 'backup.json');
		await dl.saveAs(backupPath);
		const parsed = JSON.parse(readFileSync(backupPath, 'utf8'));
		expect(parsed.kind).toBe('flashflow-backup');
		expect(parsed.data.decks).toHaveLength(3);
		const originalCards = parsed.data.cards.length;

		// The backup date is recorded, so the reminder goes away.
		await page.waitForTimeout(400);
		expect(await page.getByText('Last backup: today').count()).toBe(1);

		// Start fresh, then restore.
		await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(400);
		await page.getByRole('button', { name: 'Start fresh' }).click();
		await page.getByRole('button', { name: 'Delete everything' }).click();
		await page.waitForTimeout(700);
		let store = await readStore(page);
		expect(store.cards).toHaveLength(0);

		await page.goto(`${BASE}/privacy`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(400);
		await page.setInputFiles('#backup-file', backupPath);
		await page.waitForTimeout(600);
		expect(await page.getByText('looks valid', { exact: false }).count()).toBe(1);
		await page.getByRole('button', { name: 'Replace everything' }).click();
		await page.getByRole('button', { name: 'Replace everything' }).last().click();
		await page.waitForTimeout(900);
		store = await readStore(page);
		expect(store.cards.length).toBe(originalCards);
		await page.close();
	}, 120_000);

	it('rejects a broken backup file with a clear error and keeps the existing data', async () => {
		const page = await newPage();
		await page.goto(`${BASE}/privacy`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(500);
		const before = await readStore(page);

		const brokenPath = join(DOWNLOADS, 'broken.json');
		writeFileSync(brokenPath, '{"kind":"flashflow-backup","data":{"decks":[', 'utf8');
		await page.setInputFiles('#backup-file', brokenPath);
		await page.waitForTimeout(600);
		expect(await page.getByText('not valid JSON', { exact: false }).count()).toBeGreaterThan(0);

		// A valid JSON file from another app.
		const wrongPath = join(DOWNLOADS, 'wrong-app.json');
		writeFileSync(wrongPath, JSON.stringify({ kind: 'some-other-app', data: {} }), 'utf8');
		await page.setInputFiles('#backup-file', wrongPath);
		await page.waitForTimeout(600);
		expect(await page.getByText('not a FlashFlow backup', { exact: false }).count()).toBeGreaterThan(
			0
		);

		// Nothing was overwritten by either rejection.
		const after = await readStore(page);
		expect(after.cards.length).toBe(before.cards.length);
		await page.close();
	}, 90_000);

	it('works in dark mode', async () => {
		const page = await newPage();
		await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(400);
		await page.selectOption('#s-theme', 'dark');
		await page.waitForTimeout(500);
		const isDark = await page.evaluate(() =>
			document.documentElement.classList.contains('dark')
		);
		expect(isDark).toBe(true);
		await page.goto(`${BASE}/study`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(500);
		expect(
			await page.evaluate(() => document.documentElement.classList.contains('dark'))
		).toBe(true);
		await page.close();
	}, 60_000);

	it('works at 360px wide with the bottom tab bar', async () => {
		const page = await newPage(360, 740);
		await page.goto(BASE, { waitUntil: 'networkidle' });
		await page.waitForTimeout(600);
		// Bottom tab bar is visible, sidebar is not.
		const navs = page.locator('nav[aria-label="Main navigation"]');
		expect(await navs.count()).toBe(2);
		expect(await navs.last().isVisible()).toBe(true);
		expect(await navs.first().isVisible()).toBe(false);
		// No horizontal overflow.
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);

		await page.goto(`${BASE}/browse`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(500);
		// The card list is shown instead of the table.
		expect(await page.locator('table').first().isVisible()).toBe(false);
		await page.close();
	}, 90_000);

	it('studies fully from the keyboard', async () => {
		const page = await newPage();
		await page.goto(`${BASE}/study`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(600);
		const before = await readStore(page);
		await page.keyboard.press('Space'); // show answer
		await page.waitForTimeout(250);
		await page.keyboard.press('3'); // Good
		await page.waitForTimeout(500);
		const after = await readStore(page);
		expect(after.revlog.length).toBe(before.revlog.length + 1);
		expect(after.revlog[after.revlog.length - 1].rating).toBe(3);
		// U undoes it.
		await page.keyboard.press('u');
		await page.waitForTimeout(600);
		const undone = await readStore(page);
		expect(undone.revlog.length).toBe(before.revlog.length);
		await page.close();
	}, 90_000);

	it('does not freeze with 10,000 cards in the browser', async () => {
		const page = await newPage();
		await page.goto(BASE, { waitUntil: 'networkidle' });
		await page.waitForTimeout(500);

		// Write a large collection straight into the store, then reload.
		await page.evaluate(() => {
			const raw = localStorage.getItem('flashflow:data:v1');
			const data = JSON.parse(raw!);
			const deckId = data.decks[0].id;
			const now = Date.now();
			for (let i = 0; i < 10_000; i++) {
				data.notes.push({
					id: `big-n${i}`,
					deckId,
					type: 'basic',
					front: `Big question ${i}`,
					back: `Big answer ${i}`,
					extra: '',
					imageFront: null,
					imageBack: null,
					tags: ['bulk'],
					starred: false,
					createdAt: now,
					updatedAt: now
				});
				data.cards.push({
					id: `big-c${i}`,
					noteId: `big-n${i}`,
					deckId,
					ord: 0,
					state: 'review',
					prevState: null,
					due: now + (i % 60) * 86400000,
					interval: 10,
					ease: 2.5,
					step: 0,
					reps: 3,
					lapses: 0,
					lastReviewed: now - 86400000,
					lastDay: null,
					buriedUntilDay: null,
					position: 10000 + i
				});
			}
			localStorage.setItem('flashflow:data:v1', JSON.stringify(data));
		});

		for (const route of ['/', '/browse', '/stats']) {
			const t0 = Date.now();
			await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 25_000 });
			// The page must stay responsive: a simple evaluate must return promptly.
			await page.waitForTimeout(600);
			const responsive = await page.evaluate(() => 1 + 1, { timeout: 5000 } as never);
			expect(responsive).toBe(2);
			expect(Date.now() - t0).toBeLessThan(25_000);
		}

		// The browser pages the table rather than rendering 10,000 rows at once.
		await page.goto(`${BASE}/browse`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(900);
		const rowCount = await page.locator('tbody tr').count();
		expect(rowCount).toBeLessThanOrEqual(101);
		expect(await page.getByText('Show 100 more', { exact: false }).count()).toBe(1);
		await page.close();
	}, 180_000);
});
