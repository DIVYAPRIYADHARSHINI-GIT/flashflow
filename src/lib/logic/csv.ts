// CSV parsing and writing.
//
// Must handle, per the brief: quoted fields, line breaks INSIDE quoted fields, escaped
// double quotes (""), a UTF-8 BOM, comma / semicolon / tab delimiters (with auto-detection)
// and non-English text (Tamil, Hindi, emoji - handled naturally because we work on the
// decoded JS string, never on bytes).

export type Delimiter = ',' | ';' | '\t';

export const DELIMITER_LABELS: Record<Delimiter, string> = {
	',': 'Comma',
	';': 'Semicolon',
	'\t': 'Tab'
};

/** Strip a UTF-8 BOM if present. */
export function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Guess the delimiter by counting occurrences outside quoted fields on the first lines.
 * Falls back to comma.
 */
export function detectDelimiter(text: string): Delimiter {
	const sample = stripBom(text).slice(0, 8000);
	const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
	let inQuotes = false;
	for (let i = 0; i < sample.length; i++) {
		const ch = sample[i];
		if (ch === '"') {
			if (inQuotes && sample[i + 1] === '"') i++;
			else inQuotes = !inQuotes;
			continue;
		}
		if (inQuotes) continue;
		if (ch === ',' || ch === ';' || ch === '\t') counts[ch]++;
	}
	let best: Delimiter = ',';
	for (const d of ['\t', ';', ','] as Delimiter[]) if (counts[d] > counts[best]) best = d;
	return best;
}

/** Parse CSV text into rows of string cells. Empty trailing line is dropped. */
export function parseCsv(text: string, delimiter: Delimiter = ','): string[][] {
	const src = stripBom(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;

	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (inQuotes) {
			if (ch === '"') {
				if (src[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += ch;
			}
			continue;
		}
		if (ch === '"') {
			inQuotes = true;
			continue;
		}
		if (ch === delimiter) {
			row.push(field);
			field = '';
			continue;
		}
		if (ch === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
			continue;
		}
		field += ch;
	}
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	// Drop fully empty rows (a trailing newline produces one).
	return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export type ColumnField = 'front' | 'back' | 'tags' | 'deck' | 'extra' | 'ignore';

export const FIELD_LABELS: Record<ColumnField, string> = {
	front: 'Front',
	back: 'Back',
	tags: 'Tags',
	deck: 'Deck',
	extra: 'Extra',
	ignore: 'Ignore'
};

/** Guess a mapping from header names. Unknown headers map to 'ignore'. */
export function detectMapping(header: string[]): ColumnField[] {
	return header.map((raw, index) => {
		const h = raw.trim().toLowerCase();
		if (/^(front|question|term|q|word|prompt)$/.test(h)) return 'front';
		if (/^(back|answer|definition|a|meaning|translation)$/.test(h)) return 'back';
		if (/^(tags?|labels?|keywords?)$/.test(h)) return 'tags';
		if (/^(decks?|category|categories|topic)$/.test(h)) return 'deck';
		if (/^(extra|notes?|note|mnemonic|hint|comment)$/.test(h)) return 'extra';
		// No header match: assume the classic two-column front,back layout.
		if (index === 0) return 'front';
		if (index === 1) return 'back';
		return 'ignore';
	});
}

/** Does the first row look like a header rather than data? */
export function looksLikeHeader(row: string[]): boolean {
	const known =
		/^(front|back|question|answer|term|definition|tags?|decks?|extra|notes?|meaning|translation|category|topic)$/i;
	return row.filter((c) => known.test(c.trim())).length >= 1;
}

export interface ImportRow {
	/** 1-based row number in the source file, for error messages. */
	line: number;
	front: string;
	back: string;
	tags: string[];
	deck: string;
	extra: string;
}

export interface ImportParseResult {
	rows: ImportRow[];
	errors: { line: number; message: string }[];
}

/** Turn raw CSV rows + a column mapping into import rows, collecting row-level errors. */
export function mapRows(
	rows: string[][],
	mapping: ColumnField[],
	hasHeader: boolean
): ImportParseResult {
	const out: ImportRow[] = [];
	const errors: { line: number; message: string }[] = [];
	const start = hasHeader ? 1 : 0;

	for (let r = start; r < rows.length; r++) {
		const cells = rows[r];
		const line = r + 1;
		const get = (field: ColumnField): string => {
			const idx = mapping.indexOf(field);
			if (idx === -1 || idx >= cells.length) return '';
			return (cells[idx] ?? '').trim();
		};
		const front = get('front');
		const back = get('back');
		if (!front) {
			errors.push({ line, message: 'Front is empty - row skipped.' });
			continue;
		}
		if (!back) {
			errors.push({ line, message: 'Back is empty - row skipped.' });
			continue;
		}
		const tagsRaw = get('tags');
		out.push({
			line,
			front,
			back,
			extra: get('extra'),
			deck: get('deck'),
			tags: tagsRaw
				? tagsRaw
						.split(/[\s,;|]+/)
						.map((t) => t.trim())
						.filter(Boolean)
				: []
		});
	}
	return { rows: out, errors };
}

/** Quote a cell for CSV output when needed. */
function quote(cell: string, delimiter: string): string {
	if (cell.includes('"') || cell.includes('\n') || cell.includes(delimiter)) {
		return `"${cell.replace(/"/g, '""')}"`;
	}
	return cell;
}

export function toCsv(rows: string[][], delimiter: Delimiter = ','): string {
	return rows.map((r) => r.map((c) => quote(c ?? '', delimiter)).join(delimiter)).join('\n');
}

/** A small, original sample file offered by the "Download sample CSV" button. */
export const SAMPLE_CSV = [
	['front', 'back', 'tags', 'deck', 'extra'],
	['What is the capital of Japan?', 'Tokyo', 'geography asia', 'World Capitals', ''],
	[
		'What does "len()" return in Python?',
		'The number of items in a sequence',
		'python builtins',
		'Basic Python',
		'Works on strings, lists, tuples and dicts.'
	],
	['the book', 'el libro', 'spanish nouns', 'Spanish Starter', 'Masculine: el libro.'],
	[
		'A quoted field, with a comma',
		'It is kept whole because the field is quoted',
		'csv',
		'CSV Demo',
		''
	],
	['Two lines', 'First line\nSecond line', 'csv', 'CSV Demo', 'Line breaks survive import.']
];
