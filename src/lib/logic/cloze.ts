// Cloze deletion parsing: {{c1::hidden part}} and {{c1::hidden::hint}}.
//
// Requirements: several clozes per note, nested braces inside the hidden text, and clear
// handling of invalid markers (an unterminated {{c1:: is reported, not silently dropped).

export interface ClozePart {
	kind: 'text' | 'cloze';
	text: string;
	/** Cloze number (1 for c1). Only set for kind === 'cloze'. */
	n?: number;
	/** Optional hint shown in place of the hidden text. */
	hint?: string;
}

export interface ClozeParse {
	parts: ClozePart[];
	/** Sorted, de-duplicated cloze numbers found in the text. */
	numbers: number[];
	/** Human-readable problems, e.g. an unterminated marker. */
	errors: string[];
}

const OPEN = '{{';

/**
 * Parse cloze text into parts. Scans manually (not with a regex) so nested braces inside
 * the hidden text, such as {{c1::set {a, b}}}, are matched by brace depth.
 */
export function parseCloze(text: string): ClozeParse {
	const parts: ClozePart[] = [];
	const errors: string[] = [];
	const numbers = new Set<number>();
	let buffer = '';
	let i = 0;

	const flush = () => {
		if (buffer) {
			parts.push({ kind: 'text', text: buffer });
			buffer = '';
		}
	};

	while (i < text.length) {
		if (text.startsWith(OPEN, i)) {
			const m = /^\{\{c(\d+)::/.exec(text.slice(i));
			if (!m) {
				// "{{" that is not a cloze marker - keep it as literal text.
				buffer += text[i];
				i += 1;
				continue;
			}
			const n = parseInt(m[1], 10);
			let j = i + m[0].length;
			let depth = 1;
			let inner = '';
			let closed = false;
			while (j < text.length) {
				if (text.startsWith('{{', j)) {
					depth++;
					inner += '{{';
					j += 2;
					continue;
				}
				if (text.startsWith('}}', j)) {
					depth--;
					if (depth === 0) {
						closed = true;
						j += 2;
						break;
					}
					inner += '}}';
					j += 2;
					continue;
				}
				inner += text[j];
				j += 1;
			}
			if (!closed) {
				errors.push(`Unterminated cloze marker for c${n} - add a closing "}}".`);
				buffer += text.slice(i);
				i = text.length;
				continue;
			}
			// Split off an optional hint at the LAST "::" that is not inside nested braces.
			let hidden = inner;
			let hint: string | undefined;
			const hintAt = inner.lastIndexOf('::');
			if (hintAt > -1 && !inner.slice(hintAt).includes('}}')) {
				hidden = inner.slice(0, hintAt);
				hint = inner.slice(hintAt + 2);
			}
			if (n < 1) {
				errors.push('Cloze numbers start at c1.');
			} else {
				numbers.add(n);
			}
			flush();
			parts.push({ kind: 'cloze', text: hidden, n, hint });
			i = j;
			continue;
		}
		buffer += text[i];
		i += 1;
	}
	flush();

	if (numbers.size === 0 && errors.length === 0) {
		errors.push('No cloze markers found. Wrap the hidden text like {{c1::answer}}.');
	}

	return { parts, numbers: [...numbers].sort((a, b) => a - b), errors };
}

/**
 * Render a cloze note for one cloze number.
 * `reveal` false hides that number (showing [...] or the hint); true shows it.
 * Other cloze numbers are always shown as plain text.
 */
export function renderCloze(text: string, n: number, reveal: boolean): string {
	const { parts } = parseCloze(text);
	return parts
		.map((p) => {
			if (p.kind === 'text') return p.text;
			if (p.n !== n) return p.text;
			if (reveal) return p.text;
			return p.hint ? `[${p.hint}]` : '[...]';
		})
		.join('');
}

/** The hidden answer text for one cloze number (used by typed comparison and the browser). */
export function clozeAnswer(text: string, n: number): string {
	const { parts } = parseCloze(text);
	return parts
		.filter((p) => p.kind === 'cloze' && p.n === n)
		.map((p) => p.text)
		.join(', ');
}

/** Plain text with all cloze markers stripped - used for list previews and search. */
export function clozePlain(text: string): string {
	const { parts } = parseCloze(text);
	return parts.map((p) => p.text).join('');
}
