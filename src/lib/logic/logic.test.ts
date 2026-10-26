// Unit tests for every logic module, with an injectable clock so nothing depends on the
// real current time. The brief asks for at least 50 cases across the logic modules.

import { describe, it, expect } from 'vitest';
import {
	addDays,
	dayEnd,
	dayRange,
	dayStart,
	daysBetween,
	fixedClock,
	formatDuration,
	formatInterval,
	lastDays,
	localDateKey,
	parseDayKey,
	studyDay,
	todayKey
} from './day';
import {
	MIN_EASE,
	answerPreviews,
	applyAnswer,
	fuzzInterval,
	isLeech,
	newCard,
	previewAnswer,
	seededUnit
} from './scheduler';
import {
	buildQueue,
	DEFAULT_QUEUE_OPTIONS,
	buryCard,
	burySiblingsOf,
	deckFamily,
	newLimitFor,
	resetCard,
	suspendCard,
	unsuspendCard
} from './queue';
import { clozeAnswer, clozePlain, parseCloze, renderCloze } from './cloze';
import { compareTyped, normalise } from './typed';
import {
	detectDelimiter,
	detectMapping,
	looksLikeHeader,
	mapRows,
	parseCsv,
	stripBom,
	toCsv
} from './csv';
import { renderCardText, plainText, escapeHtml } from './format';
import {
	forecast,
	heatmap,
	intervalDistribution,
	recordDay,
	retention,
	stateBreakdown,
	streak,
	todaySummary
} from './stats';
import { validateBackup, makeBackup, mergeBackup } from './backup';
import { buildSampleData } from './sample-data';
import { SessionTimer, MAX_MS_PER_CARD } from './session';
import { emptyData, LocalStudyStore, MemoryStudyStore, trimForStorage } from '#lib/store/study-store';
import { migrate } from '#lib/store/migrations';
import { DEFAULT_SETTINGS, REVLOG_CAP, type AppData, type Card, type Settings } from '#lib/types';

const SETTINGS: Settings = { ...DEFAULT_SETTINGS };
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

function card(patch: Partial<Card> = {}): Card {
	return { ...newCard('c1', 'n1', 'd1', 0, 0, SETTINGS), ...patch };
}

function data(patch: Partial<AppData> = {}): AppData {
	return { ...emptyData(), ...patch };
}

// ---------------------------------------------------------------- day / rollover

describe('day keys, rollover and time zones', () => {
	it('formats a local date without going through UTC', () => {
		// 23:30 local on 1 June - a UTC conversion would roll this to 2 June in many zones.
		expect(localDateKey(new Date(2025, 5, 1, 23, 30))).toBe('2025-06-01');
	});

	it('treats 01:30 as the previous study day with a 4 AM rollover', () => {
		expect(studyDay(new Date(2025, 2, 10, 1, 30), 4)).toBe('2025-03-09');
	});

	it('treats 04:00 exactly as the new study day', () => {
		expect(studyDay(new Date(2025, 2, 10, 4, 0), 4)).toBe('2025-03-10');
	});

	it('treats 03:59 as the previous study day', () => {
		expect(studyDay(new Date(2025, 2, 10, 3, 59), 4)).toBe('2025-03-09');
	});

	it('uses the calendar date when the rollover hour is 0', () => {
		expect(studyDay(new Date(2025, 2, 10, 0, 5), 0)).toBe('2025-03-10');
	});

	it('crosses a month boundary backwards correctly', () => {
		expect(studyDay(new Date(2025, 3, 1, 2, 0), 4)).toBe('2025-03-31');
	});

	it('crosses a year boundary backwards correctly', () => {
		expect(studyDay(new Date(2025, 0, 1, 1, 0), 4)).toBe('2024-12-31');
	});

	it('adds days across a US spring-forward DST boundary without skipping a date', () => {
		// 2025-03-09 is the US spring-forward date; the day is only 23 hours long.
		expect(addDays('2025-03-08', 1)).toBe('2025-03-09');
		expect(addDays('2025-03-09', 1)).toBe('2025-03-10');
		expect(daysBetween('2025-03-08', '2025-03-10')).toBe(2);
	});

	it('adds days across a fall-back DST boundary without repeating a date', () => {
		// 2025-11-02 is the US fall-back date; the day is 25 hours long.
		expect(addDays('2025-11-01', 1)).toBe('2025-11-02');
		expect(addDays('2025-11-02', 1)).toBe('2025-11-03');
		expect(daysBetween('2025-11-01', '2025-11-03')).toBe(2);
	});

	it('adds days across a leap day', () => {
		expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
		expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
	});

	it('subtracts days correctly', () => {
		expect(addDays('2025-01-01', -1)).toBe('2024-12-31');
		expect(addDays('2025-03-01', -1)).toBe('2025-02-28');
	});

	it('builds an inclusive day range', () => {
		expect(dayRange('2025-05-01', '2025-05-04')).toEqual([
			'2025-05-01',
			'2025-05-02',
			'2025-05-03',
			'2025-05-04'
		]);
	});

	it('lists the last N days ending at a given day', () => {
		const days = lastDays('2025-05-10', 3);
		expect(days).toEqual(['2025-05-08', '2025-05-09', '2025-05-10']);
	});

	it('computes a day boundary at the rollover hour, and the end as the next start', () => {
		const start = dayStart('2025-06-10', 4);
		expect(new Date(start).getHours()).toBe(4);
		expect(new Date(start).getDate()).toBe(10);
		expect(dayEnd('2025-06-10', 4)).toBe(dayStart('2025-06-11', 4));
	});

	it('parses a day key back into a local date', () => {
		const d = parseDayKey('2025-07-04');
		expect(d.getFullYear()).toBe(2025);
		expect(d.getMonth()).toBe(6);
		expect(d.getDate()).toBe(4);
	});

	it('derives today from an injected clock', () => {
		const clock = fixedClock(new Date(2025, 8, 15, 2, 0));
		expect(todayKey(clock, 4)).toBe('2025-09-14');
		clock.set(new Date(2025, 8, 15, 9, 0));
		expect(todayKey(clock, 4)).toBe('2025-09-15');
	});

	it('formats intervals in readable units', () => {
		expect(formatInterval(1 / 1440)).toBe('1m');
		expect(formatInterval(10 / 1440)).toBe('10m');
		expect(formatInterval(1)).toBe('1d');
		expect(formatInterval(45)).toBe('1.5mo');
		expect(formatInterval(730)).toBe('2.0y');
	});

	it('formats durations', () => {
		expect(formatDuration(5000)).toBe('5s');
		expect(formatDuration(90_000)).toBe('1m 30s');
		expect(formatDuration(3_720_000)).toBe('1h 2m');
	});
});

// ---------------------------------------------------------------- scheduler

