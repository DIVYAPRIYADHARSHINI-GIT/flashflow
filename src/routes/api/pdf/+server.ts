// The ONLY server route in FlashFlow.
//
// It receives the already-selected rows from the browser, renders a PDF, and returns it.
// It stores nothing, logs nothing and has no database, KV, Blob or external API behind it -
// the request body is used for this one render and then discarded.

import type { RequestHandler } from './$types';
import { buildCardSheetPdf, buildDeckListPdf, type DeckListRow, type PdfNote } from '#lib/server/pdf';
import { needsComplexShaping } from '#lib/logic/export';

export const POST: RequestHandler = async ({ request }) => {
	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
			status: 400,
			headers: { 'content-type': 'application/json' }
		});
	}

	const body = payload as {
		kind?: 'deck-list' | 'card-sheet';
		deckName?: string;
		rows?: DeckListRow[];
		notes?: PdfNote[];
	};

	const generatedAt = new Date().toLocaleString('en-GB', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	try {
		if (body.kind === 'deck-list') {
			const rows = Array.isArray(body.rows) ? body.rows : [];
			const bytes = await buildDeckListPdf(rows, generatedAt);
			return pdfResponse(bytes, 'FlashFlow_deck_list.pdf');
		}

		if (body.kind === 'card-sheet') {
			const notes = Array.isArray(body.notes) ? body.notes : [];
			const deckName = (body.deckName ?? 'Cards').slice(0, 80);

			// pdf-lib cannot shape Tamil / Devanagari clusters. Refuse rather than emit a PDF
			// with broken text; the client then uses the browser print route instead.
			const complex = notes.some(
				(n) => needsComplexShaping(n.front) || needsComplexShaping(n.back ?? '')
			);
			if (complex) {
				return new Response(
					JSON.stringify({
						error: 'complex-script',
						message:
							'This deck contains Tamil, Devanagari or other complex-script text. The generated PDF cannot shape those letter clusters correctly, so use "Print to PDF" instead - it uses the browser text shaper and the print stylesheet.'
					}),
					{ status: 422, headers: { 'content-type': 'application/json' } }
				);
			}

			const bytes = await buildCardSheetPdf(notes, deckName, generatedAt);
			return pdfResponse(bytes, `FlashFlow_cards_${deckName.replace(/[^\w-]+/g, '_')}.pdf`);
		}

		return new Response(JSON.stringify({ error: 'Unknown document kind.' }), {
			status: 400,
			headers: { 'content-type': 'application/json' }
		});
	} catch (err) {
		return new Response(
			JSON.stringify({
				error: 'render-failed',
				message: err instanceof Error ? err.message : 'The PDF could not be generated.'
			}),
			{ status: 500, headers: { 'content-type': 'application/json' } }
		);
	}
};

function pdfResponse(bytes: Uint8Array, filename: string): Response {
	return new Response(bytes as BodyInit, {
		headers: {
			'content-type': 'application/pdf',
			// The filename is ASCII-sanitised by the callers above.
			'content-disposition': `attachment; filename="${filename}"`,
			'cache-control': 'no-store'
		}
	});
}
