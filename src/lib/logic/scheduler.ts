// FlashFlow scheduler - a simple spaced repetition scheduler in the SM-2 style.
//
// Honest description (also shown on the About page): this is a small, documented scheduler
// in the style of the public SM-2 family. It is a study aid, not a guarantee of memory.
//
// Core rules implemented here:
//   New / learning cards walk configurable learning steps (default 1m, 10m).
//     Again -> back to step 0. Hard -> repeat the current step (or the average of step 0
//     and 1 on the first step). Good -> next step, or graduate with `graduatingInterval`.
//     Easy -> graduate immediately with `easyInterval`.
//   Review cards use an ease factor (default 2.5, floor 1.3) and an interval in days.
//     Again  -> lapse: ease -0.20, interval * 0 (new interval = max(1, old * 0) -> uses
//               `lapseIntervalFactor` 0 => 1 day minimum) and enter relearning steps.
//     Hard   -> interval * hardFactor (1.2), ease -0.15
//     Good   -> interval * ease
//     Easy   -> interval * ease * easyBonus (1.3), ease +0.15
//     All multiplied by `intervalModifier` and capped at `maxInterval` (365 days).
//   Relearning cards walk `relearningSteps`; graduating returns them to review with the
//     reduced post-lapse interval.
//   Long intervals get a small seeded fuzz so cards do not all come back the same day. The
//     fuzz is a deterministic function of the card id + interval, so tests are repeatable.

import type { Card, CardState, Rating, Settings } from '#lib/types';

/** Minimum ease, as in SM-2 implementations. */
export const MIN_EASE = 1.3;

/** Interval multiplier applied to the old interval after a lapse (0 = restart at 1 day). */
export const LAPSE_INTERVAL_FACTOR = 0;

export interface Preview {
	/** Interval in days after this answer (fractional for learning steps). */
	interval: number;
	/** Epoch ms when the card becomes due. */
	due: number;
	state: CardState;
	step: number;
	ease: number;
	lapses: number;
	/** Label shown on the answer button, e.g. "10m" or "6d". */
	label: string;
}

const MIN = 60_000;
const DAY = 86_400_000;

/**
 * Deterministic 32-bit hash -> [0, 1). Seeded by card id + interval so the same card and
 * interval always get the same fuzz, which keeps tests and reloads stable.
 */
export function seededUnit(seed: string): number {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	// xorshift finalise for a better spread on short seeds
	h ^= h >>> 15;
	h = Math.imul(h, 2246822507) >>> 0;
	h ^= h >>> 13;
	return (h >>> 0) / 4294967296;
}

/**
 * Small seeded fuzz so a batch of cards does not all fall due on the same day.
 * Intervals under 3 days are left exact (a 1-day card must stay a 1-day card).
 */
export function fuzzInterval(interval: number, seed: string): number {
	if (interval < 3) return interval;
	let spread: number;
	if (interval < 7) spread = 1;
	else if (interval < 30) spread = Math.max(2, Math.round(interval * 0.15));
	else spread = Math.max(4, Math.round(interval * 0.05));
	const offset = Math.round((seededUnit(seed) * 2 - 1) * spread);
	return Math.max(1, interval + offset);
}

function clampInterval(days: number, settings: Settings): number {
	return Math.min(settings.maxInterval, Math.max(1, Math.round(days)));
}

function stepsFor(state: CardState, settings: Settings): number[] {
	const steps = state === 'relearning' ? settings.relearningSteps : settings.learningSteps;
	return steps.length ? steps : [10];
}

function label(interval: number): string {
	// Learning steps are fractions of a day; show them in minutes/hours.
	const minutes = interval * 1440;
	if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
	if (minutes < 1440) {
		const h = minutes / 60;
		return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
	}
	const d = Math.round(interval);
	if (d < 30) return `${d}d`;
	if (d < 365) return `${(d / 30).toFixed(1)}mo`;
	return `${(d / 365).toFixed(1)}y`;
}

/**
 * Compute what would happen to `card` if answered with `rating` at `now`.
 * Pure: it never mutates the card.
 */
export function previewAnswer(
	card: Card,
	rating: Rating,
	settings: Settings,
	now: number
): Preview {
	const effective: CardState =
		card.state === 'suspended' ? (card.prevState ?? 'new') : card.state;

	if (effective === 'new' || effective === 'learning' || effective === 'relearning') {
		return learningAnswer(card, effective, rating, settings, now);
	}
	return reviewAnswer(card, rating, settings, now);
}

