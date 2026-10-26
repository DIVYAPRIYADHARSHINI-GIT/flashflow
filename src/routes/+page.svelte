<script lang="ts">
	// Home: decks with New / Learning / Due counts, a big "Study now" button, the streak
	// counter and a short "Today" summary.
	import { app } from '#lib/store/app-state.svelte';
	import { buildQueue, DEFAULT_QUEUE_OPTIONS, deckCounts } from '#lib/logic/queue';
	import { streak, todaySummary } from '#lib/logic/stats';
	import { formatDuration } from '#lib/logic/day';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { goto } from '$app/navigation';

	let newDeckOpen = $state(false);
	let newName = $state('');
	let newDescription = $state('');
	let deleteId = $state<string | null>(null);
	let renameId = $state<string | null>(null);
	let renameValue = $state('');

	const today = $derived(app.today);
	const now = $derived(app.now());

	const all = $derived(
		app.loaded ? buildQueue(app.data, { ...DEFAULT_QUEUE_OPTIONS, now, day: today }).counts : null
	);
	const totalDue = $derived(all ? all.new + all.learning + all.due : 0);

	const summary = $derived(todaySummary(app.data.days, today));
	const streakInfo = $derived(
		streak(app.data.days, today, Math.max(1, app.data.settings.dailyGoal))
	);

	interface Row {
		id: string;
		name: string;
		depth: number;
		color: string;
		description: string;
		counts: { new: number; learning: number; due: number };
		cardCount: number;
	}

	// Decks sorted by name so "Parent::Child" naturally groups under its parent.
	const rows = $derived.by<Row[]>(() => {
		if (!app.loaded) return [];
		const sorted = [...app.data.decks].sort((a, b) => a.name.localeCompare(b.name));
		return sorted.map((d) => {
			const parts = d.name.split('::');
			return {
				id: d.id,
				name: parts[parts.length - 1],
				depth: parts.length - 1,
				color: d.color,
				description: d.description,
				counts: deckCounts(app.data, d.id, now, today),
				cardCount: app.data.cards.filter((c) => c.deckId === d.id).length
			};
		});
	});

	function createDeck() {
		const name = newName.trim();
		if (!name) return;
		if (app.data.decks.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
			app.toast('error', 'A deck with that name already exists.');
			return;
		}
		app.createDeck(name, newDescription);
		app.toast('success', `Deck "${name}" created.`);
		newName = '';
		newDescription = '';
		newDeckOpen = false;
	}

	function confirmRename() {
		if (!renameId) return;
		const name = renameValue.trim();
		if (name) app.updateDeck(renameId, { name });
		renameId = null;
	}
</script>

