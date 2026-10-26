// Typed-answer comparison with a tolerant match and a character-level difference highlight.
//
// Always ignored: letter case and extra / leading / trailing whitespace.
// Optional (Settings): accents (café = cafe) and punctuation (it's = its).

export interface CompareOptions {
	ignoreAccents: boolean;
	ignorePunctuation: boolean;
}

export const DEFAULT_COMPARE: CompareOptions = {
	ignoreAccents: true,
	ignorePunctuation: true
};

const PUNCT = /[.,/#!$%^&*;:{}=\-_`~()?'"¿¡“”‘’…]/g;

/** Normalise a string for comparison. Never used for display. */
export function normalise(s: string, opts: CompareOptions): string {
	let out = s.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
	if (opts.ignoreAccents) {
		// Strip combining marks, but only for Latin-ish text: Indic vowel signs are
		// meaningful letters, so we only remove marks in the Latin-1/Latin-Extended range.
		out = out
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.normalize('NFC');
	}
	if (opts.ignorePunctuation) {
		out = out.replace(PUNCT, '').replace(/\s+/g, ' ').trim();
	}
	return out;
}

export type DiffOp = 'same' | 'added' | 'missing';

export interface DiffChunk {
	op: DiffOp;
	text: string;
}

export interface TypedResult {
	correct: boolean;
	/** Chunks describing the typed answer against the expected answer. */
	diff: DiffChunk[];
	expected: string;
	typed: string;
}

/**
 * Longest common subsequence over characters - fine for flashcard-length answers
 * (guarded to 400 chars so a pasted essay cannot freeze the page).
 */
function lcsDiff(a: string[], b: string[]): DiffChunk[] {
	const n = a.length;
	const m = b.length;
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	const raw: DiffChunk[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			raw.push({ op: 'same', text: a[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			raw.push({ op: 'added', text: a[i] });
			i++;
		} else {
			raw.push({ op: 'missing', text: b[j] });
			j++;
		}
	}
	while (i < n) raw.push({ op: 'added', text: a[i++] });
	while (j < m) raw.push({ op: 'missing', text: b[j++] });

	// Merge neighbouring chunks of the same kind.
	const merged: DiffChunk[] = [];
	for (const chunk of raw) {
		const last = merged[merged.length - 1];
		if (last && last.op === chunk.op) last.text += chunk.text;
		else merged.push({ ...chunk });
	}
	return merged;
}

/** Compare a typed answer with the expected answer. */
export function compareTyped(
	typed: string,
	expected: string,
	opts: CompareOptions = DEFAULT_COMPARE
): TypedResult {
	const correct = normalise(typed, opts) === normalise(expected, opts);
	const a = [...typed.trim()].slice(0, 400);
	const b = [...expected.trim()].slice(0, 400);
	const diff = correct ? [{ op: 'same' as DiffOp, text: typed.trim() }] : lcsDiff(a, b);
	return { correct, diff, expected: expected.trim(), typed: typed.trim() };
}