function learningAnswer(
	card: Card,
	effective: CardState,
	rating: Rating,
	settings: Settings,
	now: number
): Preview {
	const isRelearn = effective === 'relearning';
	const steps = stepsFor(isRelearn ? 'relearning' : 'learning', settings);
	const ease = Math.max(MIN_EASE, card.ease || settings.startingEase);
	// A relearning card remembers the interval it should return to after graduating.
	const returnInterval = isRelearn
		? Math.max(1, clampInterval(card.interval, settings))
		: settings.graduatingInterval;

	const atStep = Math.min(Math.max(0, card.step), steps.length - 1);

	const stepResult = (stepIndex: number): Preview => {
		const minutes = steps[Math.min(stepIndex, steps.length - 1)];
		const interval = minutes / 1440;
		return {
			interval,
			due: now + minutes * MIN,
			state: isRelearn ? 'relearning' : 'learning',
			step: stepIndex,
			ease,
			lapses: card.lapses,
			label: label(interval)
		};
	};

	const graduate = (days: number): Preview => {
		const interval = clampInterval(days, settings);
		return {
			// Graduation intervals are exact: "Good 1d" and "Easy 4d" must land on the
			// interval the button promised, so no fuzz is applied here.
			interval,
			due: now + interval * DAY,
			state: 'review',
			step: 0,
			ease,
			lapses: card.lapses,
			label: label(interval)
		};
	};

	switch (rating) {
		case 1:
			return stepResult(0);
		case 2: {
			// Hard repeats the current step. On the very first step with more than one step,
			// use the average of step 0 and step 1 so Hard is not identical to Again.
			if (atStep === 0 && steps.length > 1) {
				const minutes = (steps[0] + steps[1]) / 2;
				const interval = minutes / 1440;
				return {
					interval,
					due: now + minutes * MIN,
					state: isRelearn ? 'relearning' : 'learning',
					step: 0,
					ease,
					lapses: card.lapses,
					label: label(interval)
				};
			}
			return stepResult(atStep);
		}
		case 3: {
			const next = atStep + 1;
			if (next >= steps.length) return graduate(returnInterval);
			return stepResult(next);
		}
		case 4:
			// Easy skips straight to a longer interval. A relearning card returns to its
			// post-lapse interval, bumped by the easy interval if that is larger.
			return graduate(isRelearn ? Math.max(returnInterval, 1) : settings.easyInterval);
	}
}

function reviewAnswer(card: Card, rating: Rating, settings: Settings, now: number): Preview {
	const ease = Math.max(MIN_EASE, card.ease || settings.startingEase);
	const prev = Math.max(1, card.interval || 1);
	const mod = settings.intervalModifier;

	if (rating === 1) {
		// Lapse: count it, lower the ease, and drop into relearning.
		const steps = stepsFor('relearning', settings);
		const minutes = steps[0];
		const newEase = Math.max(MIN_EASE, ease - 0.2);
		const reduced = clampInterval(Math.max(1, prev * LAPSE_INTERVAL_FACTOR), settings);
		return {
			interval: reduced,
			due: now + minutes * MIN,
			state: 'relearning',
			step: 0,
			ease: newEase,
			lapses: card.lapses + 1,
			label: label(minutes / 1440)
		};
	}

	let rawDays: number;
	let newEase = ease;
	if (rating === 2) {
		rawDays = prev * settings.hardFactor * mod;
		newEase = Math.max(MIN_EASE, ease - 0.15);
	} else if (rating === 3) {
		rawDays = prev * ease * mod;
	} else {
		rawDays = prev * ease * settings.easyBonus * mod;
		newEase = ease + 0.15;
	}

	// Always move forward by at least a day so an answer never shortens the schedule.
	const base = clampInterval(Math.max(prev + 1, rawDays), settings);
	// Fuzz is applied inside the cap, so a card already at the maximum stays exactly there
	// rather than being nudged back below it.
	const fuzzed =
		base >= settings.maxInterval
			? settings.maxInterval
			: clampInterval(fuzzInterval(base, `${card.id}:${base}`), settings);

	return {
		interval: fuzzed,
		due: now + fuzzed * DAY,
		state: 'review',
		step: 0,
		ease: newEase,
		lapses: card.lapses,
		label: label(fuzzed)
	};
}

/** The four button labels shown before the user chooses. */
export function answerPreviews(
	card: Card,
	settings: Settings,
	now: number
): Record<Rating, Preview> {
	return {
		1: previewAnswer(card, 1, settings, now),
		2: previewAnswer(card, 2, settings, now),
		3: previewAnswer(card, 3, settings, now),
		4: previewAnswer(card, 4, settings, now)
	};
}

export interface AnswerResult {
	card: Card;
	preview: Preview;
	/** True when this answer pushed the card over the leech threshold. */
	becameLeech: boolean;
}

/**
 * Apply an answer and return a NEW card object (never mutates the input).
 * `day` is the study day the answer counts for - stored so siblings can be buried.
 */
export function applyAnswer(
	card: Card,
	rating: Rating,
	settings: Settings,
	now: number,
	day: string
): AnswerResult {
	const preview = previewAnswer(card, rating, settings, now);
	const next: Card = {
		...card,
		state: preview.state,
		prevState: null,
		due: preview.due,
		interval: preview.interval,
		ease: preview.ease,
		step: preview.step,
		lapses: preview.lapses,
		reps: card.reps + 1,
		lastReviewed: now,
		lastDay: day
	};
	const becameLeech =
		preview.lapses >= settings.leechThreshold && card.lapses < settings.leechThreshold;
	return { card: next, preview, becameLeech };
}

/** Is this card a leech at the configured threshold? */
export function isLeech(card: Card, settings: Settings): boolean {
	return card.lapses >= settings.leechThreshold;
}

/** Fresh card defaults for a new note. */
export function newCard(
	id: string,
	noteId: string,
	deckId: string,
	ord: number,
	position: number,
	settings: Settings
): Card {
	return {
		id,
		noteId,
		deckId,
		ord,
		state: 'new',
		prevState: null,
		due: 0,
		interval: 0,
		ease: settings.startingEase,
		step: 0,
		reps: 0,
		lapses: 0,
		lastReviewed: null,
		lastDay: null,
		buriedUntilDay: null,
		position
	};
}
