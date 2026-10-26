<script lang="ts">
	// Import and export: CSV import with preview + column mapping, CSV / TSV export,
	// PDF export through the one server route, and the print-to-PDF fallback.
	import { app } from '#lib/store/app-state.svelte';
	import DeckPicker from '#lib/components/DeckPicker.svelte';
	import {
		DELIMITER_LABELS,
		FIELD_LABELS,
		SAMPLE_CSV,
		detectDelimiter,
		detectMapping,
		looksLikeHeader,
		mapRows,
		parseCsv,
		toCsv,
		type ColumnField,
		type Delimiter
	} from '#lib/logic/csv';
	import { download, exportCsv, needsComplexShaping, safeFilename } from '#lib/logic/export';
	import { MATURE_DAYS } from '#lib/types';

	// ---------------------------------------------------------------- CSV import
	let rawText = $state('');
	let fileName = $state('');
	let delimiter = $state<Delimiter>(',');
	let hasHeader = $state(true);
	let mapping = $state<ColumnField[]>([]);
	let targetDeck = $state('');
	let duplicateMode = $state<'skip' | 'update'>('skip');
	let importing = $state(false);
	let report = $state<{
		added: number;
		updated: number;
		skipped: number;
		decksCreated: number;
		errors: { line: number; message: string }[];
	} | null>(null);

	const parsedRows = $derived(rawText ? parseCsv(rawText, delimiter) : []);
	const previewRows = $derived(parsedRows.slice(0, 6));
	const columnCount = $derived(Math.max(0, ...parsedRows.map((r) => r.length)));

	// Re-detect the mapping whenever the parsed shape changes.
	let lastShape = $state('');
	$effect(() => {
		if (parsedRows.length === 0) return;
		const shape = `${fileName}|${delimiter}|${columnCount}|${hasHeader}`;
		if (shape === lastShape) return;
		lastShape = shape;
		const header = hasHeader ? parsedRows[0] : Array.from({ length: columnCount }, () => '');
		mapping = detectMapping(header);
	});

	async function onFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		fileName = file.name;
		report = null;
		// Read as text so the UTF-8 BOM, Tamil / Hindi text and emoji decode correctly.
		const text = await file.text();
		delimiter = detectDelimiter(text);
		rawText = text;
		const rows = parseCsv(text, detectDelimiter(text));
		hasHeader = rows.length > 0 ? looksLikeHeader(rows[0]) : true;
		lastShape = '';
		if (!targetDeck) targetDeck = app.data.decks[0]?.id ?? '';
	}

	function runImport() {
		if (parsedRows.length === 0) return;
		importing = true;
		try {
			const { rows, errors } = mapRows(parsedRows, mapping, hasHeader);
			let added = 0;
			let updated = 0;
			let skipped = 0;
			const decksBefore = app.data.decks.length;

			for (const row of rows) {
				// A deck column wins; otherwise everything goes to the chosen deck.
				const deckId = row.deck
					? app.ensureDeck(row.deck).id
					: targetDeck || app.ensureDeck('Imported').id;

				const existing = app.data.notes.find(
					(n) =>
						n.deckId === deckId && n.front.trim().toLowerCase() === row.front.trim().toLowerCase()
				);
				if (existing) {
					if (duplicateMode === 'update') {
						app.updateNote(existing.id, {
							back: row.back,
							extra: row.extra || existing.extra,
							tags: row.tags.length ? row.tags : existing.tags
						});
						updated++;
					} else {
						skipped++;
					}
					continue;
				}
				app.createNote({
					deckId,
					type: 'basic',
					front: row.front,
					back: row.back,
					extra: row.extra,
					tags: row.tags
				});
				added++;
			}

			report = {
				added,
				updated,
				skipped,
				decksCreated: app.data.decks.length - decksBefore,
				errors
			};
			app.toast('success', `Imported ${added} card${added === 1 ? '' : 's'}.`);
		} finally {
			importing = false;
		}
	}

	function clearImport() {
		rawText = '';
		fileName = '';
		mapping = [];
		report = null;
		lastShape = '';
	}

	function downloadSample() {
		download('flashflow-sample.csv', `\ufeff${toCsv(SAMPLE_CSV)}`, 'text/csv');
	}

	// ---------------------------------------------------------------- CSV / TSV export
	let exportDeck = $state('');

	function exportDeckAs(kind: 'csv' | 'tsv') {
		const ids = exportDeck ? [exportDeck] : null;
		const delim: Delimiter = kind === 'tsv' ? '\t' : ',';
		const name = exportDeck ? safeFilename(app.deckName(exportDeck)) : 'all_decks';
		download(
			`flashflow_${name}.${kind === 'tsv' ? 'txt' : 'csv'}`,
			exportCsv(app.data, ids, delim),
			kind === 'tsv' ? 'text/tab-separated-values' : 'text/csv'
		);
		app.toast('success', `Exported ${kind.toUpperCase()}.`);
	}

	// ---------------------------------------------------------------- PDF export
	let pdfBusy = $state(false);
	let pdfNotice = $state<string | null>(null);

	const exportHasComplexScript = $derived.by(() => {
		const notes = exportDeck
			? app.data.notes.filter((n) => n.deckId === exportDeck)
			: app.data.notes;
		return notes.some((n) => needsComplexShaping(n.front) || needsComplexShaping(n.back));
	});

	async function exportPdf(kind: 'deck-list' | 'card-sheet') {
		pdfBusy = true;
		pdfNotice = null;
		try {
			const body =
				kind === 'deck-list'
					? {
							kind,
							rows: app.data.decks.map((d) => {
								const cards = app.data.cards.filter((c) => c.deckId === d.id);
								return {
									name: d.name,
									description: d.description,
									cards: cards.length,
									newCards: cards.filter((c) => c.state === 'new').length,
									due: cards.filter((c) => c.state !== 'new' && c.state !== 'suspended' && c.due <= app.now()).length,
									mature: cards.filter((c) => c.interval >= MATURE_DAYS).length
								};
							})
						}
					: {
							kind,
							deckName: exportDeck ? app.deckName(exportDeck) : 'All decks',
							notes: (exportDeck
								? app.data.notes.filter((n) => n.deckId === exportDeck)
								: app.data.notes
							).map((n) => ({
								front: n.front,
								back: n.back,
								extra: n.extra,
								deck: app.deckName(n.deckId),
								tags: n.tags
							}))
						};

			const res = await fetch('/api/pdf', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({ message: 'The PDF could not be generated.' }));
				const message = data.message ?? 'The PDF could not be generated.';
				pdfNotice = message;
				app.toast('error', message);
				return;
			}

			const blob = await res.blob();
			const name =
				kind === 'deck-list'
					? 'FlashFlow_deck_list.pdf'
					: `FlashFlow_cards_${safeFilename(exportDeck ? app.deckName(exportDeck) : 'all_decks')}.pdf`;
			download(name, blob, 'application/pdf');
			app.toast('success', 'PDF downloaded.');
		} catch {
			pdfNotice = 'The PDF request failed. Use "Print to PDF" instead.';
			app.toast('error', pdfNotice);
		} finally {
			pdfBusy = false;
		}
	}
