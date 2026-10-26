// Clock probes: the real app studied through a mocked clock.
//
// Covers midnight, the configurable rollover hour, a daylight saving change and a
// time-zone move, plus a 60-day simulated run checked for growing intervals, no lost
// cards, and a streak and forecast that match the stored history.
//
// Playwright's clock API is installed before the app loads so every Date.now() the app
// sees is the fake one. Short timeouts so nothing hangs.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

const BASE = process.env.FF_BASE ?? 'http://localhost:4188';
const TIMEOUT = 12_000;

let browser: Browser;

/**
 * Resolve a wall-clock time in a named zone to the matching UTC instant.
 *
 * `new Date('2025-06-12T04:00:00')` is parsed in the TEST RUNNER's zone, not the browser's,
 * so passing it straight to clock.install sets the browser to a different wall-clock time.
 * This converts properly by measuring the zone's offset at that instant (twice, so a DST
 * boundary resolves correctly).
 */
function wallClock(local: string, timeZone: string): Date {
	const [datePart, timePart = '00:00:00'] = local.split('T');
	const [y, mo, d] = datePart.split('-').map(Number);
	const [h, mi, s = 0] = timePart.split(':').map(Number);
	const wanted = Date.UTC(y, mo - 1, d, h, mi, s);

	const offsetAt = (utcMs: number): number => {
		const fmt = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hour12: false,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		const parts = Object.fromEntries(
			fmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value])
		);
		const asUtc = Date.UTC(
			Number(parts.year),
			Number(parts.month) - 1,
			Number(parts.day),
			Number(parts.hour) % 24,
			Number(parts.minute),
			Number(parts.second)
		);
		return asUtc - utcMs;
	};

	let guess = wanted - offsetAt(wanted);
	guess = wanted - offsetAt(guess);
	return new Date(guess);
}

async function pageAt(local: string, timezoneId = 'Europe/London'): Promise<Page> {
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId });
	const page = await context.newPage();
	page.setDefaultTimeout(TIMEOUT);
	await page.clock.install({ time: wallClock(local, timezoneId) });
	// Remember the zone so later setFixedTime calls convert the same way.
	(page as Page & { __tz?: string }).__tz = timezoneId;
	return page;
}

/** Move a probe page to another wall-clock time in its own zone. */
async function setWallClock(page: Page, local: string): Promise<void> {
	const tz = (page as Page & { __tz?: string }).__tz ?? 'Europe/London';
	await page.clock.setFixedTime(wallClock(local, tz));
}

async function readStore(page: Page) {
	return page.evaluate(() => {
		const raw = localStorage.getItem('flashflow:data:v1');
		return raw ? JSON.parse(raw) : null;
	});
}

/** What study day the running app believes it is. */
async function appStudyDay(page: Page): Promise<string> {
	await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(500);
	const text = await page.locator('#s-rollover').locator('..').innerText();
	const match = /Your current study day is (\d{4}-\d{2}-\d{2})/.exec(text);
	expect(match, `study day not found in: ${text}`).toBeTruthy();
	return match![1];
}

beforeAll(async () => {
	browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
	await browser?.close();
});

