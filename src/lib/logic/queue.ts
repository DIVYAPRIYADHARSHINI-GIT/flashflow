// Study queue building: daily limits, study order, sibling burying and custom study modes.
//
// Order rules from the brief:
//   1. Learning / relearning cards that are due NOW come first.
//   2. Then due reviews, mixed with new cards in a configurable ratio
//      (settings.newReviewRatio = reviews between new cards).
//   3. Siblings of the same note are not shown on the same day when burySiblings is on.
//   4. Daily limits: newPerDay (per-deck override allowed) and maxReviewsPerDay.
//
// Custom study modes never change the schedule (the caller passes `affectsSchedule: false`
// and answers are replayed without being written back).

import type { AppData, Card, Deck, DayStat, Settings } from '#lib/types';
import { addDays, studyDay } from './day';

export type StudyMode = 'normal' | 'cram' | 'ahead' | 'leeches' | 'starred';

export interface QueueOptions {
	mode: StudyMode;
	/** Restrict to this deck and its children; null = all decks. */
	deckId: string | null;
	/** Restrict to cards carrying this tag; null = any. */
	tag: string | null;
	/** Review ahead: include cards due within this many days. */
	aheadDays: number;
	now: number;
	day: string;
}

export const DEFAULT_QUEUE_OPTIONS: Omit<QueueOptions, 'now' | 'day'> = {
	mode: 'normal',
	deckId: null,
	tag: null,
	aheadDays: 3
};

export interface Counts {
	/** New cards available today after the daily limit. */
	new: number;
	/** Learning + relearning cards due now (or later today). */
	learning: number;
	/** Review cards due today after the review limit. */
	due: number;
}

/** All descendant deck ids for a deck, using the "Parent::Child" naming convention. */
export function deckFamily(decks: Deck[], deckId: string | null): Set<string> | null {
	if (!deckId) return null;
	const deck = decks.find((d) => d.id === deckId);
	if (!deck) return new Set([deckId]);
	const prefix = `${deck.name}::`;
	const ids = new Set<string>([deck.id]);
	for (const d of decks) if (d.name.startsWith(prefix)) ids.add(d.id);
	return ids;
}

/** Today's counters from the day aggregate (how much of the limit is already used). */
export function usedToday(days: DayStat[], day: string): { reviews: number; newCards: number } {
	const stat = days.find((d) => d.day === day);
	return { reviews: stat?.reviews ?? 0, newCards: stat?.newCards ?? 0 };
}

function matchesFilters(
	card: Card,
	data: AppData,
	notesById: Map<string, AppData['notes'][number]>,
	family: Set<string> | null,
	tag: string | null,
	opts: QueueOptions
): boolean {
	if (family && !family.has(card.deckId)) return false;
	// Indexed lookup: a linear `notes.find` here would make buildQueue O(cards x notes),
	// which freezes the page at 10,000 cards.
	const note = notesById.get(card.noteId);
	if (!note) return false;
	if (tag && !note.tags.includes(tag)) return false;
	if (opts.mode === 'starred' && !note.starred) return false;
	if (opts.mode === 'leeches' && card.lapses < data.settings.leechThreshold) return false;
	return true;
}

/** Effective new-cards-per-day for a deck, honouring the per-deck override. */
export function newLimitFor(data: AppData, deckId: string | null): number {
	if (deckId) {
		const deck = data.decks.find((d) => d.id === deckId);
		if (deck && deck.newPerDay !== null) return deck.newPerDay;
	}
	return data.settings.newPerDay;
}

export interface BuiltQueue {
	cards: Card[];
	counts: Counts;
	/** False for cram / review-ahead / leech / starred sessions. */
	affectsSchedule: boolean;
}

/**
 * Build the ordered study queue.
 *
 * The result is a concrete array so the study screen never has to re-sort; it is rebuilt
 * after each answer only when the card leaves the queue.
 */
