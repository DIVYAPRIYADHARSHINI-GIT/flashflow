// The single reactive app state object. Everything the UI reads comes from here, and every
// write goes through the StudyStore (localStorage) with debounced saving.
//
// Reactivity rules used throughout to avoid loops / freezes:
// - Mutations are plain function calls, never $effect side effects.
// - Derived values in components use $derived, which never writes back to state.
// - Saving is debounced and happens outside the reactive graph (setTimeout).

import {
	DEFAULT_SETTINGS,
	MATURE_DAYS,
	REVLOG_CAP,
	type AppData,
	type Card,
	type CardType,
	type Deck,
	type Note,
	type Rating,
	type Settings
} from '#lib/types';
import {
	LocalStudyStore,
	MemoryStudyStore,
	SIZE_WARN_BYTES,
	STORAGE_BUDGET_BYTES,
	emptyData,
	type SaveOutcome,
	type StudyStore
} from './study-store';
import { buildSampleData } from '#lib/logic/sample-data';
import { applyAnswer, newCard, previewAnswer } from '#lib/logic/scheduler';
import { parseCloze } from '#lib/logic/cloze';
import { recordDay } from '#lib/logic/stats';
import { studyDay, systemClock, type Clock } from '#lib/logic/day';
import { burySiblingsOf, resetCard, suspendCard, unsuspendCard } from '#lib/logic/queue';
import { makeBackup, mergeBackup, type BackupFile } from '#lib/logic/backup';

export const BACKUP_REMINDER_DAYS = 7;

export type Toast = { id: number; kind: 'info' | 'success' | 'error'; text: string };

export interface UndoEntry {
	/** The card exactly as it was before the answer. */
	card: Card;
	/** Note tags before the answer (the leech tag may have been added). */
	noteTags: string[];
	noteId: string;
	day: string;
	rating: Rating;
	/** Index of the revlog entry that was appended. */
	revlogLength: number;
}

const DECK_COLORS = [
	'#2F6FED',
	'#2F9E44',
	'#F59F00',
	'#E03131',
	'#7048E8',
	'#0CA678',
	'#1C7ED6',
	'#D6336C'
];