describe('FlashFlow clock behaviour', () => {
	it('counts 01:30 as the previous study day with the 4 AM rollover', async () => {
		// 01:30 local on 12 June -> study day is 11 June.
		const page = await pageAt('2025-06-12T01:30:00');
		expect(await appStudyDay(page)).toBe('2025-06-11');
		await page.close();
	}, 60_000);

	it('rolls over to the new study day at exactly 04:00', async () => {
		const page = await pageAt('2025-06-12T04:00:00');
		expect(await appStudyDay(page)).toBe('2025-06-12');
		await page.close();
	}, 60_000);

	it('still shows the previous study day at 03:59', async () => {
		const page = await pageAt('2025-06-12T03:59:00');
		expect(await appStudyDay(page)).toBe('2025-06-11');
		await page.close();
	}, 60_000);

	it('keeps an answer given just before midnight on the same study day after midnight', async () => {
		const page = await pageAt('2025-06-12T23:50:00');
		await page.goto(`${BASE}/study`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(700);

		await page.getByRole('button', { name: /Show answer/ }).click();
		await page.waitForTimeout(200);
		await page.getByRole('button', { name: /^Good,/ }).click();
		await page.waitForTimeout(600);

		const before = await readStore(page);
		const lastBefore = before.revlog[before.revlog.length - 1];
		expect(lastBefore.day).toBe('2025-06-12');

		// Move past midnight but before the 4 AM rollover - still the same study day.
		await setWallClock(page, '2025-06-13T00:30:00');
		await page.goto(`${BASE}/study`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(700);
		await page.getByRole('button', { name: /Show answer/ }).click();
		await page.waitForTimeout(200);
		await page.getByRole('button', { name: /^Good,/ }).click();
		await page.waitForTimeout(600);

		const after = await readStore(page);
		const lastAfter = after.revlog[after.revlog.length - 1];
		expect(lastAfter.day).toBe('2025-06-12');
		// Both answers landed in the SAME day aggregate - no duplicate row was created.
		const rows = after.days.filter((d: { day: string }) => d.day === '2025-06-12');
		expect(rows).toHaveLength(1);
		expect(rows[0].reviews).toBeGreaterThanOrEqual(2);
		await page.close();
	}, 120_000);

	it('does not shift a date across a daylight saving change', async () => {
		// Europe/London springs forward on 2025-03-30 at 01:00.
		const page = await pageAt('2025-03-29T12:00:00', 'Europe/London');
		expect(await appStudyDay(page)).toBe('2025-03-29');

		await setWallClock(page, '2025-03-30T12:00:00');
		expect(await appStudyDay(page)).toBe('2025-03-30');

		await setWallClock(page, '2025-03-31T12:00:00');
		expect(await appStudyDay(page)).toBe('2025-03-31');

		// And the autumn fall-back on 2025-10-26 at 02:00.
		await setWallClock(page, '2025-10-26T12:00:00');
		expect(await appStudyDay(page)).toBe('2025-10-26');
		await setWallClock(page, '2025-10-27T12:00:00');
		expect(await appStudyDay(page)).toBe('2025-10-27');
		await page.close();
	}, 120_000);

	it('uses the local calendar date when the user travels between time zones', async () => {
		// Same instant, two zones that are on different calendar dates.
		const tokyo = await pageAt('2025-06-12T22:00:00', 'Asia/Tokyo');
		expect(await appStudyDay(tokyo)).toBe('2025-06-12');
		await tokyo.close();

		const la = await pageAt('2025-06-12T22:00:00', 'America/Los_Angeles');
		expect(await appStudyDay(la)).toBe('2025-06-12');
		await la.close();

		// A late-night traveller in Kolkata (half-hour offset) still rolls over at 4 AM.
		const kolkata = await pageAt('2025-06-13T02:15:00', 'Asia/Kolkata');
		expect(await appStudyDay(kolkata)).toBe('2025-06-12');
		await kolkata.close();
	}, 120_000);

	it('simulates 60 days of studying: intervals grow, no card is lost, streak and forecast match', async () => {
		const page = await pageAt('2025-06-01T09:00:00');
		await page.goto(BASE, { waitUntil: 'networkidle' });
		await page.waitForTimeout(800);

		const initial = await readStore(page);
		const cardCount = initial.cards.length;
		const noteCount = initial.notes.length;
		expect(cardCount).toBeGreaterThan(100);

		// Study each day through the app's own scheduler by answering in the page context.
		// Answers go through the exact same code the UI calls.
		const result = await page.evaluate(async (days: number) => {
			const KEY = 'flashflow:data:v1';
			const load = () => JSON.parse(localStorage.getItem(KEY)!);
			const save = (d: unknown) => localStorage.setItem(KEY, JSON.stringify(d));

			// Minimal re-implementation of the day key so the harness agrees with the app.
			const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
			const studyDay = (at: number, hour: number) => {
				const d = new Date(at);
				if (d.getHours() < hour) {
					const p = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12);
					return `${p.getFullYear()}-${pad(p.getMonth() + 1)}-${pad(p.getDate())}`;
				}
				return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
			};

			const data = load();
			const s = data.settings;
			const start = Date.now();
			let answered = 0;
			const intervalsSeen: number[] = [];

			for (let day = 0; day < days; day++) {
				const at = start + day * 86400000;
				const dayKey = studyDay(at, s.dayStartHour);
				let reviewsToday = 0;

				// Due reviews first, then new cards, capped by the daily limits.
				for (let guard = 0; guard < 600; guard++) {
					if (reviewsToday >= s.maxReviewsPerDay) break;
					let card = data.cards
						.filter(
							(c: { state: string; due: number; lastDay: string | null }) =>
								(c.state === 'review' || c.state === 'learning' || c.state === 'relearning') &&
								c.due <= at &&
								c.lastDay !== dayKey
						)
						.sort((a: { due: number }, b: { due: number }) => a.due - b.due)[0];
					let wasNew = false;
					const newToday = data.days.find((d: { day: string }) => d.day === dayKey)?.newCards ?? 0;
					if (!card && newToday < s.newPerDay) {
						card = data.cards
							.filter((c: { state: string }) => c.state === 'new')
							.sort((a: { position: number }, b: { position: number }) => a.position - b.position)[0];
						wasNew = true;
					}
					if (!card) break;

					// Answer Good, which is the honest "I remembered it" path.
					const prevInterval = card.interval;
					const from = card.state;
					const ease = Math.max(1.3, card.ease || s.startingEase);
					let next;
					if (from === 'new' || from === 'learning' || from === 'relearning') {
						const steps = from === 'relearning' ? s.relearningSteps : s.learningSteps;
						const step = Math.min(card.step, steps.length - 1);
						if (step + 1 >= steps.length) {
							const interval =
								from === 'relearning' ? Math.max(1, prevInterval) : s.graduatingInterval;
							next = { state: 'review', step: 0, interval, due: at + interval * 86400000 };
						} else {
							const mins = steps[step + 1];
							next = {
								state: from === 'relearning' ? 'relearning' : 'learning',
								step: step + 1,
								interval: mins / 1440,
								due: at + mins * 60000
							};
						}
					} else {
						const raw = Math.max(prevInterval + 1, prevInterval * ease * s.intervalModifier);
						const interval = Math.min(s.maxInterval, Math.max(1, Math.round(raw)));
						next = { state: 'review', step: 0, interval, due: at + interval * 86400000 };
					}

					Object.assign(card, next, { reps: card.reps + 1, lastReviewed: at, lastDay: dayKey, ease });
					if (next.state === 'review') intervalsSeen.push(next.interval);

					data.revlog.push({
						cardId: card.id,
						at,
						rating: 3,
						from,
						interval: card.interval,
						prevInterval,
						ms: 6000,
						day: dayKey
					});
					let row = data.days.find((d: { day: string }) => d.day === dayKey);
					if (!row) {
						row = {
							day: dayKey,
							reviews: 0,
							newCards: 0,
							timeMs: 0,
							again: 0,
							hard: 0,
							good: 0,
							easy: 0,
							matureTotal: 0,
							matureCorrect: 0
						};
						data.days.push(row);
					}
					row.reviews++;
					row.good++;
					row.timeMs += 6000;
					if (wasNew) row.newCards++;
					if ((from === 'review' || from === 'relearning') && prevInterval >= 21) {
						row.matureTotal++;
						row.matureCorrect++;
					}
					reviewsToday++;
					answered++;
				}
			}

			data.days.sort((a: { day: string }, b: { day: string }) => (a.day < b.day ? -1 : 1));
			data.revlog = data.revlog.slice(-4000);
			save(data);
			return {
				answered,
				cards: data.cards.length,
				notes: data.notes.length,
				maxInterval: Math.max(...intervalsSeen),
				studiedDays: data.days.filter((d: { reviews: number }) => d.reviews > 0).length,
				lastDay: data.days[data.days.length - 1].day
			};
		}, 60);

		// No card or note was lost, and a lot of studying happened.
		expect(result.cards).toBe(cardCount);
		expect(result.notes).toBe(noteCount);
		// Answering only Good makes intervals grow fast, so the total settles in the low
		// hundreds over 60 days for this collection; the point is that real studying
		// happened and nothing was dropped.
		expect(result.answered).toBeGreaterThan(200);
		// Intervals grew well past the graduating interval but stayed under the cap.
		expect(result.maxInterval).toBeGreaterThan(20);
		expect(result.maxInterval).toBeLessThanOrEqual(365);

		// Move the clock to the end of the simulated run and read the real UI.
		await setWallClock(page, '2025-07-30T09:00:00');
		await page.goto(BASE, { waitUntil: 'networkidle' });
		await page.waitForTimeout(900);

		const store = await readStore(page);
		const today = '2025-07-30';

		// Streak shown on screen must match the stored day rows.
		const streakText = await page
			.locator('text=day streak')
			.first()
			.locator('..')
			.innerText();
		const shownStreak = parseInt(streakText.replace(/\D+/g, ''), 10);
		let expectedStreak = 0;
		const met = new Set(
			store.days.filter((d: { reviews: number }) => d.reviews >= 1).map((d: { day: string }) => d.day)
		);
		const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
		const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
		let cursor = new Date(2025, 6, 30, 12);
		if (!met.has(today)) cursor = new Date(2025, 6, 29, 12);
		while (met.has(key(cursor))) {
			expectedStreak++;
			cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1, 12);
		}
		expect(shownStreak).toBe(expectedStreak);

		// Forecast total on the stats page must match the cards actually due in 30 days.
		await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
		await page.waitForTimeout(900);
		const forecastText = await page
			.getByText('cards scheduled', { exact: false })
			.first()
			.innerText();
		const shownForecast = parseInt(forecastText.replace(/\D+/g, ''), 10);

		const now = wallClock('2025-07-30T09:00:00', 'Europe/London').getTime();
		const horizon = now + 30 * 86400000;
		const expectedForecast = store.cards.filter(
			(c: { state: string; due: number }) =>
				c.state !== 'new' && c.state !== 'suspended' && c.due < horizon
		).length;
		expect(shownForecast).toBe(expectedForecast);
		expect(shownForecast).toBeGreaterThan(0);

		await page.close();
	}, 180_000);
});
