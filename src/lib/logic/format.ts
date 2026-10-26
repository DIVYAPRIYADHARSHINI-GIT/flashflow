// Tiny, safe formatter for card text: bold, italic, bullet lists, line breaks, inline code
// and fenced code blocks.
//
// Why hand-written: user text must never be injected as raw HTML, and a full Markdown
// library is far more than the brief needs. Everything is escaped FIRST, then a small set
// of inline rules runs over the escaped text, so the output can be used with {@html}
// safely.

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Inline rules applied to already-escaped text. */
function inline(escaped: string): string {
	return (
		escaped
			// `code`
			.replace(/`([^`\n]+)`/g, '<code class="ff-code">$1</code>')
			// **bold**
			.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
			// *italic* / _italic_
			.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
			.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>')
	);
}

/**
 * Render card text to safe HTML.
 * Supports: ``` fenced code blocks, "- " / "* " bullet lists, blank-line paragraphs and
 * single line breaks.
 */
export function renderCardText(text: string): string {
	if (!text) return '';
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const out: string[] = [];
	let i = 0;
	let listOpen = false;

	const closeList = () => {
		if (listOpen) {
			out.push('</ul>');
			listOpen = false;
		}
	};

	while (i < lines.length) {
		const line = lines[i];

		// Fenced code block
		if (/^```/.test(line.trim())) {
			closeList();
			const body: string[] = [];
			i++;
			while (i < lines.length && !/^```/.test(lines[i].trim())) body.push(lines[i++]);
			i++; // closing fence
			out.push(`<pre class="ff-pre"><code>${escapeHtml(body.join('\n'))}</code></pre>`);
			continue;
		}

		// Bullet list item
		const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
		if (bullet) {
			if (!listOpen) {
				out.push('<ul class="ff-ul">');
				listOpen = true;
			}
			out.push(`<li>${inline(escapeHtml(bullet[1]))}</li>`);
			i++;
			continue;
		}

		closeList();

		if (line.trim() === '') {
			i++;
			continue;
		}

		// Group consecutive non-blank, non-list lines into one paragraph with <br>.
		const para: string[] = [];
		while (
			i < lines.length &&
			lines[i].trim() !== '' &&
			!/^\s*[-*]\s+/.test(lines[i]) &&
			!/^```/.test(lines[i].trim())
		) {
			para.push(inline(escapeHtml(lines[i])));
			i++;
		}
		out.push(`<p>${para.join('<br>')}</p>`);
	}
	closeList();
	return out.join('');
}

/** Plain-text version for tables, search and CSV export. */
export function plainText(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, '').trim())
		.replace(/[`*_]/g, '')
		.replace(/\s*\n\s*/g, ' ')
		.trim();
}

export function truncate(s: string, n = 90): string {
	return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