describe('scheduler: learning steps and graduation', () => {
	const now = new Date(2025, 5, 1, 9, 0).getTime();

	it('sends a new card to the first learning step on Again', () => {
		const p = previewAnswer(card(), 1, SETTINGS, now);
		expect(p.state).toBe('learning');
		expect(p.step).toBe(0);
		expect(p.due).toBe(now + 1 * MIN_MS);
		expect(p.label).toBe('1m');
	});

	it('uses the average of the first two steps for Hard on step 0', () => {
		const p = previewAnswer(card(), 2, SETTINGS, now);
		// (1 + 10) / 2 = 5.5 minutes
		expect(p.due).toBe(now + 5.5 * MIN_MS);
		expect(p.state).toBe('learning');
	});

	it('moves to the next learning step on Good', () => {
		const p = previewAnswer(card(), 3, SETTINGS, now);
		expect(p.state).toBe('learning');
		expect(p.step).toBe(1);
		expect(p.due).toBe(now + 10 * MIN_MS);
		expect(p.label).toBe('10m');
	});

	it('graduates to the graduating interval from the last learning step on Good', () => {
		const p = previewAnswer(card({ state: 'learning', step: 1 }), 3, SETTINGS, now);
		expect(p.state).toBe('review');
		expect(p.interval).toBe(SETTINGS.graduatingInterval);
		expect(p.label).toBe('1d');
	});

	it('skips to the easy interval on Easy from a new card', () => {
		const p = previewAnswer(card(), 4, SETTINGS, now);
		expect(p.state).toBe('review');
		expect(p.interval).toBe(SETTINGS.easyInterval);
		expect(p.label).toBe('4d');
	});

	it('repeats the current step on Hard when past step 0', () => {
		const p = previewAnswer(card({ state: 'learning', step: 1 }), 2, SETTINGS, now);
		expect(p.state).toBe('learning');
		expect(p.step).toBe(1);
		expect(p.due).toBe(now + 10 * MIN_MS);
	});

	it('handles a single learning step by graduating on Good immediately', () => {
		const single: Settings = { ...SETTINGS, learningSteps: [5] };
		const p = previewAnswer(card(), 3, single, now);
		expect(p.state).toBe('review');
		expect(p.interval).toBe(single.graduatingInterval);
	});
});

describe('scheduler: review intervals, ease and lapses', () => {
	const now = new Date(2025, 5, 1, 9, 0).getTime();
	const review = (patch: Partial<Card> = {}) =>
		card({ state: 'review', interval: 10, ease: 2.5, reps: 3, ...patch });

	it('multiplies by about 1.2 and lowers ease on Hard', () => {
		const p = previewAnswer(review(), 2, SETTINGS, now);
		// 10 * 1.2 = 12, plus seeded fuzz within +/- 2 days
		expect(p.interval).toBeGreaterThanOrEqual(10);
		expect(p.interval).toBeLessThanOrEqual(14);
		expect(p.ease).toBeCloseTo(2.35, 5);
	});

	it('multiplies by the ease on Good and keeps the ease', () => {
		const p = previewAnswer(review(), 3, SETTINGS, now);
		// 10 * 2.5 = 25, fuzz +/- ~4
		expect(p.interval).toBeGreaterThanOrEqual(21);
		expect(p.interval).toBeLessThanOrEqual(29);
		expect(p.ease).toBeCloseTo(2.5, 5);
	});

	it('multiplies by ease and the easy bonus on Easy, and raises ease', () => {
		const p = previewAnswer(review(), 4, SETTINGS, now);
		// 10 * 2.5 * 1.3 = 32.5
		expect(p.interval).toBeGreaterThan(previewAnswer(review(), 3, SETTINGS, now).interval);
		expect(p.ease).toBeCloseTo(2.65, 5);
	});

	it('counts a lapse, lowers ease and enters relearning on Again', () => {
		const p = previewAnswer(review({ lapses: 2 }), 1, SETTINGS, now);
		expect(p.state).toBe('relearning');
		expect(p.lapses).toBe(3);
		expect(p.ease).toBeCloseTo(2.3, 5);
		expect(p.due).toBe(now + 10 * MIN_MS);
		expect(p.interval).toBe(1); // reduced interval after a lapse
	});

	it('never lets the ease fall below the 1.3 floor', () => {
		const p = previewAnswer(review({ ease: 1.35 }), 1, SETTINGS, now);
		expect(p.ease).toBe(MIN_EASE);
		const p2 = previewAnswer(review({ ease: 1.3 }), 2, SETTINGS, now);
		expect(p2.ease).toBe(MIN_EASE);
	});

	it('caps the interval at the configured maximum', () => {
		const p = previewAnswer(review({ interval: 300, ease: 2.8 }), 4, SETTINGS, now);
		expect(p.interval).toBe(SETTINGS.maxInterval);
	});

	it('respects a custom maximum interval', () => {
		const capped: Settings = { ...SETTINGS, maxInterval: 30 };
		const p = previewAnswer(review({ interval: 28 }), 3, capped, now);
		expect(p.interval).toBe(30);
	});

	it('applies the interval modifier', () => {
		const half: Settings = { ...SETTINGS, intervalModifier: 0.5 };
		const normal = previewAnswer(review({ interval: 40 }), 3, SETTINGS, now).interval;
		const slower = previewAnswer(review({ interval: 40 }), 3, half, now).interval;
		expect(slower).toBeLessThan(normal);
	});

	it('always moves a review card forward by at least one day', () => {
		const stubborn: Settings = { ...SETTINGS, hardFactor: 0.5, intervalModifier: 0.5 };
		const p = previewAnswer(review({ interval: 10 }), 2, stubborn, now);
		expect(p.interval).toBeGreaterThan(10);
	});

	it('graduates a relearning card back to review on Good', () => {
		const p = previewAnswer(
			card({ state: 'relearning', step: 0, interval: 3, ease: 2.1 }),
			3,
			SETTINGS,
			now
		);
		expect(p.state).toBe('review');
		expect(p.interval).toBeGreaterThanOrEqual(1);
	});

	it('answers a suspended card using the state it had before suspension', () => {
		const p = previewAnswer(
			card({ state: 'suspended', prevState: 'review', interval: 10, ease: 2.5 }),
			3,
			SETTINGS,
			now
		);
		expect(p.state).toBe('review');
	});
});

