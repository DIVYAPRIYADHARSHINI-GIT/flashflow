<script lang="ts">
	// Card browser: a table on desktop, cards on mobile. Search, filters, sorting, bulk
	// select and bulk actions.
	//
	// Performance note: with 10,000 cards a full table would freeze the browser, so the
	// filtered result is paged (PAGE_SIZE rows at a time) and all filtering is done in one
	// pass over plain arrays - no nested lookups inside the render loop.
	import { app } from '#lib/store/app-state.svelte';
	import DeckPicker from '#lib/components/DeckPicker.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { plainText, truncate } from '#lib/logic/format';
	import { clozePlain } from '#lib/logic/cloze';
	import { formatInterval } from '#lib/logic/day';
	import type { Card, CardState, Note } from '#lib/types';

	const PAGE_SIZE = 100;

	let search = $state('');
	let deckFilter = $state('');
	let stateFilter = $state<'' | CardState | 'leech' | 'starred'>('');
	let tagFilter = $state('');
	let sortKey = $state<'front' | 'due' | 'interval' | 'ease' | 'lapses' | 'reviewed'>('due');
	let sortAsc = $state(true);
	let selected = $state<Set<string>>(new Set());
	let shown = $state(PAGE_SIZE);
	let confirmDelete = $state(false);
	let bulkDeck = $state('');
	let bulkTag = $state('');

	interface Row {
		card: Card;
		note: Note;
		frontText: string;
		deckName: string;
	}

	// One pass: index notes and decks by id so the loop below is O(cards).
	const rows = $derived.by<Row[]>(() => {
		if (!app.loaded) return [];
		const notes = new Map(app.data.notes.map((n) => [n.id, n]));
		const decks = new Map(app.data.decks.map((d) => [d.id, d.name]));
		const q = search.trim().toLowerCase();
		const out: Row[] = [];
		for (const card of app.data.cards) {
			const note = notes.get(card.noteId);
			if (!note) continue;
			if (deckFilter && card.deckId !== deckFilter) continue;
			if (tagFilter && !note.tags.includes(tagFilter)) continue;
			if (stateFilter) {
				if (stateFilter === 'leech') {
					if (card.lapses < app.data.settings.leechThreshold) continue;
				} else if (stateFilter === 'starred') {
					if (!note.starred) continue;
				} else if (card.state !== stateFilter) continue;
			}
			const frontText =
				note.type === 'cloze'
					? plainText(clozePlain(note.front))
					: note.type === 'reversed' && card.ord === 1
						? plainText(note.back)
						: plainText(note.front);
			if (q) {
				const hay = `${frontText} ${plainText(note.back)} ${note.tags.join(' ')}`.toLowerCase();
				if (!hay.includes(q)) continue;
			}
			out.push({ card, note, frontText, deckName: decks.get(card.deckId) ?? '' });
		}

		const dir = sortAsc ? 1 : -1;
		out.sort((a, b) => {
			switch (sortKey) {
				case 'front':
					return dir * a.frontText.localeCompare(b.frontText);
				case 'interval':
					return dir * (a.card.interval - b.card.interval);
				case 'ease':
					return dir * (a.card.ease - b.card.ease);
				case 'lapses':
					return dir * (a.card.lapses - b.card.lapses);
				case 'reviewed':
					return dir * ((a.card.lastReviewed ?? 0) - (b.card.lastReviewed ?? 0));
				default:
					return dir * (a.card.due - b.card.due);
			}
		});
		return out;
	});

	const visible = $derived(rows.slice(0, shown));
	const selectedIds = $derived([...selected]);

	// Reset paging when the filter result changes size.
	let lastFilterKey = $state('');
	$effect(() => {
		const key = `${search}|${deckFilter}|${stateFilter}|${tagFilter}`;
		if (key === lastFilterKey) return;
		lastFilterKey = key;
		shown = PAGE_SIZE;
	});

	function toggle(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	function toggleAllVisible() {
		const allSelected = visible.every((r) => selected.has(r.card.id));
		const next = new Set(selected);
		for (const r of visible) {
			if (allSelected) next.delete(r.card.id);
			else next.add(r.card.id);
		}
		selected = next;
	}

	function sortBy(key: typeof sortKey) {
		if (sortKey === key) sortAsc = !sortAsc;
		else {
			sortKey = key;
			sortAsc = true;
		}
	}

	function stateLabel(card: Card): string {
		switch (card.state) {
			case 'new':
				return 'New';
			case 'learning':
				return 'Learning';
			case 'relearning':
				return 'Relearning';
			case 'suspended':
				return 'Suspended';
			default:
				return 'Review';
		}
	}

	function dueLabel(card: Card): string {
		if (card.state === 'new') return 'New';
		if (card.state === 'suspended') return '—';
		const d = new Date(card.due);
		return d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' });
	}

	function clearSelection() {
		selected = new Set();
	}

	function runBulk(action: () => void, message: string) {
		if (selectedIds.length === 0) return;
		action();
		app.toast('success', message);
		clearSelection();
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h1 class="ff-h1">Browse</h1>
		<div class="flex gap-2">
			<a class="ff-btn ff-btn-sm" href="/add">Add cards</a>
			<a class="ff-btn ff-btn-sm" href="/transfer">Import or export</a>
		</div>
	</div>

	<!-- Filters -->
	<section class="ff-card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
		<div>
			<label class="ff-label" for="b-search">Search</label>
			<input
				id="b-search"
				class="ff-input"
				bind:value={search}
				placeholder="Front, back or tag"
				type="search"
			/>
		</div>
		<div>
			<label class="ff-label" for="b-deck">Deck</label>
			<DeckPicker id="b-deck" value={deckFilter} includeAll onchange={(v) => (deckFilter = v)} />
		</div>
		<div>
			<label class="ff-label" for="b-state">State</label>
			<select id="b-state" class="ff-input" bind:value={stateFilter}>
				<option value="">Any state</option>
				<option value="new">New</option>
				<option value="learning">Learning</option>
				<option value="review">Review</option>
				<option value="relearning">Relearning</option>
				<option value="suspended">Suspended</option>
				<option value="leech">Leeches</option>
				<option value="starred">Starred</option>
			</select>
		</div>
		<div>
			<label class="ff-label" for="b-tag">Tag</label>
			<select id="b-tag" class="ff-input" bind:value={tagFilter}>
				<option value="">Any tag</option>
				{#each app.allTags as t (t.tag)}
					<option value={t.tag}>{t.tag} ({t.count})</option>
				{/each}
			</select>
		</div>
	</section>

	<!-- Bulk actions -->
	{#if selectedIds.length > 0}
		<section class="ff-card flex flex-wrap items-end gap-2 p-3">
			<span class="ff-chip">{selectedIds.length} selected</span>
			<div class="w-44">
				<label class="ff-label" for="bulk-deck">Move to deck</label>
				<DeckPicker
					id="bulk-deck"
					value={bulkDeck}
					includeAll
					allLabel="Choose deck"
					onchange={(v) => {
						bulkDeck = v;
						if (v) runBulk(() => app.moveCards(selectedIds, v), 'Cards moved.');
					}}
				/>
			</div>
			<div class="w-40">
				<label class="ff-label" for="bulk-tag">Add tag</label>
				<input
					id="bulk-tag"
					class="ff-input"
					bind:value={bulkTag}
					onkeydown={(e) => {
						if (e.key === 'Enter' && bulkTag.trim()) {
							runBulk(() => app.tagCards(selectedIds, bulkTag), `Tag "${bulkTag}" added.`);
							bulkTag = '';
						}
					}}
				/>
			</div>
			<button class="ff-btn ff-btn-sm" onclick={() => runBulk(() => app.suspend(selectedIds), 'Cards suspended.')}
				>Suspend</button
			>
			<button
				class="ff-btn ff-btn-sm"
				onclick={() => runBulk(() => app.unsuspend(selectedIds), 'Cards unsuspended.')}
				>Unsuspend</button
			>
			<button
				class="ff-btn ff-btn-sm"
				onclick={() => runBulk(() => app.resetProgress(selectedIds), 'Progress reset.')}
				>Reset progress</button
			>
			<button class="ff-btn ff-btn-sm ff-btn-danger" onclick={() => (confirmDelete = true)}
				>Delete</button
			>
			<button class="ff-btn ff-btn-sm" onclick={clearSelection}>Clear</button>
		</section>
	{/if}

	<!-- Results -->
	<section class="ff-card overflow-hidden">
		<div
			class="ff-muted flex items-center justify-between gap-2 border-b px-3 py-2 text-[0.78rem]"
			style="border-color: var(--border)"
		>
			<span>{rows.length} card{rows.length === 1 ? '' : 's'}</span>
			{#if rows.length > 0}
				<button class="ff-btn ff-btn-sm" onclick={toggleAllVisible}>
					{visible.every((r) => selected.has(r.card.id)) ? 'Deselect' : 'Select'} shown
				</button>
			{/if}
		</div>

		{#if !app.loaded}
			<div class="flex flex-col gap-2 p-3">
				{#each [1, 2, 3, 4, 5] as i (i)}
					<div class="ff-skeleton h-8 w-full"></div>
				{/each}
			</div>
		{:else if rows.length === 0}
			<div class="p-8 text-center">
				<p class="ff-h2">No cards match</p>
				<p class="ff-muted mt-2 text-[0.88rem]">
					{app.data.cards.length === 0
						? 'There are no cards yet. Add some, or load the sample decks from Settings.'
						: 'Try clearing the search or filters.'}
				</p>
			</div>
		{:else}
			<!-- Table (desktop) -->
			<div class="hidden overflow-x-auto md:block">
				<table class="w-full border-collapse text-[0.8rem]">
					<thead>
						<tr
							class="ff-muted text-left"
							style="background: var(--surface-sunken)"
						>
							<th class="w-8 px-2 py-1.5"><span class="sr-only">Select</span></th>
							{#each [['front', 'Front'], ['due', 'Due'], ['interval', 'Interval'], ['ease', 'Ease'], ['lapses', 'Lapses'], ['reviewed', 'Reviewed']] as [key, label] (key)}
								<th class="px-2 py-1.5 font-semibold">
									<button
										class="hover:underline"
										onclick={() => sortBy(key as typeof sortKey)}
										aria-label="Sort by {label}"
									>
										{label}{sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''}
									</button>
								</th>
							{/each}
							<th class="px-2 py-1.5 font-semibold">Deck</th>
							<th class="px-2 py-1.5 font-semibold">Tags</th>
							<th class="px-2 py-1.5 font-semibold">State</th>
							<th class="px-2 py-1.5"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each visible as row (row.card.id)}
							<tr class="border-t" style="border-color: var(--border)">
								<td class="px-2 py-1.5">
									<input
										type="checkbox"
										class="h-4 w-4"
										checked={selected.has(row.card.id)}
										onchange={() => toggle(row.card.id)}
										aria-label="Select {truncate(row.frontText, 40)}"
									/>
								</td>
								<td class="max-w-[22rem] px-2 py-1.5">
									<span class="block truncate">{truncate(row.frontText, 70)}</span>
								</td>
								<td class="px-2 py-1.5 whitespace-nowrap">{dueLabel(row.card)}</td>
								<td class="px-2 py-1.5 whitespace-nowrap"
									>{row.card.interval ? formatInterval(row.card.interval) : '—'}</td
								>
								<td class="px-2 py-1.5">{row.card.ease.toFixed(2)}</td>
								<td
									class="px-2 py-1.5 font-semibold"
									style={row.card.lapses >= app.data.settings.leechThreshold
										? 'color: var(--color-again)'
										: ''}>{row.card.lapses}</td
								>
								<td class="px-2 py-1.5 whitespace-nowrap">
									{row.card.lastReviewed
										? new Date(row.card.lastReviewed).toLocaleDateString(undefined, {
												month: 'short',
												day: 'numeric'
											})
										: '—'}
								</td>
								<td class="max-w-[9rem] px-2 py-1.5"
									><span class="block truncate">{row.deckName}</span></td
								>
								<td class="max-w-[10rem] px-2 py-1.5">
									<span class="block truncate">{row.note.tags.join(' ')}</span>
								</td>
								<td class="px-2 py-1.5 whitespace-nowrap">{stateLabel(row.card)}</td>
								<td class="px-2 py-1.5">
									<a class="font-semibold underline" href="/add?edit={row.note.id}">Edit</a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Cards (mobile) -->
			<ul class="md:hidden">
				{#each visible as row (row.card.id)}
					<li class="border-t px-3 py-2.5" style="border-color: var(--border)">
						<div class="flex items-start gap-2">
							<input
								type="checkbox"
								class="mt-0.5 h-4 w-4 shrink-0"
								checked={selected.has(row.card.id)}
								onchange={() => toggle(row.card.id)}
								aria-label="Select {truncate(row.frontText, 40)}"
							/>
							<div class="min-w-0 flex-1">
								<p class="text-[0.86rem] font-semibold">{truncate(row.frontText, 90)}</p>
								<p class="ff-muted mt-1 flex flex-wrap gap-x-2 text-[0.72rem]">
									<span>{row.deckName}</span>
									<span>· {stateLabel(row.card)}</span>
									<span>· due {dueLabel(row.card)}</span>
									<span
										>· {row.card.interval ? formatInterval(row.card.interval) : 'no interval'}</span
									>
									<span>· ease {row.card.ease.toFixed(2)}</span>
									<span>· {row.card.lapses} lapses</span>
								</p>
								{#if row.note.tags.length}
									<p class="mt-1 flex flex-wrap gap-1">
										{#each row.note.tags as tag (tag)}
											<span class="ff-chip">{tag}</span>
										{/each}
									</p>
								{/if}
							</div>
							<a class="ff-btn ff-btn-sm shrink-0" href="/add?edit={row.note.id}">Edit</a>
						</div>
					</li>
				{/each}
			</ul>

			{#if rows.length > shown}
				<div class="border-t p-3 text-center" style="border-color: var(--border)">
					<button class="ff-btn ff-btn-sm" onclick={() => (shown += PAGE_SIZE)}>
						Show {Math.min(PAGE_SIZE, rows.length - shown)} more ({rows.length - shown} remaining)
					</button>
				</div>
			{/if}
		{/if}
	</section>
</div>

<ConfirmDialog
	open={confirmDelete}
	title="Delete {selectedIds.length} card{selectedIds.length === 1 ? '' : 's'}?"
	body="The selected cards and their review history will be removed from this browser. This cannot be undone."
	confirmLabel="Delete"
	onconfirm={() => {
		runBulk(() => app.deleteCards(selectedIds), 'Cards deleted.');
		confirmDelete = false;
	}}
	oncancel={() => (confirmDelete = false)}
/>
