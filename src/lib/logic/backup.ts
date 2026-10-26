// JSON backup export, validation and import.
//
// Rules from the brief: validate the file and show clear errors, and NEVER silently
// overwrite existing data. The UI always asks for an explicit choice between "Replace
// everything" and "Merge into what I have", and a broken file is rejected with a reason.

import { DATA_VERSION, DEFAULT_SETTINGS, type AppData, type Card, type Deck, type Note } from '#lib/types';
import { migrate } from '#lib/store/migrations';

export const BACKUP_KIND = 'flashflow-backup';

export interface BackupFile {
	kind: typeof BACKUP_KIND;
	version: number;
	exportedAt: string;
	app: string;
	data: AppData;
}

export function makeBackup(data: AppData, at: number): BackupFile {
	return {
		kind: BACKUP_KIND,
		version: DATA_VERSION,
		exportedAt: new Date(at).toISOString(),
		app: 'FlashFlow',
		data
	};
}

export interface ValidationResult {
	ok: boolean;
	/** Clear, user-facing reason when ok is false. */
	error?: string;
	data?: AppData;
	summary?: { decks: number; notes: number; cards: number; reviews: number; days: number };
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate a backup file's text. Accepts either the wrapped backup envelope or a bare
 * AppData payload, and runs schema migrations so older backups still import.
 */
export function validateBackup(text: string): ValidationResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, error: 'That file is not valid JSON. Choose a FlashFlow backup file.' };
	}
	if (!isObject(parsed)) {
		return { ok: false, error: 'The file does not contain a FlashFlow backup object.' };
	}

	const payload = isObject(parsed.data) ? parsed.data : parsed;
	if (parsed.kind && parsed.kind !== BACKUP_KIND) {
		return { ok: false, error: `This looks like a "${String(parsed.kind)}" file, not a FlashFlow backup.` };
	}

	for (const key of ['decks', 'notes', 'cards'] as const) {
		if (!Array.isArray((payload as Record<string, unknown>)[key])) {
			return { ok: false, error: `The backup is missing its "${key}" list.` };
		}
	}

	const version = typeof payload.version === 'number' ? payload.version : 1;
	if (version > DATA_VERSION) {
		return {
			ok: false,
			error: `This backup was made by a newer version of FlashFlow (data version ${version}). Update the app first.`
		};
	}

	const decks = (payload.decks as unknown[]).filter(isObject) as unknown as Deck[];
	const notes = (payload.notes as unknown[]).filter(isObject) as unknown as Note[];
	const cards = (payload.cards as unknown[]).filter(isObject) as unknown as Card[];

	if (decks.some((d) => typeof d.id !== 'string' || typeof d.name !== 'string')) {
		return { ok: false, error: 'One or more decks in the backup are missing an id or name.' };
	}
	if (notes.some((n) => typeof n.id !== 'string' || typeof n.deckId !== 'string')) {
		return { ok: false, error: 'One or more notes in the backup are missing an id or deck.' };
	}
	if (cards.some((c) => typeof c.id !== 'string' || typeof c.noteId !== 'string')) {
		return { ok: false, error: 'One or more cards in the backup are missing an id or note.' };
	}

	const data = migrate({
		version,
		decks,
		notes,
		cards,
		revlog: Array.isArray(payload.revlog) ? (payload.revlog as AppData['revlog']) : [],
		days: Array.isArray(payload.days) ? (payload.days as AppData['days']) : [],
		settings: isObject(payload.settings)
			? { ...DEFAULT_SETTINGS, ...(payload.settings as object) }
			: { ...DEFAULT_SETTINGS },
		meta: isObject(payload.meta)
			? {
					lastBackupAt: null,
					sampleDataLoaded: false,
					nextPosition: 0,
					...(payload.meta as object)
				}
			: { lastBackupAt: null, sampleDataLoaded: false, nextPosition: 0 }
	} as AppData);

	// Drop orphans so an import can never produce cards without a note or deck.
	const deckIds = new Set(data.decks.map((d) => d.id));
	data.notes = data.notes.filter((n) => deckIds.has(n.deckId));
	const noteIds = new Set(data.notes.map((n) => n.id));
	data.cards = data.cards.filter((c) => noteIds.has(c.noteId));
	const cardIds = new Set(data.cards.map((c) => c.id));
	data.revlog = data.revlog.filter((r) => cardIds.has(r.cardId));
	data.meta.nextPosition = Math.max(
		data.meta.nextPosition ?? 0,
		...data.cards.map((c) => c.position + 1),
		0
	);

	if (data.decks.length === 0 && data.cards.length === 0) {
		return { ok: false, error: 'The backup contains no decks or cards.' };
	}

	return {
		ok: true,
		data,
		summary: {
			decks: data.decks.length,
			notes: data.notes.length,
			cards: data.cards.length,
			reviews: data.revlog.length,
			days: data.days.length
		}
	};
}