</script>

<div class="flex flex-col gap-4">
	<h1 class="ff-h1">Import and export</h1>

	<!-- CSV import -->
	<section class="ff-card p-4">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 class="ff-h2">Import CSV</h2>
			<button class="ff-btn ff-btn-sm" onclick={downloadSample}>Download sample CSV</button>
		</div>
		<p class="ff-muted mt-1 text-[0.82rem]">
			Quoted fields, line breaks inside fields, a UTF-8 BOM and non-English text (Tamil, Hindi,
			emoji) are all handled. Imported cards are created as Basic cards.
		</p>

		<div class="mt-3">
			<label class="ff-label" for="csv-file">CSV file</label>
			<input id="csv-file" type="file" accept=".csv,.txt,.tsv,text/csv" onchange={onFile} class="text-[0.85rem]" />
		</div>

		{#if parsedRows.length > 0}
			<div class="mt-4 grid gap-3 sm:grid-cols-3">
				<div>
					<label class="ff-label" for="csv-delim">Delimiter</label>
					<select id="csv-delim" class="ff-input" bind:value={delimiter} onchange={() => (lastShape = '')}>
						{#each Object.entries(DELIMITER_LABELS) as [value, label] (value)}
							<option {value}>{label}</option>
						{/each}
					</select>
				</div>
				<div>
					<label class="ff-label" for="csv-deck">Default deck</label>
					<DeckPicker
						id="csv-deck"
						value={targetDeck}
						includeAll
						allLabel="Create &quot;Imported&quot;"
						onchange={(v) => (targetDeck = v)}
					/>
				</div>
				<div>
					<label class="ff-label" for="csv-dupes">Duplicates</label>
					<select id="csv-dupes" class="ff-input" bind:value={duplicateMode}>
						<option value="skip">Skip duplicates</option>
						<option value="update">Update the existing card</option>
					</select>
				</div>
			</div>

			<label class="mt-3 flex items-center gap-2 text-[0.85rem] font-semibold">
				<input type="checkbox" class="h-4 w-4" bind:checked={hasHeader} onchange={() => (lastShape = '')} />
				First row is a header
			</label>

			<!-- Column mapping + preview -->
			<div class="mt-3 overflow-x-auto">
				<table class="w-full border-collapse text-[0.78rem]">
					<thead>
						<tr style="background: var(--surface-sunken)">
							{#each Array(columnCount) as _, i (i)}
								<th class="p-1.5 text-left font-semibold">
									<label class="sr-only" for="map-{i}">Column {i + 1} maps to</label>
									<select
										id="map-{i}"
										class="ff-input text-[0.76rem]"
										value={mapping[i] ?? 'ignore'}
										onchange={(e) => {
											const next = [...mapping];
											next[i] = (e.currentTarget as HTMLSelectElement).value as ColumnField;
											mapping = next;
										}}
									>
										{#each Object.entries(FIELD_LABELS) as [value, label] (value)}
											<option {value}>{label}</option>
										{/each}
									</select>
									{#if hasHeader && parsedRows[0]?.[i]}
										<span class="ff-muted mt-1 block truncate text-[0.68rem]"
											>{parsedRows[0][i]}</span
										>
									{/if}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each previewRows.slice(hasHeader ? 1 : 0) as row, ri (ri)}
							<tr class="border-t" style="border-color: var(--border)">
								{#each Array(columnCount) as _, ci (ci)}
									<td class="max-w-[14rem] p-1.5 align-top">
										<span class="block truncate whitespace-pre-wrap">{row[ci] ?? ''}</span>
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<p class="ff-muted mt-2 text-[0.76rem]">
				{parsedRows.length - (hasHeader ? 1 : 0)} data rows detected in {fileName}.
			</p>

			<div class="mt-3 flex flex-wrap gap-2">
				<button
					class="ff-btn ff-btn-primary"
					onclick={runImport}
					disabled={importing || !mapping.includes('front') || !mapping.includes('back')}
				>
					{importing ? 'Importing...' : 'Import cards'}
				</button>
				<button class="ff-btn" onclick={clearImport}>Clear</button>
			</div>
			{#if !mapping.includes('front') || !mapping.includes('back')}
				<p class="mt-2 text-[0.78rem]" style="color: var(--color-again)">
					Map one column to Front and one to Back before importing.
				</p>
			{/if}
		{/if}

		{#if report}
			<div class="mt-4 rounded-lg p-3" style="background: var(--surface-sunken)">
				<h3 class="ff-h2 text-[0.95rem]">Import summary</h3>
				<ul class="mt-2 flex flex-col gap-1 text-[0.84rem]">
					<li><strong>{report.added}</strong> cards added</li>
					<li><strong>{report.updated}</strong> existing cards updated</li>
					<li><strong>{report.skipped}</strong> duplicates skipped</li>
					{#if report.decksCreated > 0}
						<li><strong>{report.decksCreated}</strong> new decks created</li>
					{/if}
				</ul>
				{#if report.errors.length > 0}
					<p class="mt-2 text-[0.8rem] font-semibold" style="color: var(--color-again)">
						{report.errors.length} row{report.errors.length === 1 ? '' : 's'} had a problem:
					</p>
					<ul class="ff-muted mt-1 max-h-40 overflow-y-auto text-[0.78rem]">
						{#each report.errors.slice(0, 50) as err (err.line)}
							<li>Row {err.line}: {err.message}</li>
						{/each}
						{#if report.errors.length > 50}
							<li>... and {report.errors.length - 50} more.</li>
						{/if}
					</ul>
				{/if}
			</div>
		{/if}
	</section>

	<!-- Export -->
	<section class="ff-card p-4">
		<h2 class="ff-h2">Export</h2>
		<p class="ff-muted mt-1 text-[0.82rem]">
			CSV and tab-separated text contain your card content. Your scheduling progress is included
			only in the JSON backup on the
			<a class="underline" href="/privacy">Privacy and backup</a> page.
		</p>

		<div class="mt-3 max-w-xs">
			<label class="ff-label" for="export-deck">Deck</label>
			<DeckPicker id="export-deck" value={exportDeck} includeAll onchange={(v) => (exportDeck = v)} />
		</div>

		<div class="mt-3 flex flex-wrap gap-2">
			<button class="ff-btn" onclick={() => exportDeckAs('csv')}>Export CSV</button>
			<button class="ff-btn" onclick={() => exportDeckAs('tsv')}>Export tab-separated text</button>
			<button class="ff-btn" onclick={() => exportPdf('deck-list')} disabled={pdfBusy}>
				{pdfBusy ? 'Generating...' : 'PDF deck list'}
			</button>
			<button class="ff-btn" onclick={() => exportPdf('card-sheet')} disabled={pdfBusy}>
				{pdfBusy ? 'Generating...' : 'PDF card sheet'}
			</button>
			<a class="ff-btn" href="/print{exportDeck ? `?deck=${exportDeck}` : ''}">Print to PDF</a>
		</div>

		{#if exportHasComplexScript}
			<p
				class="mt-3 rounded-lg px-3 py-2 text-[0.8rem]"
				style="background: #fff4e6; color: #8a4b00"
			>
				This selection contains Tamil, Devanagari or similar complex-script text. The generated PDF
				cannot shape those letter clusters correctly, so use <strong>Print to PDF</strong>, which
				uses the browser's own text shaper with the print stylesheet.
			</p>
		{/if}

		{#if pdfNotice}
			<p class="mt-3 text-[0.82rem]" style="color: var(--color-again)">{pdfNotice}</p>
		{/if}

		<p class="ff-muted mt-3 text-[0.76rem]">
			The PDF card sheet lays fronts and backs out for double-sided printing: backs are mirrored
			left to right so a duplex print (flip on the long edge) puts each answer behind its own
			question.
		</p>
	</section>
</div>
