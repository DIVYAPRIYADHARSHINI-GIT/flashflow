<script lang="ts">
	// Browser print-to-PDF route. This is the correct path for Tamil, Hindi and other
	// complex scripts: the browser's own text shaper lays the glyph clusters out properly,
	// which the pdf-lib generated PDF cannot do.
	import { app } from '#lib/store/app-state.svelte';
	import { page } from '$app/state';
	import CardFace from '#lib/components/CardFace.svelte';
	import { clozePlain } from '#lib/logic/cloze';

	const deckId = $derived(page.url.searchParams.get('deck'));
	const notes = $derived(
		app.loaded
			? deckId
				? app.data.notes.filter((n) => n.deckId === deckId)
				: app.data.notes
			: []
	);
	const deckLabel = $derived(deckId ? app.deckName(deckId) : 'All decks');

	function frontOf(front: string, type: string): string {
		return type === 'cloze' ? clozePlain(front) : front;
	}
</script>

<svelte:head>
	<title>FlashFlow - printable cards</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl">
	<div class="no-print mb-4 flex flex-wrap items-center gap-2">
		<a class="ff-btn ff-btn-sm" href="/transfer">Back</a>
		<button class="ff-btn ff-btn-sm ff-btn-primary" onclick={() => window.print()}>Print</button>
		<p class="ff-muted text-[0.8rem]">
			In the print dialog choose "Save as PDF". This route shapes Tamil and Hindi text correctly.
		</p>
	</div>

	<article class="ff-print-sheet">
		<header class="mb-4 border-b pb-2" style="border-color: var(--border)">
			<h1 class="ff-h1">{deckLabel}</h1>
			<p class="ff-muted text-[0.82rem]">
				{notes.length} card{notes.length === 1 ? '' : 's'} · FlashFlow
			</p>
		</header>

		{#if notes.length === 0}
			<p class="ff-muted">There are no cards in this selection.</p>
		{:else}
			<ol class="flex flex-col gap-3">
				{#each notes as note, i (note.id)}
					<li
						class="ff-print-sheet rounded-lg border p-3"
						style="border-color: var(--border)"
					>
						<div class="ff-muted mb-1 flex gap-2 text-[0.68rem] font-semibold uppercase">
							<span>{i + 1}</span>
							<span>{app.deckName(note.deckId)}</span>
							{#if note.tags.length}<span>{note.tags.join(' ')}</span>{/if}
						</div>
						<CardFace text={frontOf(note.front, note.type)} scale={0.8} align="left" />
						{#if note.type !== 'cloze'}
							<div class="mt-2 border-t pt-2" style="border-color: var(--border)">
								<CardFace text={note.back} scale={0.75} align="left" />
							</div>
						{/if}
						{#if note.extra}
							<p class="ff-muted mt-1 text-[0.76rem]">{note.extra}</p>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
	</article>
</div>
