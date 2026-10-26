// Statistics: today, forecast, reviews/time per day, retention, card states, interval
// distribution, calendar heatmap and streaks.
//
// Every number here is derived from stored data (day aggregates + the capped revlog).
// Nothing is estimated or invented - when there is no data the caller shows an empty state.

import type { AppData, Card, DayStat } from '#lib/types';
import { MATURE_DAYS } from '#lib/types';
import { addDays, dayRange, daysBetween, lastDays, studyDay } from './day';
import { deckFamily } from './queue';

export function emptyDay(day: string): DayStat {
	return {
		day,
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
}

export function dayStatFor(days: DayStat[], day: string): DayStat {
	return days.find((d) => d.day === day) ?? emptyDay(day);
}

/** Reviews / time per day over the last `count` days, oldest first. */
export function dailySeries(days: DayStat[], endDay: string, count: number): DayStat[] {
	const keys = lastDays(endDay, count);
	return keys.map((k) => dayStatFor(days, k));
}

export interface ForecastBucket {
	day: string;
	/** Review cards due that day. */
	due: number;
	/** Mature portion (interval >= 21d) for the stacked bar. */
	mature: number;
}

/** Due cards for the next `count` days (today first). */
export function forecast(
	cards: Card[],
	todayDay: string,
	dayStartHour: number,
	count = 30
): ForecastBucket[] {
	const keys = dayRange(todayDay, addDays(todayDay, count - 1));
	const index = new Map(keys.map((k, i) => [k, i]));
	const buckets: ForecastBucket[] = keys.map((day) => ({ day, due: 0, mature: 0 }));
	for (const c of cards) {
		if (c.state === 'suspended' || c.state === 'new') continue;
		const key = studyDay(c.due, dayStartHour);
		// Overdue cards count as due today.
		const i = index.has(key) ? index.get(key)! : key < todayDay ? 0 : -1;
		if (i < 0) continue;
		buckets[i].due++;
		if (c.interval >= MATURE_DAYS) buckets[i].mature++;
	}
	return buckets;
}

export interface StateBreakdown {
	new: number;
	learning: number;
	relearning: number;
	young: number;
	mature: number;
	suspended: number;
	total: number;
}

export function stateBreakdown(cards: Card[]): StateBreakdown {
	const out: StateBreakdown = {
		new: 0,
		learning: 0,
		relearning: 0,
		young: 0,
		mature: 0,
		suspended: 0,
		total: cards.length
	};
	for (const c of cards) {
		if (c.state === 'suspended') out.suspended++;
		else if (c.state === 'new') out.new++;
		else if (c.state === 'learning') out.learning++;
		else if (c.state === 'relearning') out.relearning++;
		else if (c.interval >= MATURE_DAYS) out.mature++;
		else out.young++;
	}
	return out;
}

export interface IntervalBucket {
	label: string;
	min: number;
	max: number;
	count: number;
}

export function intervalDistribution(cards: Card[]): IntervalBucket[] {
	const buckets: IntervalBucket[] = [
		{ label: '1d', min: 1, max: 1, count: 0 },
		{ label: '2-3d', min: 2, max: 3, count: 0 },
		{ label: '4-7d', min: 4, max: 7, count: 0 },
		{ label: '1-2w', min: 8, max: 14, count: 0 },
		{ label: '2-3w', min: 15, max: 21, count: 0 },
		{ label: '3w-1mo', min: 22, max: 30, count: 0 },
		{ label: '1-2mo', min: 31, max: 60, count: 0 },
		{ label: '2-4mo', min: 61, max: 120, count: 0 },
		{ label: '4mo+', min: 121, max: Infinity, count: 0 }
	];
	for (const c of cards) {
		if (c.state !== 'review' || c.interval < 1) continue;
		const b = buckets.find((x) => c.interval >= x.min && c.interval <= x.max);
		if (b) b.count++;
	}
	return buckets;
}

export interface Retention {
	matureTotal: number;
	matureCorrect: number;
	/** 0-100, or null when there is no mature data yet. */
	percent: number | null;
	youngTotal: number;
	youngCorrect: number;
	youngPercent: number | null;
}

/** Retention over a day range, computed from the day aggregates + revlog. */
export function retention(data: AppData, fromDay: string, toDay: string): Retention {
	let matureTotal = 0;
	let matureCorrect = 0;
	for (const d of data.days) {
		if (d.day < fromDay || d.day > toDay) continue;
		matureTotal += d.matureTotal;
		matureCorrect += d.matureCorrect;
	}
	let youngTotal = 0;
	let youngCorrect = 0;
	for (const r of data.revlog) {
		if (r.day < fromDay || r.day > toDay) continue;
		if (r.from === 'new' || r.from === 'learning') continue;
		if (r.prevInterval >= MATURE_DAYS) continue;
		youngTotal++;
		if (r.rating > 1) youngCorrect++;
	}
	return {
		matureTotal,
		matureCorrect,
		percent: matureTotal ? Math.round((matureCorrect / matureTotal) * 100) : null,
		youngTotal,
		youngCorrect,
		youngPercent: youngTotal ? Math.round((youngCorrect / youngTotal) * 100) : null
	};
}

export interface StreakInfo {
	current: number;
	longest: number;
	/** True when today's goal is already met. */
	todayDone: boolean;
}

/**
 * A day counts towards the streak when at least `goal` reviews were completed.
 * The current streak is not broken by today being incomplete - it counts back from
 * yesterday in that case, so opening the app in the morning does not show 0.
 */
export function streak(days: DayStat[], todayDay: string, goal = 1): StreakInfo {
	const met = new Set(days.filter((d) => d.reviews >= goal).map((d) => d.day));
	const todayDone = met.has(todayDay);

	let current = 0;
	let cursor = todayDone ? todayDay : addDays(todayDay, -1);
	while (met.has(cursor)) {
		current++;
		cursor = addDays(cursor, -1);
	}

	let longest = 0;
	const sorted = [...met].sort();
	let run = 0;
	let prev: string | null = null;
	for (const day of sorted) {
		run = prev && daysBetween(prev, day) === 1 ? run + 1 : 1;
		longest = Math.max(longest, run);
		prev = day;
	}

	return { current, longest: Math.max(longest, current), todayDone };
}

export interface HeatCell {
	day: string;
	reviews: number;
	/** 0-4 intensity bucket for the heatmap colour. */
	level: number;
}

/** Calendar heatmap data for the last `count` days (default 365). */
export function heatmap(days: DayStat[], endDay: string, count = 365): HeatCell[] {
	const keys = lastDays(endDay, count);
	const byDay = new Map(days.map((d) => [d.day, d.reviews]));
	const values = keys.map((k) => byDay.get(k) ?? 0);
	const max = Math.max(1, ...values);
	return keys.map((day, i) => {
		const reviews = values[i];
		let level = 0;
		if (reviews > 0) level = Math.min(4, 1 + Math.floor((reviews / max) * 3.999));
		return { day, reviews, level };
	});
}

/** Restrict cards to a deck family (used by the per-deck stats views). */
export function cardsForDeck(data: AppData, deckId: string | null): Card[] {
	const family = deckFamily(data.decks, deckId);
	return family ? data.cards.filter((c) => family.has(c.deckId)) : data.cards;
}

export interface TodaySummary {
	reviews: number;
	newCards: number;
	timeMs: number;
	again: number;
	hard: number;
	good: number;
	easy: number;
	/** 0-100 or null when nothing was studied. */
	correctPercent: number | null;
}

export function todaySummary(days: DayStat[], todayDay: string): TodaySummary {
	const d = dayStatFor(days, todayDay);
	const total = d.again + d.hard + d.good + d.easy;
	return {
		reviews: d.reviews,
		newCards: d.newCards,
		timeMs: d.timeMs,
		again: d.again,
		hard: d.hard,
		good: d.good,
		easy: d.easy,
		correctPercent: total ? Math.round(((total - d.again) / total) * 100) : null
	};
}

/** Record one answer into the day aggregate, returning a new array. */
export function recordDay(
	days: DayStat[],
	day: string,
	patch: {
		rating: 1 | 2 | 3 | 4;
		ms: number;
		wasNew: boolean;
		prevInterval: number;
		fromReview: boolean;
	}
): DayStat[] {
	const idx = days.findIndex((d) => d.day === day);
	const base = idx === -1 ? emptyDay(day) : { ...days[idx] };
	base.reviews += 1;
	if (patch.wasNew) base.newCards += 1;
	base.timeMs += patch.ms;
	if (patch.rating === 1) base.again += 1;
	else if (patch.rating === 2) base.hard += 1;
	else if (patch.rating === 3) base.good += 1;
	else base.easy += 1;
	if (patch.fromReview && patch.prevInterval >= MATURE_DAYS) {
		base.matureTotal += 1;
		if (patch.rating > 1) base.matureCorrect += 1;
	}
	const next = idx === -1 ? [...days, base] : days.map((d, i) => (i === idx ? base : d));
	next.sort((a, b) => (a.day < b.day ? -1 : 1));
	return next;
}