<div class="flex flex-col gap-4">
	<!-- Hero row -->
	<section class="ff-card p-4 md:p-5">
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div class="min-w-0">
				<h1 class="ff-h1">Today</h1>
				{#if app.loaded}
					<p class="ff-muted mt-1 text-[0.88rem]">
						{#if totalDue > 0}
							{totalDue} card{totalDue === 1 ? '' : 's'} ready
							<span class="ff-muted">·</span>
							{all?.new} new, {all?.learning} learning, {all?.due} review
						{:else if summary.reviews > 0}
							All caught up. You studied {summary.reviews} card{summary.reviews === 1 ? '' : 's'} today.
						{:else}
							Nothing is due right now. Try a custom study session or add some cards.
						{/if}
					</p>
				{:else}
					<div class="ff-skeleton mt-2 h-4 w-64"></div>
				{/if}
			</div>

			<div class="flex items-center gap-3">
				<div class="text-right">
					<div class="text-[1.6rem] leading-none font-bold" style="color: var(--color-primary)">
						{streakInfo.current}
					</div>
					<div class="ff-muted text-[0.7rem] font-semibold tracking-wide uppercase">
						day streak
					</div>
				</div>
				<a
					class="ff-btn ff-btn-primary px-6 text-[0.95rem]"
					href="/study"
					aria-disabled={totalDue === 0}>Study now</a
				>
			</div>
		</div>

		{#if app.loaded}
			<dl class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="rounded-lg p-2.5" style="background: var(--surface-sunken)">
					<dt class="ff-muted text-[0.72rem] font-semibold uppercase">Studied today</dt>
					<dd class="mt-0.5 text-lg font-bold">{summary.reviews}</dd>
				</div>
				<div class="rounded-lg p-2.5" style="background: var(--surface-sunken)">
					<dt class="ff-muted text-[0.72rem] font-semibold uppercase">Time</dt>
					<dd class="mt-0.5 text-lg font-bold">{formatDuration(summary.timeMs)}</dd>
				</div>
				<div class="rounded-lg p-2.5" style="background: var(--surface-sunken)">
					<dt class="ff-muted text-[0.72rem] font-semibold uppercase">Correct</dt>
					<dd class="mt-0.5 text-lg font-bold">
						{summary.correctPercent === null ? '—' : `${summary.correctPercent}%`}
					</dd>
				</div>
				<div class="rounded-lg p-2.5" style="background: var(--surface-sunken)">
					<dt class="ff-muted text-[0.72rem] font-semibold uppercase">Longest streak</dt>
					<dd class="mt-0.5 text-lg font-bold">{streakInfo.longest}</dd>
				</div>
			</dl>
		{/if}
	</section>

	<!-- Decks -->
	<section class="ff-card overflow-hidden">
		<div
			class="flex items-center justify-between gap-3 border-b px-4 py-3"
			style="border-color: var(--border)"
		>
			<h2 class="ff-h2">Decks</h2>
			<div class="flex gap-2">
				<a class="ff-btn ff-btn-sm" href="/add">Add cards</a>
				<button class="ff-btn ff-btn-sm ff-btn-primary" onclick={() => (newDeckOpen = true)}
					>New deck</button
				>
			</div>
		</div>

		{#if !app.loaded}
			<div class="flex flex-col gap-3 p-4">
				{#each [1, 2, 3] as i (i)}
					<div class="ff-skeleton h-11 w-full"></div>
				{/each}
			</div>
		{:else if rows.length === 0}
			<div class="p-8 text-center">
				<p class="ff-h2">No decks yet</p>
				<p class="ff-muted mx-auto mt-2 max-w-sm text-[0.88rem]">
					Create a deck to start adding cards, import a CSV file, or load the sample decks from
					Settings.
				</p>
				<div class="mt-4 flex justify-center gap-2">
					<button class="ff-btn ff-btn-primary" onclick={() => (newDeckOpen = true)}
						>New deck</button
					>
					<a class="ff-btn" href="/transfer">Import CSV</a>
				</div>
			</div>
		{:else}
			<ul>
				{#each rows as row (row.id)}
					<li class="border-b last:border-0" style="border-color: var(--border)">
						<div class="flex items-center gap-3 px-4 py-2.5">
							<span
								class="h-2.5 w-2.5 shrink-0 rounded-full"
								style="background: {row.color}; margin-left: {row.depth * 1.1}rem"
								aria-hidden="true"
							></span>
							<div class="min-w-0 flex-1">
								<a href="/study?deck={row.id}" class="block truncate text-[0.92rem] font-semibold"
									>{row.name}</a
								>
								{#if row.description}
									<p class="ff-muted truncate text-[0.76rem]">{row.description}</p>
								{/if}
							</div>

							<div class="flex shrink-0 items-center gap-1.5 text-[0.78rem] font-bold">
								<span
									class="min-w-7 rounded px-1.5 py-0.5 text-center"
									style="background: var(--chip); color: var(--color-primary)"
									title="{row.counts.new} new">{row.counts.new}</span
								>
								<span
									class="min-w-7 rounded px-1.5 py-0.5 text-center"
									style="background: #fff4e6; color: #a35a00"
									title="{row.counts.learning} learning">{row.counts.learning}</span
								>
								<span
									class="min-w-7 rounded px-1.5 py-0.5 text-center"
									style="background: #e9f8ee; color: #1f7a32"
									title="{row.counts.due} due">{row.counts.due}</span
								>
							</div>

							<div class="hidden shrink-0 gap-1 sm:flex">
								<a class="ff-btn ff-btn-sm" href="/study?deck={row.id}">Study</a>
								<button
									class="ff-btn ff-btn-sm"
									onclick={() => {
										renameId = row.id;
										renameValue = app.deckName(row.id);
									}}>Rename</button
								>
								<button class="ff-btn ff-btn-sm" onclick={() => app.duplicateDeck(row.id)}
									>Duplicate</button
								>
								<button class="ff-btn ff-btn-sm" onclick={() => (deleteId = row.id)}>Delete</button>
							</div>
						</div>

						{#if renameId === row.id}
							<div
								class="flex flex-wrap items-end gap-2 px-4 pb-3"
								style="background: var(--surface-sunken)"
							>
								<div class="min-w-48 flex-1 pt-3">
									<label class="ff-label" for="rename-{row.id}"
										>Full name (use Parent::Child to nest)</label
									>
									<input
										id="rename-{row.id}"
										class="ff-input"
										bind:value={renameValue}
										onkeydown={(e) => e.key === 'Enter' && confirmRename()}
									/>
								</div>
								<button class="ff-btn ff-btn-sm ff-btn-primary" onclick={confirmRename}>Save</button
								>
								<button class="ff-btn ff-btn-sm" onclick={() => (renameId = null)}>Cancel</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
			<div class="ff-muted flex gap-4 px-4 py-2 text-[0.72rem]">
				<span><strong style="color: var(--color-primary)">blue</strong> new</span>
				<span><strong style="color: #a35a00">amber</strong> learning</span>
				<span><strong style="color: #1f7a32">green</strong> due</span>
			</div>
		{/if}
	</section>

	<!-- Custom study entry points -->
	<section class="ff-card p-4">
		<h2 class="ff-h2">Custom study</h2>
		<p class="ff-muted mt-1 text-[0.84rem]">
			These sessions do not change your schedule.
		</p>
		<div class="mt-3 flex flex-wrap gap-2">
			<a class="ff-btn ff-btn-sm" href="/study?mode=cram">Cram a deck</a>
			<a class="ff-btn ff-btn-sm" href="/study?mode=ahead">Review ahead</a>
			<a class="ff-btn ff-btn-sm" href="/study?mode=leeches">Leeches only</a>
			<a class="ff-btn ff-btn-sm" href="/study?mode=starred">Starred only</a>
		</div>
	</section>
</div>

<!-- New deck dialog -->
{#if newDeckOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) newDeckOpen = false;
		}}
	>
		<div
			class="ff-card w-full max-w-md p-5"
			role="dialog"
			aria-modal="true"
			aria-labelledby="new-deck-title"
		>
			<h2 id="new-deck-title" class="ff-h2">New deck</h2>
			<div class="mt-3 flex flex-col gap-3">
				<div>
					<label class="ff-label" for="deck-name">Name</label>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="deck-name"
						class="ff-input"
						bind:value={newName}
						autofocus
						placeholder="Biology or Biology::Cells"
						onkeydown={(e) => e.key === 'Enter' && createDeck()}
					/>
					<p class="ff-muted mt-1 text-[0.74rem]">
						Use "Parent::Child" to nest a deck one level under another.
					</p>
				</div>
				<div>
					<label class="ff-label" for="deck-desc">Description (optional)</label>
					<input id="deck-desc" class="ff-input" bind:value={newDescription} />
				</div>
			</div>
			<div class="mt-5 flex justify-end gap-2">
				<button class="ff-btn" onclick={() => (newDeckOpen = false)}>Cancel</button>
				<button class="ff-btn ff-btn-primary" onclick={createDeck}>Create deck</button>
			</div>
		</div>
	</div>
{/if}

<ConfirmDialog
	open={deleteId !== null}
	title="Delete this deck?"
	body="The deck, its cards and their review history will be removed from this browser. This cannot be undone."
	confirmLabel="Delete deck"
	onconfirm={() => {
		if (deleteId) {
			const name = app.deckName(deleteId);
			app.deleteDeck(deleteId);
			app.toast('success', `Deleted "${name}".`);
		}
		deleteId = null;
	}}
	oncancel={() => (deleteId = null)}
/>
