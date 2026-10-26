// FlashFlow data model.
//
// Design intent from the brief:
// - Everything here is serialised into ONE localStorage key behind the StudyStore
//   interface. No database, no accounts, no uploads.
// - The schema is versioned (DATA_VERSION) and `migrate()` in store/migrations.ts upgrades
//   older payloads, so a server-backed store could be added later without a data reset.
// - Review history is kept compact on purpose: per-card counters live on the card, daily
//   aggregates live in `days`, and the detailed `revlog` is capped (REVLOG_CAP) so a year
//   of study cannot fill localStorage.

export const DATA_VERSION = 1;

/** Newest-first detailed review log cap. Daily aggregates are kept forever (tiny). */
export const REVLOG_CAP = 4000;

export type CardType = 'basic' | 'reversed' | 'cloze' | 'typed';

export type CardState = 'new' | 'learning' | 'review' | 'relearning' | 'suspended';

/** 1 Again, 2 Hard, 3 Good, 4 Easy - matches the on-screen shortcut numbers. */
export type Rating = 1 | 2 | 3 | 4;

export interface Deck {
	id: string;
	/** May use one "Parent::Child" level of nesting. */
	name: string;
	description: string;
	/** Hex colour used for the deck chip. */
	color: string;
	/** Per-deck override for new cards per day; null = use the global setting. */
	newPerDay: number | null;
	createdAt: number;
}

/**
 * A note is the content the user typed. One note produces one or more review cards
 * (siblings): reversed notes produce 2, cloze notes produce one per cloze number.
 */
export interface Note {
	id: string;
	deckId: string;
	type: CardType;
	/** Front / question. For cloze notes this holds the cloze text. */
	front: string;
	/** Back / answer. Unused by cloze notes. */
	back: string;
	/** Optional notes or mnemonic shown under the answer. */
	extra: string;
	/** Optional single compressed image per side (data URL, under ~100KB). */
	imageFront: string | null;
	imageBack: string | null;
	tags: string[];
	starred: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface Card {
	id: string;
	noteId: string;
	deckId: string;
	/**
	 * Which review item of the note this is.
	 * basic/typed: 0. reversed: 0 = front->back, 1 = back->front.
	 * cloze: the cloze number (c1 -> 1).
	 */
	ord: number;
	state: CardState;
	/** State the card had before it was suspended, so unsuspend restores it. */
	prevState: CardState | null;
	/** Epoch ms when the card becomes due. New cards use their creation order instead. */
	due: number;
	/** Current review interval in days (0 while in learning). */
	interval: number;
	/** SM-2 style ease factor, e.g. 2.5. */
	ease: number;
	/** Index into the learning / relearning steps array. */
	step: number;
	reps: number;
	lapses: number;
	lastReviewed: number | null;
	/** Study day (YYYY-MM-DD) this card was last answered on - used to bury siblings. */
	lastDay: string | null;
	/** Set when buried until the end of the given study day. */
	buriedUntilDay: string | null;
	/** Sort order for new cards. */
	position: number;
}

export interface RevlogEntry {
	cardId: string;
	/** Epoch ms of the answer. */
	at: number;
	rating: Rating;
	/** State the card was in BEFORE the answer. */
	from: CardState;
	/** Interval in days AFTER the answer. */
	interval: number;
	/** Interval in days BEFORE the answer (used for retention of mature cards). */
	prevInterval: number;
	/** Time spent on the card in ms, capped at 60s. */
	ms: number;
	/** Study day the answer counted for. */
	day: string;
}

/** Aggregated per study day - cheap to keep forever and powers all the charts. */
export interface DayStat {
	day: string;
	reviews: number;
	newCards: number;
	timeMs: number;
	again: number;
	hard: number;
	good: number;
	easy: number;
	/** Answers on cards whose interval was >= MATURE_DAYS before the answer. */
	matureTotal: number;
	matureCorrect: number;
}

export interface Settings {
	newPerDay: number;
	maxReviewsPerDay: number;
	/** Learning steps in minutes. */
	learningSteps: number[];
	/** Relearning steps in minutes. */
	relearningSteps: number[];
	/** First review interval after graduating with Good, in days. */
	graduatingInterval: number;
	/** Interval when a learning card is answered Easy, in days. */
	easyInterval: number;
	startingEase: number;
	easyBonus: number;
	hardFactor: number;
	intervalModifier: number;
	maxInterval: number;
	leechThreshold: number;
	/** Hour (0-23) at which a new study day starts. */
	dayStartHour: number;
	burySiblings: boolean;
	showNextIntervals: boolean;
	/** New cards mixed in: 1 new card after this many reviews. */
	newReviewRatio: number;
	dailyGoal: number;
	theme: 'light' | 'dark' | 'system';
	cardFont: 'sans' | 'serif';
	cardFontSize: number;
	typedIgnoreAccents: boolean;
	typedIgnorePunctuation: boolean;
	notificationsEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
	newPerDay: 20,
	maxReviewsPerDay: 200,
	learningSteps: [1, 10],
	relearningSteps: [10],
	graduatingInterval: 1,
	easyInterval: 4,
	startingEase: 2.5,
	easyBonus: 1.3,
	hardFactor: 1.2,
	intervalModifier: 1,
	maxInterval: 365,
	leechThreshold: 8,
	dayStartHour: 4,
	burySiblings: true,
	showNextIntervals: true,
	newReviewRatio: 4,
	dailyGoal: 1,
	theme: 'system',
	cardFont: 'sans',
	cardFontSize: 22,
	typedIgnoreAccents: true,
	typedIgnorePunctuation: true,
	notificationsEnabled: false
};

/** Cards with an interval of 21 days or more count as "mature" for retention stats. */
export const MATURE_DAYS = 21;

export interface AppData {
	version: number;
	decks: Deck[];
	notes: Note[];
	cards: Card[];
	revlog: RevlogEntry[];
	days: DayStat[];
	settings: Settings;
	meta: {
		lastBackupAt: number | null;
		sampleDataLoaded: boolean;
		/** Next position number handed to a new card. */
		nextPosition: number;
	};
}