export function buildQueue(data: AppData, opts: QueueOptions): BuiltQueue {
	const settings = data.settings;
	const family = deckFamily(data.decks, opts.deckId);
	const affectsSchedule = opts.mode === 'normal';
	const cutoffAhead =
		opts.mode === 'ahead' ? opts.now + Math.max(0, opts.aheadDays) * 86_400_000 : opts.now;

	const notesById = new Map(data.notes.map((n) => [n.id, n]));
	const pool = data.cards.filter((c) =>
		matchesFilters(c, data, notesById, family, opts.tag, opts)
	);

	// Cram / leeches / starred: everything matching, no limits, schedule untouched.
	if (opts.mode === 'cram' || opts.mode === 'leeches' || opts.mode === 'starred') {
		const cards = pool
			.filter((c) => c.state !== 'suspended')
			.slice()
			.sort((a, b) => a.position - b.position);
		return {
			cards,
			counts: { new: 0, learning: 0, due: cards.length },
			affectsSchedule: false
		};
	}

	const active = pool.filter((c) => c.state !== 'suspended');
	// `buriedUntilDay` is the first day the card is available again, so it is included
	// once the current study day has reached it.
	const notBuried = active.filter((c) => !c.buriedUntilDay || c.buriedUntilDay <= opts.day);

	// --- sibling burying: at most one card per note per study day ---
	const seenNotes = new Set<string>();
	if (settings.burySiblings) {
		for (const c of active) {
			if (c.lastDay === opts.day) seenNotes.add(c.noteId);
		}
	}

	const learning: Card[] = [];
	const reviews: Card[] = [];
	const fresh: Card[] = [];

	for (const c of notBuried) {
		if (settings.burySiblings && seenNotes.has(c.noteId) && c.lastDay !== opts.day) continue;
		if (c.state === 'learning' || c.state === 'relearning') {
			if (c.due <= opts.now + 60_000) learning.push(c);
		} else if (c.state === 'review') {
			if (c.due <= cutoffAhead) reviews.push(c);
		} else if (c.state === 'new') {
			fresh.push(c);
		}
	}

	learning.sort((a, b) => a.due - b.due);
	reviews.sort((a, b) => a.due - b.due);
	fresh.sort((a, b) => a.position - b.position);

	// --- daily limits ---
	const used = usedToday(data.days, opts.day);
	const reviewBudget = Math.max(0, settings.maxReviewsPerDay - used.reviews);
	const newBudget = Math.max(0, newLimitFor(data, opts.deckId) - used.newCards);

	const limitedReviews = reviews.slice(0, reviewBudget);
	// The review ceiling applies to the WHOLE daily queue (this is what the Settings page
	// promises), so new cards fill only what is left after the due reviews.
	const newRoom = Math.max(0, reviewBudget - limitedReviews.length);
	const limitedNew = fresh.slice(0, Math.min(newBudget, newRoom));

	// One card per note in a single session, even before any of them is answered.
	const perNote = new Set<string>();
	const dedupe = (list: Card[]) =>
		settings.burySiblings
			? list.filter((c) => {
					if (perNote.has(c.noteId)) return false;
					perNote.add(c.noteId);
					return true;
				})
			: list;

	const dueOrdered = dedupe(limitedReviews);
	const newOrdered = dedupe(limitedNew);

	// --- mix new cards into the reviews at the configured ratio ---
	const mixed: Card[] = [];
	const ratio = Math.max(1, settings.newReviewRatio);
	let ni = 0;
	let ri = 0;
	let sinceNew = 0;
	while (ni < newOrdered.length || ri < dueOrdered.length) {
		const wantNew = ri >= dueOrdered.length || sinceNew >= ratio;
		if (wantNew && ni < newOrdered.length) {
			mixed.push(newOrdered[ni++]);
			sinceNew = 0;
		} else if (ri < dueOrdered.length) {
			mixed.push(dueOrdered[ri++]);
			sinceNew++;
		} else if (ni < newOrdered.length) {
			mixed.push(newOrdered[ni++]);
			sinceNew = 0;
		}
	}

	// Learning cards due now always lead. A learning card seen earlier today is the SAME
	// card coming back for its next step, so it is never filtered out here; only different
	// siblings were already excluded above.
	return {
		cards: [...learning, ...mixed],
		counts: {
			new: newOrdered.length,
			learning: learning.length,
			due: dueOrdered.length
		},
		affectsSchedule
	};
}

/** Deck-list counts without building the whole ordered queue. */
export function deckCounts(data: AppData, deckId: string | null, now: number, day: string): Counts {
	const q = buildQueue(data, { ...DEFAULT_QUEUE_OPTIONS, deckId, now, day });
	return q.counts;
}

/** Bury a card until the end of the current study day. */
export function buryCard(card: Card, day: string): Card {
	return { ...card, buriedUntilDay: addDays(day, 1) };
}

/** Bury every other card of the same note for today (used after answering). */
export function burySiblingsOf(cards: Card[], card: Card, day: string): Card[] {
	return cards.map((c) =>
		c.noteId === card.noteId && c.id !== card.id && c.state !== 'suspended'
			? { ...c, buriedUntilDay: addDays(day, 1) }
			: c
	);
}

export function suspendCard(card: Card): Card {
	if (card.state === 'suspended') return card;
	return { ...card, prevState: card.state, state: 'suspended' };
}

export function unsuspendCard(card: Card): Card {
	if (card.state !== 'suspended') return card;
	return { ...card, state: card.prevState ?? 'new', prevState: null };
}

/** Reset a card's progress back to new, keeping its identity and position. */
export function resetCard(card: Card, settings: Settings): Card {
	return {
		...card,
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
		buriedUntilDay: null
	};
}

/** Day key a card is due on, for the forecast. */
export function cardDueDay(card: Card, dayStartHour: number): string {
	return studyDay(card.due, dayStartHour);
}
