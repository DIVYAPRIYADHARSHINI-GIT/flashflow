// Export helpers: CSV, tab-separated text and the browser download plumbing.
// Everything runs in the browser - nothing is uploaded.

import type { AppData, Deck, Note } from '#lib/types';
import { toCsv, type Delimiter } from './csv';
import { plainText } from './format';

export function download(filename: string, content: string | Blob, mime = 'text/plain') {
	const blob = typeof content === 'string' ? new Blob([content], { type: `${mime};charset=utf-8` }) : content;
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	// Give the browser a moment to start the download before revoking.
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Rows for a deck export: header + one row per note. */
export function deckRows(data: AppData, deckIds: string[] | null): string[][] {
	const decks = new Map(data.decks.map((d) => [d.id, d.name]));
	const notes = deckIds
		? data.notes.filter((n) => deckIds.includes(n.deckId))
		: data.notes;
	const rows: string[][] = [['front', 'back', 'tags', 'deck', 'extra', 'type']];
	for (const n of notes) {
		rows.push([n.front, n.back, n.tags.join(' '), decks.get(n.deckId) ?? '', n.extra, n.type]);
	}
	return rows;
}

export function exportCsv(data: AppData, deckIds: string[] | null, delimiter: Delimiter = ','): string {
	// Excel and most spreadsheets need the BOM to detect UTF-8 (Tamil, Hindi, emoji).
	return `\ufeff${toCsv(deckRows(data, deckIds), delimiter)}`;
}

export function safeFilename(name: string): string {
	return (
		name
			.replace(/::/g, '-')
			.replace(/[^\p{L}\p{N}\-_ ]/gu, '')
			.trim()
			.replace(/\s+/g, '_') || 'flashflow'
	);
}

/** Plain-text summary used by the printable deck list fallback. */
export function deckSummary(data: AppData, deck: Deck): { notes: Note[]; cardCount: number } {
	const notes = data.notes.filter((n) => n.deckId === deck.id);
	const noteIds = new Set(notes.map((n) => n.id));
	return { notes, cardCount: data.cards.filter((c) => noteIds.has(c.noteId)).length };
}

/** Detect text that needs complex-script shaping the generated PDF cannot do. */
export function needsComplexShaping(text: string): boolean {
	// Tamil U+0B80-U+0BFF, Devanagari U+0900-U+097F, plus other Indic / Arabic blocks.
	return /[\u0900-\u097F\u0980-\u0DFF\u0600-\u06FF]/.test(text);
}

export function plainFront(note: Note): string {
	return plainText(note.front);
}