/**
 * Merge an imported backup into existing data without overwriting anything.
 * Decks match by name; notes and cards keep their ids unless the id already exists, in
 * which case the incoming record is given a suffixed id so nothing is replaced.
 */
export function mergeBackup(current: AppData, incoming: AppData): AppData {
	const out: AppData = {
		...current,
		decks: [...current.decks],
		notes: [...current.notes],
		cards: [...current.cards],
		revlog: [...current.revlog],
		days: [...current.days]
	};

	const deckByName = new Map(out.decks.map((d) => [d.name, d]));
	const deckIdMap = new Map<string, string>();
	for (const d of incoming.decks) {
		const existing = deckByName.get(d.name);
		if (existing) {
			deckIdMap.set(d.id, existing.id);
		} else {
			const id = out.decks.some((x) => x.id === d.id) ? `${d.id}-i` : d.id;
			out.decks.push({ ...d, id });
			deckIdMap.set(d.id, id);
			deckByName.set(d.name, { ...d, id });
		}
	}

	const noteIdMap = new Map<string, string>();
	const existingKeys = new Set(out.notes.map((n) => `${n.deckId}::${n.front.trim().toLowerCase()}`));
	for (const n of incoming.notes) {
		const deckId = deckIdMap.get(n.deckId) ?? n.deckId;
		const key = `${deckId}::${n.front.trim().toLowerCase()}`;
		if (existingKeys.has(key)) continue; // duplicate front in the same deck - skip
		const id = out.notes.some((x) => x.id === n.id) ? `${n.id}-i` : n.id;
		out.notes.push({ ...n, id, deckId });
		noteIdMap.set(n.id, id);
		existingKeys.add(key);
	}

	let position = out.meta.nextPosition ?? 0;
	const cardIdMap = new Map<string, string>();
	for (const c of incoming.cards) {
		const noteId = noteIdMap.get(c.noteId);
		if (!noteId) continue; // its note was skipped as a duplicate
		const id = out.cards.some((x) => x.id === c.id) ? `${c.id}-i` : c.id;
		cardIdMap.set(c.id, id);
		out.cards.push({
			...c,
			id,
			noteId,
			deckId: deckIdMap.get(c.deckId) ?? c.deckId,
			position: position++
		});
	}
	out.meta = { ...out.meta, nextPosition: position };

	for (const r of incoming.revlog) {
		const cardId = cardIdMap.get(r.cardId);
		if (cardId) out.revlog.push({ ...r, cardId });
	}
	out.revlog.sort((a, b) => a.at - b.at);

	// Day aggregates are additive.
	const byDay = new Map(out.days.map((d) => [d.day, { ...d }]));
	for (const d of incoming.days) {
		const existing = byDay.get(d.day);
		if (!existing) {
			byDay.set(d.day, { ...d });
			continue;
		}
		byDay.set(d.day, {
			day: d.day,
			reviews: existing.reviews + d.reviews,
			newCards: existing.newCards + d.newCards,
			timeMs: existing.timeMs + d.timeMs,
			again: existing.again + d.again,
			hard: existing.hard + d.hard,
			good: existing.good + d.good,
			easy: existing.easy + d.easy,
			matureTotal: existing.matureTotal + d.matureTotal,
			matureCorrect: existing.matureCorrect + d.matureCorrect
		});
	}
	out.days = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));

	return out;
}