function uid(prefix: string): string {
	return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

class AppState {
	data = $state<AppData>(emptyData());
	loaded = $state(false);
	storeAvailable = $state(true);
	saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	saveMessage = $state<string | null>(null);
	toasts = $state<Toast[]>([]);
	/** Set after an answer so Undo can revert exactly one step. */
	undo = $state<UndoEntry | null>(null);

	private store: StudyStore =
		typeof localStorage === 'undefined' ? new MemoryStudyStore() : new LocalStudyStore();
	private clock: Clock = systemClock;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private toastSeq = 0;

	/** Tests inject a fixed clock. */
	setClock(clock: Clock) {
		this.clock = clock;
	}

	now(): number {
		return this.clock.now();
	}

	get settings(): Settings {
		return this.data.settings;
	}

	get today(): string {
		return studyDay(this.now(), this.data.settings.dayStartHour);
	}

	// ---------------------------------------------------------------- lifecycle

	init() {
		if (this.loaded) return;
		this.storeAvailable = this.store.isAvailable();
		const existing = this.store.load();
		if (existing) {
			this.data = existing;
			this.sizeBytes = this.store.usedBytes();
		} else {
			// First open: pre-load the sample decks so every screen has real content.
			this.data = buildSampleData(this.now());
			this.persistNow();
		}
		this.loaded = true;
	}

	/** Replace the whole payload (backup restore, start fresh, sample reload). */
	replaceAll(data: AppData) {
		this.data = data;
		this.persistNow();
	}

	private schedulePersist() {
		if (this.timer) clearTimeout(this.timer);
		this.saveState = 'saving';
		this.timer = setTimeout(() => this.persistNow(), 400);
	}

	private persistNow() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		const outcome: SaveOutcome = this.store.save($state.snapshot(this.data) as AppData);
		if (outcome.bytes !== undefined) this.sizeBytes = outcome.bytes;
		if (outcome.ok) {
			this.saveState = 'saved';
			this.saveMessage = null;
		} else {
			this.saveState = 'error';
			this.saveMessage = outcome.message ?? 'Changes could not be saved.';
			this.toast('error', this.saveMessage);
		}
	}

	/** Called by every mutation below. */
	private touch() {
		// Keep the detailed log bounded in memory too, not just on disk.
		if (this.data.revlog.length > REVLOG_CAP + 500) {
			this.data.revlog = this.data.revlog.slice(-REVLOG_CAP);
		}
		this.schedulePersist();
	}

	// ---------------------------------------------------------------- storage info

	/**
	 * Serialised size, recomputed only after a save.
	 *
	 * This used to stringify the whole payload on every read. The layout reads it on every
	 * reactive update to decide whether to show the "storage getting full" banner, so with
	 * 10,000 cards that was a multi-megabyte JSON.stringify per keystroke - the one thing
	 * that actually froze the page. It is now a plain number updated when the data is
	 * written, which is the only time it can change.
	 */
	sizeBytes = $state(0);

	get usedBytes(): number {
		return this.sizeBytes;
	}

	get storagePercent(): number {
		return Math.min(100, Math.round((this.sizeBytes / STORAGE_BUDGET_BYTES) * 100));
	}

	get storageNearlyFull(): boolean {
		return this.sizeBytes >= SIZE_WARN_BYTES;
	}

	get daysSinceBackup(): number | null {
		const at = this.data.meta.lastBackupAt;
		if (!at) return null;
		return Math.floor((this.now() - at) / 86_400_000);
	}

	get needsBackupReminder(): boolean {
		const days = this.daysSinceBackup;
		return days === null || days >= BACKUP_REMINDER_DAYS;
	}

	// ---------------------------------------------------------------- toasts

	toast(kind: Toast['kind'], text: string) {
		const id = ++this.toastSeq;
		this.toasts = [...this.toasts, { id, kind, text }];
		setTimeout(() => {
			this.toasts = this.toasts.filter((t) => t.id !== id);
		}, 4200);
	}

	dismissToast(id: number) {
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}

	// ---------------------------------------------------------------- decks

	deck(id: string): Deck | undefined {
		return this.data.decks.find((d) => d.id === id);
	}

	deckName(id: string): string {
		return this.deck(id)?.name ?? 'Unknown deck';
	}

	createDeck(name: string, description = '', color?: string): Deck {
		const trimmed = name.trim();
		const deck: Deck = {
			id: uid('deck'),
			name: trimmed,
			description: description.trim(),
			color: color ?? DECK_COLORS[this.data.decks.length % DECK_COLORS.length],
			newPerDay: null,
			createdAt: this.now()
		};
		this.data.decks = [...this.data.decks, deck];
		this.touch();
		return deck;
	}

	/** Find an existing deck by name or create it (used by CSV import). */
	ensureDeck(name: string): Deck {
		const trimmed = name.trim();
		const found = this.data.decks.find((d) => d.name.toLowerCase() === trimmed.toLowerCase());
		return found ?? this.createDeck(trimmed);
	}

	updateDeck(id: string, patch: Partial<Omit<Deck, 'id'>>) {
		const before = this.deck(id);
		if (!before) return;
		const renamed = patch.name !== undefined && patch.name.trim() !== before.name;
		const oldPrefix = `${before.name}::`;
		this.data.decks = this.data.decks.map((d) => (d.id === id ? { ...d, ...patch } : d));
		// Renaming a parent renames its children so the "Parent::Child" tree stays intact.
		if (renamed && patch.name) {
			const newName = patch.name.trim();
			this.data.decks = this.data.decks.map((d) =>
				d.id !== id && d.name.startsWith(oldPrefix)
					? { ...d, name: `${newName}::${d.name.slice(oldPrefix.length)}` }
					: d
			);
		}
		this.touch();
	}

	duplicateDeck(id: string) {
		const deck = this.deck(id);
		if (!deck) return;
		const copy = this.createDeck(`${deck.name} copy`, deck.description, deck.color);
		const notes = this.data.notes.filter((n) => n.deckId === id);
		for (const note of notes) {
			this.createNote({
				deckId: copy.id,
				type: note.type,
				front: note.front,
				back: note.back,
				extra: note.extra,
				tags: [...note.tags],
				imageFront: note.imageFront,
				imageBack: note.imageBack,
				starred: note.starred
			});
		}
		this.toast('success', `Duplicated "${deck.name}" with ${notes.length} notes.`);
	}

	deleteDeck(id: string) {
		const family = this.data.decks.filter((d) => d.id === id || d.name.startsWith(`${this.deckName(id)}::`));
		const ids = new Set(family.map((d) => d.id));
		const noteIds = new Set(this.data.notes.filter((n) => ids.has(n.deckId)).map((n) => n.id));
		const cardIds = new Set(this.data.cards.filter((c) => noteIds.has(c.noteId)).map((c) => c.id));
		this.data.decks = this.data.decks.filter((d) => !ids.has(d.id));
		this.data.notes = this.data.notes.filter((n) => !noteIds.has(n.id));
		this.data.cards = this.data.cards.filter((c) => !cardIds.has(c.id));
		this.data.revlog = this.data.revlog.filter((r) => !cardIds.has(r.cardId));
		this.touch();
	}

	// ---------------------------------------------------------------- notes & cards

	note(id: string): Note | undefined {
		return this.data.notes.find((n) => n.id === id);
	}

	noteOf(card: Card): Note | undefined {
		return this.note(card.noteId);
	}

	cardsOfNote(noteId: string): Card[] {
		return this.data.cards.filter((c) => c.noteId === noteId);
	}

	/** Ordinals a note of this type should have. */
	ordinalsFor(type: CardType, front: string): number[] {
		if (type === 'reversed') return [0, 1];
		if (type === 'cloze') {
			const nums = parseCloze(front).numbers;
			return nums.length ? nums : [1];
		}
		return [0];
	}

	/** True when the same front text already exists in the deck. */
	isDuplicate(deckId: string, front: string, exceptNoteId?: string): boolean {
		const key = front.trim().toLowerCase();
		if (!key) return false;
		return this.data.notes.some(
			(n) => n.deckId === deckId && n.id !== exceptNoteId && n.front.trim().toLowerCase() === key
		);
	}

	createNote(input: {
		deckId: string;
		type: CardType;
		front: string;
		back?: string;
		extra?: string;
		tags?: string[];
		imageFront?: string | null;
		imageBack?: string | null;
		starred?: boolean;
	}): Note {
		const now = this.now();
		const note: Note = {
			id: uid('note'),
			deckId: input.deckId,
			type: input.type,
			front: input.front,
			back: input.back ?? '',
			extra: input.extra ?? '',
			imageFront: input.imageFront ?? null,
			imageBack: input.imageBack ?? null,
			tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
			starred: input.starred ?? false,
			createdAt: now,
			updatedAt: now
		};
		this.data.notes = [...this.data.notes, note];
		const cards = this.ordinalsFor(note.type, note.front).map((ord) =>
			newCard(uid('card'), note.id, note.deckId, ord, this.data.meta.nextPosition++, this.data.settings)
		);
		this.data.cards = [...this.data.cards, ...cards];
		this.touch();
		return note;
	}

	updateNote(id: string, patch: Partial<Omit<Note, 'id' | 'createdAt'>>) {
		const before = this.note(id);
		if (!before) return;
		const next: Note = { ...before, ...patch, updatedAt: this.now() };
		this.data.notes = this.data.notes.map((n) => (n.id === id ? next : n));

		// Changing type / cloze numbers changes which cards exist. Keep progress on the
		// cards that survive; add new ones; remove the ones that no longer apply.
		const wanted = this.ordinalsFor(next.type, next.front);
		const existing = this.cardsOfNote(id);
		const keep = new Set(wanted);
		const have = new Set(existing.map((c) => c.ord));
		const removed = existing.filter((c) => !keep.has(c.ord)).map((c) => c.id);
		if (removed.length) {
			const removedSet = new Set(removed);
			this.data.cards = this.data.cards.filter((c) => !removedSet.has(c.id));
			this.data.revlog = this.data.revlog.filter((r) => !removedSet.has(r.cardId));
		}
		const added = wanted
			.filter((o) => !have.has(o))
			.map((ord) =>
				newCard(uid('card'), id, next.deckId, ord, this.data.meta.nextPosition++, this.data.settings)
			);
		if (added.length) this.data.cards = [...this.data.cards, ...added];
		// Moving a note to a different deck moves its cards too.
		if (patch.deckId) {
			this.data.cards = this.data.cards.map((c) =>
				c.noteId === id ? { ...c, deckId: next.deckId } : c
			);
		}
		this.touch();
	}

	deleteNotes(noteIds: string[]) {
		const ids = new Set(noteIds);
		const cardIds = new Set(this.data.cards.filter((c) => ids.has(c.noteId)).map((c) => c.id));
		this.data.notes = this.data.notes.filter((n) => !ids.has(n.id));
		this.data.cards = this.data.cards.filter((c) => !cardIds.has(c.id));
		this.data.revlog = this.data.revlog.filter((r) => !cardIds.has(r.cardId));
		this.touch();
	}

	toggleStar(noteId: string) {
		const note = this.note(noteId);
		if (!note) return;
		this.updateNote(noteId, { starred: !note.starred });
	}

	// ------------------------------------------------- bulk card actions (browser)

	private patchCards(cardIds: string[], fn: (c: Card) => Card) {
		const ids = new Set(cardIds);
		this.data.cards = this.data.cards.map((c) => (ids.has(c.id) ? fn(c) : c));
		this.touch();
	}

	suspend(cardIds: string[]) {
		this.patchCards(cardIds, suspendCard);
	}

	unsuspend(cardIds: string[]) {
		this.patchCards(cardIds, unsuspendCard);
	}

	resetProgress(cardIds: string[]) {
		this.patchCards(cardIds, (c) => resetCard(c, this.data.settings));
	}

	moveCards(cardIds: string[], deckId: string) {
		const ids = new Set(cardIds);
		const noteIds = new Set(this.data.cards.filter((c) => ids.has(c.id)).map((c) => c.noteId));
		this.data.notes = this.data.notes.map((n) => (noteIds.has(n.id) ? { ...n, deckId } : n));
		this.data.cards = this.data.cards.map((c) => (noteIds.has(c.noteId) ? { ...c, deckId } : c));
		this.touch();
	}

	tagCards(cardIds: string[], tag: string, add = true) {
		const clean = tag.trim();
		if (!clean) return;
		const ids = new Set(cardIds);
		const noteIds = new Set(this.data.cards.filter((c) => ids.has(c.id)).map((c) => c.noteId));
		this.data.notes = this.data.notes.map((n) => {
			if (!noteIds.has(n.id)) return n;
			const has = n.tags.includes(clean);
			if (add && !has) return { ...n, tags: [...n.tags, clean] };
			if (!add && has) return { ...n, tags: n.tags.filter((t) => t !== clean) };
			return n;
		});
		this.touch();
	}

	deleteCards(cardIds: string[]) {
		const ids = new Set(cardIds);
		// Delete the whole note when all of its cards are selected.
		const noteIds = new Set(this.data.cards.filter((c) => ids.has(c.id)).map((c) => c.noteId));
		const fullySelected = [...noteIds].filter((nid) =>
			this.cardsOfNote(nid).every((c) => ids.has(c.id))
		);
		this.data.cards = this.data.cards.filter((c) => !ids.has(c.id));
		this.data.revlog = this.data.revlog.filter((r) => !ids.has(r.cardId));
		const fully = new Set(fullySelected);
		this.data.notes = this.data.notes.filter((n) => !fully.has(n.id));
		this.touch();
	}

	bury(cardIds: string[]) {
		const until = this.today;
		this.patchCards(cardIds, (c) => ({ ...c, buriedUntilDay: nextDay(until) }));
	}

	// ---------------------------------------------------------------- answering

	/**
	 * Answer one card. `affectsSchedule` false (custom study) records nothing and changes
	 * nothing - the card is only removed from the in-memory session queue by the caller.
	 */
	answer(cardId: string, rating: Rating, elapsedMs: number, affectsSchedule = true) {
		const card = this.data.cards.find((c) => c.id === cardId);
		if (!card) return null;
		const now = this.now();
		const day = this.today;
		const preview = previewAnswer($state.snapshot(card) as Card, rating, this.data.settings, now);
		if (!affectsSchedule) return preview;

		const note = this.noteOf(card);
		const before = $state.snapshot(card) as Card;
		const result = applyAnswer(before, rating, this.data.settings, now, day);
		const ms = Math.min(60_000, Math.max(0, elapsedMs));

		this.undo = {
			card: before,
			noteId: before.noteId,
			noteTags: note ? [...note.tags] : [],
			day,
			rating,
			revlogLength: this.data.revlog.length
		};

		let cards = this.data.cards.map((c) => (c.id === cardId ? result.card : c));
		if (this.data.settings.burySiblings) {
			cards = burySiblingsOf(cards, result.card, day);
		}
		this.data.cards = cards;

		this.data.revlog = [
			...this.data.revlog,
			{
				cardId,
				at: now,
				rating,
				from: before.state,
				interval: result.card.interval,
				prevInterval: before.interval,
				ms,
				day
			}
		];
		this.data.days = recordDay(this.data.days, day, {
			rating,
			ms,
			wasNew: before.state === 'new',
			prevInterval: before.interval,
			fromReview: before.state === 'review' || before.state === 'relearning'
		});

		if (result.becameLeech && note && !note.tags.includes('leech')) {
			this.data.notes = this.data.notes.map((n) =>
				n.id === note.id ? { ...n, tags: [...n.tags, 'leech'] } : n
			);
		}

		this.touch();
		return { ...preview, becameLeech: result.becameLeech };
	}

	/**
	 * Undo exactly the last answer. The day aggregate is reversed too, and a row that ends
	 * up completely empty is removed so the stored history is byte-identical to before.
	 */
	undoLast(): boolean {
		const entry = this.undo;
		if (!entry) return false;
		const stored = this.data.revlog[entry.revlogLength];
		this.data.cards = this.data.cards.map((c) => (c.id === entry.card.id ? entry.card : c));
		this.data.revlog = this.data.revlog.filter((_, i) => i !== entry.revlogLength);
		this.data.notes = this.data.notes.map((n) =>
			n.id === entry.noteId ? { ...n, tags: [...entry.noteTags] } : n
		);
		// Reverse the day aggregate.
		if (stored) {
			this.data.days = this.data.days.map((d) => {
				if (d.day !== entry.day) return d;
				const mature =
					(stored.from === 'review' || stored.from === 'relearning') &&
					stored.prevInterval >= MATURE_DAYS;
				return {
					...d,
					reviews: Math.max(0, d.reviews - 1),
					newCards: Math.max(0, d.newCards - (entry.card.state === 'new' ? 1 : 0)),
					timeMs: Math.max(0, d.timeMs - stored.ms),
					again: Math.max(0, d.again - (stored.rating === 1 ? 1 : 0)),
					hard: Math.max(0, d.hard - (stored.rating === 2 ? 1 : 0)),
					good: Math.max(0, d.good - (stored.rating === 3 ? 1 : 0)),
					easy: Math.max(0, d.easy - (stored.rating === 4 ? 1 : 0)),
					matureTotal: Math.max(0, d.matureTotal - (mature ? 1 : 0)),
					matureCorrect: Math.max(0, d.matureCorrect - (mature && stored.rating > 1 ? 1 : 0))
				};
			});
			// Drop a row that the undo emptied, so undoing the first answer of the day leaves
			// no trace in the history at all.
			this.data.days = this.data.days.filter((d) => d.reviews > 0 || d.timeMs > 0);
		}
		this.undo = null;
		this.touch();
		return true;
	}

	// ---------------------------------------------------------------- settings & data

	updateSettings(patch: Partial<Settings>) {
		this.data.settings = { ...this.data.settings, ...patch };
		this.touch();
	}

	resetSettings() {
		this.data.settings = { ...DEFAULT_SETTINGS };
		this.touch();
	}

	loadSampleData() {
		this.replaceAll(buildSampleData(this.now()));
		this.toast('success', 'Sample decks loaded.');
	}

	startFresh() {
		const fresh = emptyData();
		fresh.settings = { ...this.data.settings };
		this.replaceAll(fresh);
		this.toast('success', 'All data cleared. You are starting fresh.');
	}

	markBackedUp() {
		this.data.meta = { ...this.data.meta, lastBackupAt: this.now() };
		this.touch();
	}

	buildBackup(): BackupFile {
		return makeBackup($state.snapshot(this.data) as AppData, this.now());
	}

	importBackup(incoming: AppData, mode: 'replace' | 'merge') {
		if (mode === 'replace') {
			this.replaceAll(incoming);
		} else {
			this.replaceAll(mergeBackup($state.snapshot(this.data) as AppData, incoming));
		}
	}

	/** All tags in use, sorted, with counts. */
	get allTags(): { tag: string; count: number }[] {
		const counts = new Map<string, number>();
		for (const n of this.data.notes) {
			for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
		}
		return [...counts.entries()]
			.map(([tag, count]) => ({ tag, count }))
			.sort((a, b) => a.tag.localeCompare(b.tag));
	}
}

function nextDay(day: string): string {
	const [y, m, d] = day.split('-').map((p) => parseInt(p, 10));
	const next = new Date(y, m - 1, d + 1, 12);
	const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
	return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

export const app = new AppState();