describe('scheduler: seeded fuzz and determinism', () => {
	it('returns the same value for the same seed', () => {
		expect(seededUnit('card-7:25')).toBe(seededUnit('card-7:25'));
		expect(seededUnit('card-7:25')).not.toBe(seededUnit('card-8:25'));
	});

	it('keeps seeded values inside [0, 1)', () => {
		for (const seed of ['a', 'bb', 'ccc', 'card-123:40', '']) {
			const v = seededUnit(seed);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});

	it('leaves short intervals exact so a 1-day card stays a 1-day card', () => {
		expect(fuzzInterval(1, 'x')).toBe(1);
		expect(fuzzInterval(2, 'x')).toBe(2);
	});

	it('fuzzes long intervals within a bounded window', () => {
		const fuzzed = fuzzInterval(100, 'card-1:100');
		expect(fuzzed).toBeGreaterThanOrEqual(95);
		expect(fuzzed).toBeLessThanOrEqual(105);
	});

	it('is deterministic across repeated previews, so tests are repeatable', () => {
		const now = new Date(2025, 5, 1).getTime();
		const c = card({ state: 'review', interval: 50, ease: 2.5 });
		const a = previewAnswer(c, 3, SETTINGS, now).interval;
		const b = previewAnswer(c, 3, SETTINGS, now).interval;
		expect(a).toBe(b);
	});

	it('spreads different cards onto different days at the same interval', () => {
		const intervals = new Set(
			Array.from({ length: 12 }, (_, i) => fuzzInterval(60, `card-${i}:60`))
		);
		expect(intervals.size).toBeGreaterThan(1);
	});
});

describe('scheduler: answer buttons and applyAnswer', () => {
	const now = new Date(2025, 5, 1, 9, 0).getTime();

	it('shows all four next intervals in increasing order for a review card', () => {
		const previews = answerPreviews(card({ state: 'review', interval: 10, ease: 2.5 }), SETTINGS, now);
		expect(previews[1].label).toBe('10m');
		expect(previews[2].interval).toBeLessThan(previews[3].interval);
		expect(previews[3].interval).toBeLessThan(previews[4].interval);
	});

	it('does not mutate the input card', () => {
		const c = card({ state: 'review', interval: 10 });
		const frozen = { ...c };
		applyAnswer(c, 1, SETTINGS, now, '2025-06-01');
		expect(c).toEqual(frozen);
	});

	it('increments reps and records the study day', () => {
		const { card: next } = applyAnswer(card(), 3, SETTINGS, now, '2025-06-01');
		expect(next.reps).toBe(1);
		expect(next.lastDay).toBe('2025-06-01');
		expect(next.lastReviewed).toBe(now);
	});

	it('flags the exact answer that crosses the leech threshold', () => {
		const nearly = card({ state: 'review', interval: 5, lapses: SETTINGS.leechThreshold - 1 });
		const result = applyAnswer(nearly, 1, SETTINGS, now, '2025-06-01');
		expect(result.becameLeech).toBe(true);
		expect(isLeech(result.card, SETTINGS)).toBe(true);
		// A second lapse does not re-flag it.
		const again = applyAnswer(result.card, 1, SETTINGS, now, '2025-06-02');
		expect(again.becameLeech).toBe(false);
	});

	it('honours a custom leech threshold', () => {
		const strict: Settings = { ...SETTINGS, leechThreshold: 2 };
		expect(isLeech(card({ lapses: 2 }), strict)).toBe(true);
		expect(isLeech(card({ lapses: 1 }), strict)).toBe(false);
	});
});

describe('scheduler: 60 days of simulated study', () => {
	it('grows intervals sensibly, keeps every card and never exceeds the cap', () => {
		const start = new Date(2025, 0, 6, 9, 0).getTime();
		let cards = Array.from({ length: 20 }, (_, i) =>
			newCard(`sim-${i}`, `note-${i}`, 'd1', 0, i, SETTINGS)
		);
		let answers = 0;

		for (let day = 0; day < 60; day++) {
			const at = start + day * DAY_MS;
			const dayKey = studyDay(at, SETTINGS.dayStartHour);
			cards = cards.map((c) => {
				if (c.state === 'new') {
					// Walk the learning steps to graduation within the day.
					let cur = c;
					let t = at;
					for (let step = 0; step < 4; step++) {
						const res = applyAnswer(cur, 3, SETTINGS, t, dayKey);
						cur = res.card;
						answers++;
						t += 10 * MIN_MS;
						if (cur.state === 'review') break;
					}
					return cur;
				}
				if (c.due <= at) {
					// Mostly Good, with a lapse for every fifth card to exercise relearning.
					const rating = Number(c.id.slice(4)) % 5 === 0 ? 1 : 3;
					const res = applyAnswer(c, rating as 1 | 3, SETTINGS, at, dayKey);
					answers++;
					let cur = res.card;
					if (cur.state === 'relearning') {
						cur = applyAnswer(cur, 3, SETTINGS, at + 10 * MIN_MS, dayKey).card;
						answers++;
					}
					return cur;
				}
				return c;
			});
		}

		expect(cards).toHaveLength(20);
		expect(answers).toBeGreaterThan(100);
		for (const c of cards) {
			expect(c.state).toBe('review');
			expect(c.interval).toBeGreaterThanOrEqual(1);
			expect(c.interval).toBeLessThanOrEqual(SETTINGS.maxInterval);
			expect(c.ease).toBeGreaterThanOrEqual(MIN_EASE);
			expect(Number.isFinite(c.due)).toBe(true);
		}
		// Cards answered only Good should have grown well past the graduating interval.
		const clean = cards.filter((c) => c.lapses === 0);
		expect(clean.length).toBeGreaterThan(0);
		expect(Math.max(...clean.map((c) => c.interval))).toBeGreaterThan(20);
	});
});

// ---------------------------------------------------------------- queue

describe('queue: limits, order and sibling burying', () => {
	const now = new Date(2025, 5, 10, 9, 0).getTime();
	const today = studyDay(now, 4);

	function collection(cardCount: number, state: Card['state'] = 'new'): AppData {
		const d = data({
			decks: [
				{ id: 'd1', name: 'Deck one', description: '', color: '#000', newPerDay: null, createdAt: 0 }
			]
		});
		for (let i = 0; i < cardCount; i++) {
			d.notes.push({
				id: `n${i}`,
				deckId: 'd1',
				type: 'basic',
				front: `Q${i}`,
				back: `A${i}`,
				extra: '',
				imageFront: null,
				imageBack: null,
				tags: [],
				starred: false,
				createdAt: 0,
				updatedAt: 0
			});
			d.cards.push({
				...newCard(`c${i}`, `n${i}`, 'd1', 0, i, SETTINGS),
				state,
				due: state === 'new' ? 0 : now - 1000,
				interval: state === 'review' ? 5 : 0
			});
		}
		return d;
	}

	it('caps new cards at the daily limit', () => {
		const d = collection(50);
		const q = buildQueue(d, { ...DEFAULT_QUEUE_OPTIONS, now, day: today });
		expect(q.counts.new).toBe(SETTINGS.newPerDay);
	});

	it('caps reviews at the maximum reviews per day', () => {
		const d = collection(300, 'review');
		d.settings = { ...SETTINGS, maxReviewsPerDay: 25 };
		const q = buildQueue(d, { ...DEFAULT_QUEUE_OPTIONS, now, day: today });
		expect(q.counts.due).toBeLessThanOrEqual(25);
	});

	it('subtracts work already done today from the limits', () => {
		const d = collection(50);
		d.days = [
			{
				day: today,
				reviews: 10,
				newCards: 15,
				timeMs: 0,
				again: 0,
				hard: 0,
				good: 10,
				easy: 0,
				matureTotal: 0,
				matureCorrect: 0
			}
		];
		const q = buildQueue(d, { ...DEFAULT_QUEUE_OPTIONS, now, day: today });
		expect(q.counts.new).toBe(SETTINGS.newPerDay - 15);
	});

	it('applies the review ceiling to the whole daily queue, new cards included', () => {
		const d = collection(20, 'review');
		for (let i = 0; i < 20; i++) {
			d.notes.push({
				id: `fresh${i}`,
				deckId: 'd1',
				type: 'basic',
				front: `F${i}`,
				back: 'x',
				extra: '',
				imageFront: null,
				imageBack: null,
				tags: [],
				starred: false,
				createdAt: 0,
				updatedAt: 0
			});
			d.cards.push(newCard(`fc${i}`, `fresh${i}`, 'd1', 0, 500 + i, SETTINGS));
		}
		d.settings = { ...SETTINGS, maxReviewsPerDay: 5, newPerDay: 3 };
		const q = buildQueue(d, { ...DEFAULT_QUEUE_OPTIONS, now, day: today });
		expect(q.counts.new + q.counts.due).toBeLessThanOrEqual(5);
		expect(q.cards.length).toBeLessThanOrEqual(5);
	});

	it('honours a per-deck new card override', () => {
		const d = collection(50);
		d.decks[0].newPerDay = 3;
		expect(newLimitFor(d, 'd1')).toBe(3);
		const q = buildQueue(d, { ...DEFAULT_QUEUE_OPTIONS, deckId: 'd1', now, day: today });
		expect(q.counts.new).toBe(3);
	});

	it('puts learning cards due now at the front of the queue', () => {
		const d = collection(10, 'review');
		d.cards[4] = { ...d.cards[4], state: 'learning', due: now - 5000, interval: 0 };
		const q = buildQueue(d, { ...DEFAULT_QUEUE_OPTIONS, now, day: today });
		expect(q.cards[0].id).toBe('c4');
	});

	it('excludes suspended cards', () => {
		const d = collection(5, 'review');
		d.cards[0] = suspendCard(d.cards[0]);
		const q = buildQueue(d, { ...DEFAULT_QUEUE_OPTIONS, now, day: today });
		expect(q.cards.map((c) => c.id)).not.toContain('c0');
	});

	it('excludes cards buried for today and includes them again tomorrow', () => {
		const d = collection(3, 'review');
		d.cards[1] = buryCard(d.cards[1], today);
		expect(buildQueue(d, { ...DEFAULT_QUEUE_OPTIONS, now, day: today }).cards.map((c) => c.id)).not.toContain(
			'c1'
		);
		const tomorrow = addDays(today, 1);
		expect(
			buildQueue(d, { ...DEFAULT_QUEUE_OPTIONS, now: now + DAY_MS, day: tomorrow }).cards.map(
				(c) => c.id
			)
		).toContain('c1');
	});

	it('shows only one sibling of the same note per day', () => {
		const d = collection(1, 'review');
		d.notes[0].type = 'reversed';
		d.cards.push({ ...newCard('c0b', 'n0', 'd1', 1, 1, SETTINGS), state: 'review', due: now - 1000, interval: 5 });
		const q = buildQueue(d, { ...DEFAULT_QUEUE_OPTIONS, now, day: today });
		expect(q.cards).toHaveLength(1);
	});

	it('shows both siblings when bury siblings is off', () => {
		const d = collection(1, 'review');
		d.settings = { ...SETTINGS, burySiblings: false };
		d.cards.push({ ...newCard('c0b', 'n0', 'd1', 1, 1, SETTINGS), state: 'review', due: now - 1000, interval: 5 });
		const q = buildQueue(d, { ...DEFAULT_QUEUE_OPTIONS, now, day: today });
		expect(q.cards).toHaveLength(2);
	});

	it('buries the other cards of a note after one is answered', () => {
		const cards = [
			card({ id: 'a', noteId: 'n1' }),
			card({ id: 'b', noteId: 'n1' }),
			card({ id: 'c', noteId: 'n2' })
		];
		const after = burySiblingsOf(cards, cards[0], today);
		expect(after[1].buriedUntilDay).toBe(addDays(today, 1));
		expect(after[2].buriedUntilDay).toBeNull();
		expect(after[0].buriedUntilDay).toBeNull();
	});

	it('mixes new cards into reviews at the configured ratio', () => {
		const d = collection(10, 'review');
		for (let i = 0; i < 4; i++) {
			d.notes.push({
				id: `nn${i}`,
				deckId: 'd1',
				type: 'basic',
				front: `New${i}`,
				back: 'x',
				extra: '',
				imageFront: null,
				imageBack: null,
				tags: [],
				starred: false,
				createdAt: 0,
				updatedAt: 0
			});
			d.cards.push(newCard(`nc${i}`, `nn${i}`, 'd1', 0, 100 + i, SETTINGS));
		}
		const q = buildQueue(d, { ...DEFAULT_QUEUE_OPTIONS, now, day: today });
		const firstNew = q.cards.findIndex((c) => c.state === 'new');
		// With a ratio of 4, the first new card appears after 4 reviews.
		expect(firstNew).toBe(SETTINGS.newReviewRatio);
	});

	it('resolves a Parent::Child deck family', () => {
		const decks = [
			{ id: 'p', name: 'Biology', description: '', color: '#000', newPerDay: null, createdAt: 0 },
			{ id: 'c', name: 'Biology::Cells', description: '', color: '#000', newPerDay: null, createdAt: 0 },
			{ id: 'o', name: 'Chemistry', description: '', color: '#000', newPerDay: null, createdAt: 0 }
		];
		const family = deckFamily(decks, 'p');
		expect(family?.has('p')).toBe(true);
		expect(family?.has('c')).toBe(true);
		expect(family?.has('o')).toBe(false);
		expect(deckFamily(decks, null)).toBeNull();
	});
});

describe('queue: custom study modes never touch the schedule', () => {
	const now = new Date(2025, 5, 10, 9, 0).getTime();
	const today = studyDay(now, 4);

	function withStates(): AppData {
		const d = data({
			decks: [{ id: 'd1', name: 'D', description: '', color: '#000', newPerDay: null, createdAt: 0 }]
		});
		const specs: { id: string; state: Card['state']; due: number; lapses: number; starred: boolean }[] = [
			{ id: 'future', state: 'review', due: now + 2 * DAY_MS, lapses: 0, starred: false },
			{ id: 'far', state: 'review', due: now + 40 * DAY_MS, lapses: 0, starred: false },
			{ id: 'leech', state: 'review', due: now + 10 * DAY_MS, lapses: 9, starred: false },
			{ id: 'star', state: 'review', due: now + 10 * DAY_MS, lapses: 0, starred: true }
		];
		specs.forEach((spec, i) => {
			d.notes.push({
				id: `n-${spec.id}`,
				deckId: 'd1',
				type: 'basic',
				front: spec.id,
				back: 'a',
				extra: '',
				imageFront: null,
				imageBack: null,
				tags: [],
				starred: spec.starred,
				createdAt: 0,
				updatedAt: 0
			});
			d.cards.push({
				...newCard(spec.id, `n-${spec.id}`, 'd1', 0, i, SETTINGS),
				state: spec.state,
				due: spec.due,
				interval: 10,
				lapses: spec.lapses
			});
		});
		return d;
	}

	it('cram includes every card and reports that it does not affect the schedule', () => {
		const q = buildQueue(withStates(), {
			...DEFAULT_QUEUE_OPTIONS,
			mode: 'cram',
			now,
			day: today
		});
		expect(q.cards).toHaveLength(4);
		expect(q.affectsSchedule).toBe(false);
	});

	it('review ahead includes cards due within N days only', () => {
		const q = buildQueue(withStates(), {
			...DEFAULT_QUEUE_OPTIONS,
			mode: 'ahead',
			aheadDays: 3,
			now,
			day: today
		});
		expect(q.cards.map((c) => c.id)).toEqual(['future']);
		expect(q.affectsSchedule).toBe(false);
	});

	it('leeches only includes cards at or over the threshold', () => {
		const q = buildQueue(withStates(), {
			...DEFAULT_QUEUE_OPTIONS,
			mode: 'leeches',
			now,
			day: today
		});
		expect(q.cards.map((c) => c.id)).toEqual(['leech']);
	});

	it('starred only includes starred notes', () => {
		const q = buildQueue(withStates(), {
			...DEFAULT_QUEUE_OPTIONS,
			mode: 'starred',
			now,
			day: today
		});
		expect(q.cards.map((c) => c.id)).toEqual(['star']);
	});

	it('a normal session reports that it does affect the schedule', () => {
		const q = buildQueue(withStates(), { ...DEFAULT_QUEUE_OPTIONS, now, day: today });
		expect(q.affectsSchedule).toBe(true);
	});
});

describe('queue: card state helpers', () => {
	it('suspends and restores the previous state', () => {
		const c = card({ state: 'review', interval: 12 });
		const s = suspendCard(c);
		expect(s.state).toBe('suspended');
		expect(s.prevState).toBe('review');
		const u = unsuspendCard(s);
		expect(u.state).toBe('review');
		expect(u.prevState).toBeNull();
	});

	it('does not double-suspend', () => {
		const s = suspendCard(card({ state: 'review' }));
		expect(suspendCard(s)).toBe(s);
	});

	it('resets progress back to new while keeping identity and position', () => {
		const c = card({ state: 'review', interval: 60, ease: 1.9, reps: 12, lapses: 4, position: 7 });
		const r = resetCard(c, SETTINGS);
		expect(r.state).toBe('new');
		expect(r.interval).toBe(0);
		expect(r.reps).toBe(0);
		expect(r.lapses).toBe(0);
		expect(r.ease).toBe(SETTINGS.startingEase);
		expect(r.id).toBe(c.id);
		expect(r.position).toBe(7);
	});
});

// ---------------------------------------------------------------- cloze

describe('cloze parsing', () => {
	it('parses a single cloze', () => {
		const r = parseCloze('The capital is {{c1::Paris}}.');
		expect(r.numbers).toEqual([1]);
		expect(r.errors).toEqual([]);
		expect(r.parts).toHaveLength(3);
	});

	it('parses several cloze numbers in order', () => {
		const r = parseCloze('{{c2::Second}} and {{c1::first}} and {{c3::third}}');
		expect(r.numbers).toEqual([1, 2, 3]);
	});

	it('de-duplicates a repeated cloze number', () => {
		const r = parseCloze('{{c1::a}} then {{c1::b}}');
		expect(r.numbers).toEqual([1]);
	});

	it('handles nested braces inside the hidden text', () => {
		const r = parseCloze('A set is {{c1::{{a, b}}}} in maths.');
		expect(r.numbers).toEqual([1]);
		expect(r.parts.find((p) => p.kind === 'cloze')?.text).toBe('{{a, b}}');
	});

	it('reads an optional hint', () => {
		const r = parseCloze('{{c1::Canberra::city}}');
		const part = r.parts.find((p) => p.kind === 'cloze');
		expect(part?.text).toBe('Canberra');
		expect(part?.hint).toBe('city');
	});

	it('reports an unterminated marker', () => {
		const r = parseCloze('Broken {{c1::missing end');
		expect(r.errors.join(' ')).toMatch(/Unterminated/);
	});

	it('reports text with no cloze markers', () => {
		const r = parseCloze('Just plain text');
		expect(r.numbers).toEqual([]);
		expect(r.errors.join(' ')).toMatch(/No cloze markers/);
	});

	it('leaves a stray {{ as literal text', () => {
		const r = parseCloze('Braces {{ here and {{c1::hidden}}');
		expect(r.numbers).toEqual([1]);
		expect(clozePlain('Braces {{ here and {{c1::hidden}}')).toContain('{{');
	});

	it('hides only the target cloze number when rendering', () => {
		const text = 'India: {{c1::New Delhi}}, largest {{c2::Mumbai}}';
		expect(renderCloze(text, 1, false)).toBe('India: [...], largest Mumbai');
		expect(renderCloze(text, 2, false)).toBe('India: New Delhi, largest [...]');
	});

	it('shows the hint instead of [...] when one is given', () => {
		expect(renderCloze('{{c1::Canberra::city}}', 1, false)).toBe('[city]');
	});

	it('reveals the target cloze when asked', () => {
		expect(renderCloze('A {{c1::b}} c', 1, true)).toBe('A b c');
	});

	it('extracts the answer text for one cloze number', () => {
		expect(clozeAnswer('{{c1::alpha}} {{c2::beta}}', 2)).toBe('beta');
	});

	it('strips every marker for plain text previews', () => {
		expect(clozePlain('X {{c1::y}} Z')).toBe('X y Z');
	});
});

// ---------------------------------------------------------------- typed answers

describe('typed answer comparison', () => {
	it('ignores case and surrounding spaces', () => {
		expect(compareTyped('  tokyo ', 'Tokyo').correct).toBe(true);
	});

	it('collapses repeated inner spaces', () => {
		expect(compareTyped('buenos    aires', 'Buenos Aires').correct).toBe(true);
	});

	it('ignores accents when enabled', () => {
		expect(
			compareTyped('cafe', 'café', { ignoreAccents: true, ignorePunctuation: true }).correct
		).toBe(true);
	});

	it('respects accents when disabled', () => {
		expect(
			compareTyped('cafe', 'café', { ignoreAccents: false, ignorePunctuation: true }).correct
		).toBe(false);
	});

	it('ignores punctuation when enabled', () => {
		expect(
			compareTyped('its', "it's", { ignoreAccents: true, ignorePunctuation: true }).correct
		).toBe(true);
	});

	it('respects punctuation when disabled', () => {
		expect(
			compareTyped('its', "it's", { ignoreAccents: true, ignorePunctuation: false }).correct
		).toBe(false);
	});

	it('marks a wrong answer and highlights the difference', () => {
		const r = compareTyped('Kyoto', 'Tokyo');
		expect(r.correct).toBe(false);
		expect(r.diff.some((c) => c.op === 'added')).toBe(true);
		expect(r.diff.some((c) => c.op === 'missing')).toBe(true);
	});

	it('marks missing characters when the answer is too short', () => {
		const r = compareTyped('Toky', 'Tokyo');
		expect(r.correct).toBe(false);
		expect(r.diff.filter((c) => c.op === 'missing').map((c) => c.text)).toEqual(['o']);
	});

	it('marks extra characters when the answer is too long', () => {
		const r = compareTyped('Tokyoo', 'Tokyo');
		expect(r.diff.filter((c) => c.op === 'added').map((c) => c.text)).toEqual(['o']);
	});

	it('treats an empty answer as wrong', () => {
		expect(compareTyped('', 'Tokyo').correct).toBe(false);
	});

	it('keeps Tamil letters intact when stripping accents', () => {
		// Tamil vowel signs are letters, not accents - they must survive normalisation.
		expect(normalise('தமிழ்', { ignoreAccents: true, ignorePunctuation: true })).toBe('தமிழ்');
		expect(compareTyped('தமிழ்', 'தமிழ்').correct).toBe(true);
	});

	it('compares Hindi text correctly', () => {
		expect(compareTyped('नमस्ते', 'नमस्ते').correct).toBe(true);
		expect(compareTyped('नमस्त', 'नमस्ते').correct).toBe(false);
	});
});

// ---------------------------------------------------------------- CSV

describe('CSV parsing', () => {
	it('parses a simple file', () => {
		expect(parseCsv('a,b\n1,2')).toEqual([
			['a', 'b'],
			['1', '2']
		]);
	});

	it('keeps a quoted field containing the delimiter whole', () => {
		expect(parseCsv('"one, two",three')).toEqual([['one, two', 'three']]);
	});

	it('keeps a line break inside a quoted field', () => {
		const rows = parseCsv('front,back\n"line one\nline two",answer');
		expect(rows[1][0]).toBe('line one\nline two');
	});

	it('unescapes doubled quotes', () => {
		expect(parseCsv('"He said ""hi""",x')).toEqual([['He said "hi"', 'x']]);
	});

	it('strips a UTF-8 BOM', () => {
		expect(stripBom('\ufefffront,back')).toBe('front,back');
		expect(parseCsv('\ufefffront,back')[0][0]).toBe('front');
	});

	it('normalises CRLF line endings', () => {
		expect(parseCsv('a,b\r\n1,2')).toEqual([
			['a', 'b'],
			['1', '2']
		]);
	});

	it('parses semicolon separated files', () => {
		expect(parseCsv('a;b', ';')).toEqual([['a', 'b']]);
	});

	it('parses tab separated files', () => {
		expect(parseCsv('a\tb', '\t')).toEqual([['a', 'b']]);
	});

	it('drops blank rows', () => {
		expect(parseCsv('a,b\n\n1,2\n')).toHaveLength(2);
	});

	it('keeps Tamil, Hindi and emoji text intact', () => {
		const rows = parseCsv('front,back\nதமிழ்,Tamil\nनमस्ते,Hello\n"🎉 party",celebration');
		expect(rows[1][0]).toBe('தமிழ்');
		expect(rows[2][0]).toBe('नमस्ते');
		expect(rows[3][0]).toBe('🎉 party');
	});

	it('handles a messy real-world file with quotes, breaks and Tamil together', () => {
		const messy =
			'\ufefffront;back;tags\n"வணக்கம், நண்பரே";"Hello, friend\n(greeting)";"tamil greeting"\n"semi; inside";ok;x';
		expect(detectDelimiter(messy)).toBe(';');
		const rows = parseCsv(messy, ';');
		expect(rows).toHaveLength(3);
		expect(rows[1][0]).toBe('வணக்கம், நண்பரே');
		expect(rows[1][1]).toContain('\n');
		expect(rows[2][0]).toBe('semi; inside');
	});

	it('detects the delimiter, ignoring separators inside quotes', () => {
		expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
		expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
		expect(detectDelimiter('a\tb\tc')).toBe('\t');
		expect(detectDelimiter('"a;b;c;d",x\n"e;f;g;h",y')).toBe(',');
	});

	it('writes CSV, quoting only what needs it', () => {
		expect(toCsv([['plain', 'with,comma', 'say "hi"']])).toBe('plain,"with,comma","say ""hi"""');
	});

	it('round-trips through write and parse', () => {
		const rows = [['a "quoted"', 'two\nlines', 'தமிழ்']];
		expect(parseCsv(toCsv(rows))).toEqual(rows);
	});
});

describe('CSV column mapping and row errors', () => {
	it('detects standard header names', () => {
		expect(detectMapping(['Front', 'Back', 'Tags', 'Deck', 'Extra'])).toEqual([
			'front',
			'back',
			'tags',
			'deck',
			'extra'
		]);
	});

	it('detects common synonyms', () => {
		expect(detectMapping(['Question', 'Answer', 'Notes'])).toEqual(['front', 'back', 'extra']);
	});

	it('falls back to the first two columns when there is no header', () => {
		expect(detectMapping(['', '', ''])).toEqual(['front', 'back', 'ignore']);
	});

	it('recognises a header row', () => {
		expect(looksLikeHeader(['front', 'back'])).toBe(true);
		expect(looksLikeHeader(['Tokyo', 'Japan'])).toBe(false);
	});

	it('maps rows and splits tags on spaces and commas', () => {
		const rows = parseCsv('front,back,tags\nQ,A,"alpha, beta gamma"');
		const result = mapRows(rows, ['front', 'back', 'tags'], true);
		expect(result.rows[0].tags).toEqual(['alpha', 'beta', 'gamma']);
	});

	it('reports a row with an empty front and skips it', () => {
		const rows = parseCsv('front,back\n,A\nQ,B');
		const result = mapRows(rows, ['front', 'back'], true);
		expect(result.rows).toHaveLength(1);
		expect(result.errors[0].line).toBe(2);
		expect(result.errors[0].message).toMatch(/Front is empty/);
	});

	it('reports a row with an empty back and skips it', () => {
		const rows = parseCsv('front,back\nQ,\nR,B');
		const result = mapRows(rows, ['front', 'back'], true);
		expect(result.rows).toHaveLength(1);
		expect(result.errors[0].message).toMatch(/Back is empty/);
	});

	it('tolerates a short row without throwing', () => {
		const result = mapRows([['front', 'back', 'tags'], ['Q', 'A']], ['front', 'back', 'tags'], true);
		expect(result.rows[0].tags).toEqual([]);
	});
});

// ---------------------------------------------------------------- formatting

describe('card text formatting', () => {
	it('escapes HTML so user text can never inject markup', () => {
		expect(escapeHtml('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
		expect(renderCardText('<b>not bold</b>')).not.toContain('<b>');
	});

	it('renders bold and italic', () => {
		expect(renderCardText('**bold**')).toContain('<strong>bold</strong>');
		expect(renderCardText('an *italic* word')).toContain('<em>italic</em>');
	});

	it('renders inline code', () => {
		expect(renderCardText('use `len()`')).toContain('<code class="ff-code">len()</code>');
	});

	it('renders a fenced code block with its content escaped', () => {
		const html = renderCardText('```\nif x < 3:\n    pass\n```');
		expect(html).toContain('<pre class="ff-pre">');
		expect(html).toContain('x &lt; 3');
	});

	it('renders bullet lists', () => {
		const html = renderCardText('- one\n- two');
		expect(html).toContain('<ul class="ff-ul">');
		expect((html.match(/<li>/g) ?? []).length).toBe(2);
	});

	it('keeps single line breaks inside a paragraph', () => {
		expect(renderCardText('one\ntwo')).toContain('one<br>two');
	});

	it('starts a new paragraph after a blank line', () => {
		expect((renderCardText('one\n\ntwo').match(/<p>/g) ?? []).length).toBe(2);
	});

	it('returns an empty string for empty input', () => {
		expect(renderCardText('')).toBe('');
	});

	it('flattens formatting for plain text previews', () => {
		expect(plainText('**bold** and `code`')).toBe('bold and code');
	});
});

// ---------------------------------------------------------------- stats

describe('statistics', () => {
	const today = '2025-06-15';

	function days(entries: [string, number][]) {
		return entries.map(([day, reviews]) => ({
			day,
			reviews,
			newCards: 0,
			timeMs: reviews * 5000,
			again: 0,
			hard: 0,
			good: reviews,
			easy: 0,
			matureTotal: 0,
			matureCorrect: 0
		}));
	}

	it('counts a current streak back from today', () => {
		const s = streak(days([['2025-06-13', 5], ['2025-06-14', 5], [today, 5]]), today);
		expect(s.current).toBe(3);
		expect(s.todayDone).toBe(true);
	});

	it('keeps the streak alive when today has not been studied yet', () => {
		const s = streak(days([['2025-06-13', 5], ['2025-06-14', 5]]), today);
		expect(s.current).toBe(2);
		expect(s.todayDone).toBe(false);
	});

	it('breaks the streak on a missed day', () => {
		const s = streak(days([['2025-06-10', 5], ['2025-06-14', 5], [today, 5]]), today);
		expect(s.current).toBe(2);
		expect(s.longest).toBe(2);
	});

	it('respects a daily goal above one review', () => {
		const d = days([['2025-06-14', 1], [today, 5]]);
		expect(streak(d, today, 3).current).toBe(1);
	});

	it('reports no streak for an empty history', () => {
		expect(streak([], today).current).toBe(0);
		expect(streak([], today).longest).toBe(0);
	});

	it('remembers the longest streak from the past', () => {
		const d = days([
			['2025-06-01', 5],
			['2025-06-02', 5],
			['2025-06-03', 5],
			['2025-06-04', 5],
			[today, 5]
		]);
		expect(streak(d, today).longest).toBe(4);
	});

	it('forecasts due cards per day and counts overdue cards as today', () => {
		const now = new Date(2025, 5, 15, 9, 0).getTime();
		const cards = [
			card({ id: 'a', state: 'review', due: now - 5 * DAY_MS, interval: 30 }),
			card({ id: 'b', state: 'review', due: now + 1 * DAY_MS, interval: 5 }),
			card({ id: 'c', state: 'review', due: now + 1 * DAY_MS, interval: 25 }),
			card({ id: 'd', state: 'new', due: 0, interval: 0 })
		];
		const f = forecast(cards, today, 4, 30);
		expect(f[0].due).toBe(1); // the overdue card
		expect(f[1].due).toBe(2);
		expect(f[1].mature).toBe(1); // only the 25-day card is mature
		expect(f.reduce((s, b) => s + b.due, 0)).toBe(3); // the new card is excluded
	});

	it('breaks cards down by state with young and mature split at 21 days', () => {
		const b = stateBreakdown([
			card({ state: 'new' }),
			card({ state: 'learning' }),
			card({ state: 'relearning' }),
			card({ state: 'review', interval: 10 }),
			card({ state: 'review', interval: 21 }),
			suspendCard(card({ state: 'review' }))
		]);
		expect(b).toMatchObject({ new: 1, learning: 1, relearning: 1, young: 1, mature: 1, suspended: 1 });
		expect(b.total).toBe(6);
	});

	it('buckets intervals and ignores non-review cards', () => {
		const buckets = intervalDistribution([
			card({ state: 'review', interval: 1 }),
			card({ state: 'review', interval: 3 }),
			card({ state: 'review', interval: 200 }),
			card({ state: 'new' })
		]);
		expect(buckets.find((b) => b.label === '1d')?.count).toBe(1);
		expect(buckets.find((b) => b.label === '2-3d')?.count).toBe(1);
		expect(buckets.find((b) => b.label === '4mo+')?.count).toBe(1);
		expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(3);
	});

	it('returns null retention rather than a made-up number when there is no mature data', () => {
		const r = retention(data(), '2025-06-01', today);
		expect(r.percent).toBeNull();
		expect(r.youngPercent).toBeNull();
	});

	it('computes mature retention from the day aggregates', () => {
		const d = data({
			days: [
				{
					day: today,
					reviews: 10,
					newCards: 0,
					timeMs: 0,
					again: 2,
					hard: 0,
					good: 8,
					easy: 0,
					matureTotal: 10,
					matureCorrect: 8
				}
			]
		});
		expect(retention(d, today, today).percent).toBe(80);
	});

	it('builds a 365-day heatmap ending today', () => {
		const cells = heatmap(days([[today, 20]]), today, 365);
		expect(cells).toHaveLength(365);
		expect(cells[364].day).toBe(today);
		expect(cells[364].level).toBeGreaterThan(0);
		expect(cells[0].level).toBe(0);
	});

	it('records an answer into the day aggregate', () => {
		let d = recordDay([], today, { rating: 3, ms: 5000, wasNew: true, prevInterval: 0, fromReview: false });
		expect(d[0]).toMatchObject({ reviews: 1, newCards: 1, good: 1, timeMs: 5000 });
		d = recordDay(d, today, { rating: 1, ms: 3000, wasNew: false, prevInterval: 30, fromReview: true });
		expect(d[0]).toMatchObject({ reviews: 2, again: 1, matureTotal: 1, matureCorrect: 0 });
	});

	it('counts a correct mature answer towards retention', () => {
		const d = recordDay([], today, {
			rating: 4,
			ms: 1000,
			wasNew: false,
			prevInterval: 40,
			fromReview: true
		});
		expect(d[0].matureCorrect).toBe(1);
	});

	it('summarises today, returning null percent when nothing was studied', () => {
		expect(todaySummary([], today).correctPercent).toBeNull();
		const d = days([[today, 4]]);
		expect(todaySummary(d, today).correctPercent).toBe(100);
	});
});

// ---------------------------------------------------------------- backup

describe('JSON backup validation', () => {
	const sample = buildSampleData(new Date(2025, 5, 15, 10, 0).getTime());

	it('accepts a backup this app produced', () => {
		const file = makeBackup(sample, Date.now());
		const r = validateBackup(JSON.stringify(file));
		expect(r.ok).toBe(true);
		expect(r.summary?.decks).toBe(3);
		expect(r.summary?.cards).toBe(sample.cards.length);
	});

	it('accepts a bare AppData payload without the envelope', () => {
		expect(validateBackup(JSON.stringify(sample)).ok).toBe(true);
	});

	it('rejects text that is not JSON', () => {
		const r = validateBackup('this is not json {');
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/not valid JSON/);
	});

	it('rejects truncated JSON', () => {
		const r = validateBackup('{"kind":"flashflow-backup","data":{"decks":[');
		expect(r.ok).toBe(false);
	});

	it('rejects a JSON array', () => {
		expect(validateBackup('[1,2,3]').ok).toBe(false);
	});

	it('rejects a file from a different app', () => {
		const r = validateBackup(JSON.stringify({ kind: 'some-other-app', data: {} }));
		expect(r.error).toMatch(/not a FlashFlow backup/);
	});

	it('rejects a payload missing its card list', () => {
		const r = validateBackup(JSON.stringify({ decks: [], notes: [] }));
		expect(r.error).toMatch(/missing its "cards" list/);
	});

	it('rejects a newer data version', () => {
		const r = validateBackup(JSON.stringify({ version: 99, decks: [], notes: [], cards: [] }));
		expect(r.error).toMatch(/newer version/);
	});

	it('rejects decks without an id or name', () => {
		const r = validateBackup(
			JSON.stringify({ version: 1, decks: [{ color: '#fff' }], notes: [], cards: [] })
		);
		expect(r.error).toMatch(/missing an id or name/);
	});

	it('rejects an empty backup', () => {
		const r = validateBackup(JSON.stringify({ version: 1, decks: [], notes: [], cards: [] }));
		expect(r.error).toMatch(/no decks or cards/);
	});

	it('drops orphaned notes, cards and log entries instead of importing broken data', () => {
		const broken = JSON.parse(JSON.stringify(sample)) as AppData;
		broken.notes.push({ ...broken.notes[0], id: 'orphan-note', deckId: 'missing-deck' });
		broken.cards.push({ ...broken.cards[0], id: 'orphan-card', noteId: 'missing-note' });
		broken.revlog.push({ ...broken.revlog[0], cardId: 'missing-card' });
		const r = validateBackup(JSON.stringify(broken));
		expect(r.ok).toBe(true);
		expect(r.data?.notes.some((n) => n.id === 'orphan-note')).toBe(false);
		expect(r.data?.cards.some((c) => c.id === 'orphan-card')).toBe(false);
		expect(r.data?.revlog.some((e) => e.cardId === 'missing-card')).toBe(false);
	});

	it('merges without overwriting existing cards', () => {
		const current = buildSampleData(new Date(2025, 5, 15, 10, 0).getTime());
		const incoming = buildSampleData(new Date(2025, 5, 15, 10, 0).getTime());
		const merged = mergeBackup(current, incoming);
		// Identical sample content: every note is a duplicate front in the same deck.
		expect(merged.decks).toHaveLength(current.decks.length);
		expect(merged.notes).toHaveLength(current.notes.length);
	});

	it('merges genuinely new decks and cards', () => {
		const current = data({
			decks: [{ id: 'd1', name: 'Mine', description: '', color: '#000', newPerDay: null, createdAt: 0 }]
		});
		const incoming = data({
			decks: [{ id: 'dx', name: 'Theirs', description: '', color: '#111', newPerDay: null, createdAt: 0 }],
			notes: [
				{
					id: 'nx',
					deckId: 'dx',
					type: 'basic',
					front: 'Q',
					back: 'A',
					extra: '',
					imageFront: null,
					imageBack: null,
					tags: [],
					starred: false,
					createdAt: 0,
					updatedAt: 0
				}
			],
			cards: [newCard('cx', 'nx', 'dx', 0, 0, SETTINGS)]
		});
		const merged = mergeBackup(current, incoming);
		expect(merged.decks).toHaveLength(2);
		expect(merged.cards).toHaveLength(1);
	});
});

// ---------------------------------------------------------------- store

describe('StudyStore and migrations', () => {
	it('round-trips data through the in-memory store', () => {
		const store = new MemoryStudyStore();
		const d = buildSampleData(new Date(2025, 5, 15).getTime());
		expect(store.save(d).ok).toBe(true);
		const loaded = store.load();
		expect(loaded?.cards.length).toBe(d.cards.length);
	});

	it('returns null before anything is saved', () => {
		expect(new MemoryStudyStore().load()).toBeNull();
	});

	it('caps the detailed review log before saving', () => {
		const d = emptyData();
		d.revlog = Array.from({ length: REVLOG_CAP + 500 }, (_, i) => ({
			cardId: 'c1',
			at: i,
			rating: 3 as const,
			from: 'review' as const,
			interval: 5,
			prevInterval: 4,
			ms: 1000,
			day: '2025-06-01'
		}));
		expect(trimForStorage(d).revlog).toHaveLength(REVLOG_CAP);
		// The newest entries are the ones kept.
		expect(trimForStorage(d).revlog[REVLOG_CAP - 1].at).toBe(REVLOG_CAP + 499);
	});

	it('reports unavailable storage instead of throwing', () => {
		// In the Node test environment there is no localStorage at all.
		const store = new LocalStudyStore();
		expect(store.isAvailable()).toBe(false);
		const outcome = store.save(emptyData());
		expect(outcome.ok).toBe(false);
		expect(outcome.status).toBe('unavailable');
		expect(store.load()).toBeNull();
	});

	it('fills in missing fields when migrating a partial payload', () => {
		const migrated = migrate({ version: 1, decks: [], notes: [], cards: [] } as unknown as AppData);
		expect(migrated.settings.newPerDay).toBe(DEFAULT_SETTINGS.newPerDay);
		expect(migrated.meta.nextPosition).toBe(0);
		expect(migrated.revlog).toEqual([]);
	});

	it('repairs a card with a broken ease value', () => {
		const migrated = migrate({
			version: 1,
			decks: [],
			notes: [],
			cards: [{ id: 'c', noteId: 'n', deckId: 'd', ease: 0 } as unknown as Card]
		} as unknown as AppData);
		expect(migrated.cards[0].ease).toBe(DEFAULT_SETTINGS.startingEase);
	});
});

// ---------------------------------------------------------------- session timer

describe('session timer', () => {
	it('counts time per card', () => {
		const t = new SessionTimer();
		t.startCard(1000);
		expect(t.cardElapsed(6000)).toBe(5000);
		expect(t.finishCard(6000)).toBe(5000);
		expect(t.elapsed(6000)).toBe(5000);
	});

	it('caps a single card at 60 seconds so idle time is ignored', () => {
		const t = new SessionTimer();
		t.startCard(0);
		expect(t.finishCard(10 * 60_000)).toBe(MAX_MS_PER_CARD);
	});

	it('stops counting while paused and resumes cleanly', () => {
		const t = new SessionTimer();
		t.startCard(0);
		t.pause(4000);
		expect(t.isPaused).toBe(true);
		expect(t.elapsed(60_000)).toBe(4000); // the idle gap is not counted
		t.resume(60_000);
		expect(t.elapsed(63_000)).toBe(7000);
	});

	it('resets to zero', () => {
		const t = new SessionTimer();
		t.startCard(0);
		t.finishCard(5000);
		t.reset();
		expect(t.elapsed(10_000)).toBe(0);
	});
});

// ---------------------------------------------------------------- sample data

describe('sample data', () => {
	const now = new Date(2025, 5, 15, 10, 0).getTime();
	const sample = buildSampleData(now);

	it('creates three decks with about 90 notes', () => {
		expect(sample.decks.map((d) => d.name)).toEqual([
			'World Capitals',
			'Basic Python',
			'Spanish Starter'
		]);
		expect(sample.notes.length).toBeGreaterThanOrEqual(85);
		expect(sample.notes.length).toBeLessThanOrEqual(95);
	});

	it('includes all four card types', () => {
		const types = new Set(sample.notes.map((n) => n.type));
		expect(types).toEqual(new Set(['basic', 'reversed', 'cloze', 'typed']));
	});

	it('creates two cards for every reversed note', () => {
		for (const note of sample.notes.filter((n) => n.type === 'reversed')) {
			expect(sample.cards.filter((c) => c.noteId === note.id)).toHaveLength(2);
		}
	});

	it('creates one card per cloze number', () => {
		for (const note of sample.notes.filter((n) => n.type === 'cloze')) {
			const expected = parseCloze(note.front).numbers.length;
			expect(sample.cards.filter((c) => c.noteId === note.id)).toHaveLength(expected);
		}
	});

	it('generates a review history across the last 60 days', () => {
		expect(sample.revlog.length).toBeGreaterThan(200);
		expect(sample.days.length).toBeGreaterThan(30);
		const oldest = sample.days[0].day;
		expect(daysBetween(oldest, studyDay(now, 4))).toBeLessThanOrEqual(60);
	});

	it('leaves new cards for the first session so the home screen has something due', () => {
		expect(sample.cards.some((c) => c.state === 'new')).toBe(true);
	});

	it('produces at least one leech so the suggestion can be seen', () => {
		expect(sample.cards.some((c) => c.lapses >= sample.settings.leechThreshold)).toBe(true);
	});

	it('keeps every generated interval inside the configured bounds', () => {
		for (const c of sample.cards) {
			expect(c.interval).toBeLessThanOrEqual(sample.settings.maxInterval);
			expect(c.ease).toBeGreaterThanOrEqual(MIN_EASE);
		}
	});

	it('only logs reviews against cards that still exist', () => {
		const ids = new Set(sample.cards.map((c) => c.id));
		expect(sample.revlog.every((r) => ids.has(r.cardId))).toBe(true);
	});

	it('is deterministic for the same timestamp', () => {
		const again = buildSampleData(now);
		expect(again.cards.map((c) => c.interval)).toEqual(sample.cards.map((c) => c.interval));
	});

	it('stays comfortably inside the storage budget', () => {
		const store = new MemoryStudyStore();
		store.save(sample);
		expect(store.usedBytes()).toBeLessThan(1_000_000);
	});
});

// ---------------------------------------------------------------- performance

describe('performance guards', () => {
	it('builds a queue over 10,000 cards quickly', () => {
		const d = data({
			decks: [{ id: 'd1', name: 'Big', description: '', color: '#000', newPerDay: null, createdAt: 0 }]
		});
		const now = new Date(2025, 5, 15, 9, 0).getTime();
		for (let i = 0; i < 10_000; i++) {
			d.notes.push({
				id: `n${i}`,
				deckId: 'd1',
				type: 'basic',
				front: `Q${i}`,
				back: `A${i}`,
				extra: '',
				imageFront: null,
				imageBack: null,
				tags: [],
				starred: false,
				createdAt: 0,
				updatedAt: 0
			});
			d.cards.push({
				...newCard(`c${i}`, `n${i}`, 'd1', 0, i, SETTINGS),
				state: 'review',
				due: now - 1000,
				interval: 10
			});
		}
		const t0 = Date.now();
		const q = buildQueue(d, { ...DEFAULT_QUEUE_OPTIONS, now, day: studyDay(now, 4) });
		const ms = Date.now() - t0;
		expect(q.cards.length).toBeLessThanOrEqual(SETTINGS.maxReviewsPerDay);
		expect(ms).toBeLessThan(3000);
	});

	it('computes a forecast over 10,000 cards quickly', () => {
		const now = new Date(2025, 5, 15, 9, 0).getTime();
		const cards = Array.from({ length: 10_000 }, (_, i) =>
			card({ id: `c${i}`, state: 'review', due: now + (i % 40) * DAY_MS, interval: 10 })
		);
		const t0 = Date.now();
		const f = forecast(cards, studyDay(now, 4), 4, 30);
		expect(Date.now() - t0).toBeLessThan(1500);
		expect(f).toHaveLength(30);
	});
});
