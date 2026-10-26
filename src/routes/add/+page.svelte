<script lang="ts">
	// Fast, keyboard-friendly card entry. Also handles editing an existing note via ?edit=.
	//
	// Keyboard contract: Tab moves between fields (native), Enter in any field adds the
	// card and keeps the deck, type and tags, so a long list can be typed without the
	// mouse. Ctrl/Cmd+Enter adds from anywhere, including the multi-line boxes.
	import { app } from '#lib/store/app-state.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import DeckPicker from '#lib/components/DeckPicker.svelte';
	import CardFace from '#lib/components/CardFace.svelte';
	import { parseCloze } from '#lib/logic/cloze';
	import { compressImage } from '#lib/logic/image';
	import type { CardType } from '#lib/types';

	const editId = $derived(page.url.searchParams.get('edit'));
	const editing = $derived(editId ? app.note(editId) : undefined);

	let deckId = $state('');
	let type = $state<CardType>('basic');
	let front = $state('');
	let back = $state('');
	let extra = $state('');
	let tagsText = $state('');
	let imageFront = $state<string | null>(null);
	let imageBack = $state<string | null>(null);
	let starred = $state(false);
	let addedCount = $state(0);
	let imageError = $state<string | null>(null);

	let frontEl = $state<HTMLTextAreaElement | null>(null);

	// Seed the form: either the note being edited, or the first deck for a new card.
	let seeded = $state('');
	$effect(() => {
		if (!app.loaded) return;
		const key = editId ?? 'new';
		if (seeded === key) return;
		seeded = key;
		if (editing) {
			deckId = editing.deckId;
			type = editing.type;
			front = editing.front;
			back = editing.back;
			extra = editing.extra;
			tagsText = editing.tags.join(' ');
			imageFront = editing.imageFront;
			imageBack = editing.imageBack;
			starred = editing.starred;
		} else if (!deckId) {
			deckId = app.data.decks[0]?.id ?? '';
		}
	});

	const tags = $derived(
		tagsText
			.split(/[\s,]+/)
			.map((t) => t.trim())
			.filter(Boolean)
	);

	const clozeInfo = $derived(type === 'cloze' ? parseCloze(front) : null);
	const duplicate = $derived(
		!editing && deckId && front.trim() ? app.isDuplicate(deckId, front) : false
	);

	const cardCountLabel = $derived.by(() => {
		if (type === 'reversed') return 'Creates 2 review cards (front→back and back→front).';
		if (type === 'cloze') {
			const n = clozeInfo?.numbers.length ?? 0;
			return `Creates ${n} review card${n === 1 ? '' : 's'}, one per cloze number.`;
		}
		if (type === 'typed') return 'Creates 1 review card; you type the answer.';
		return 'Creates 1 review card.';
	});

	const canSave = $derived.by(() => {
		if (!deckId || !front.trim()) return false;
		if (type === 'cloze') return (clozeInfo?.numbers.length ?? 0) > 0;
		return back.trim().length > 0;
	});

	function save(keepGoing = true) {
		if (!canSave) return;
		if (editing && editId) {
			app.updateNote(editId, {
				deckId,
				type,
				front,
				back,
				extra,
				tags,
				imageFront,
				imageBack,
				starred
			});
			app.toast('success', 'Card updated.');
			goto('/browse');
			return;
		}
		if (duplicate) {
			app.toast('error', 'A card with this front already exists in this deck.');
			return;
		}
		app.createNote({ deckId, type, front, back, extra, tags, imageFront, imageBack, starred });
		addedCount += 1;
		app.toast('success', `Added. ${addedCount} card${addedCount === 1 ? '' : 's'} this session.`);
		// Keep deck, type and tags; clear the content for the next card.
		front = '';
		back = '';
		extra = '';
		imageFront = null;
		imageBack = null;
		if (keepGoing) frontEl?.focus();
	}

	function onFieldKeydown(e: KeyboardEvent, isMultiline: boolean) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			save();
			return;
		}
		// Plain Enter saves from the single-line-ish fields; multi-line boxes keep Enter
		// for new lines so formatting and code blocks still work.
		if (e.key === 'Enter' && !isMultiline && !e.shiftKey) {
			e.preventDefault();
			save();
		}
	}

	async function pickImage(side: 'front' | 'back', e: Event) {
		imageError = null;
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const result = await compressImage(file);
		if (!result.ok || !result.dataUrl) {
			imageError = result.error ?? 'The image could not be stored.';
			input.value = '';
			return;
		}
		if (side === 'front') imageFront = result.dataUrl;
		else imageBack = result.dataUrl;
		if (app.storageNearlyFull) {
			app.toast('error', 'Storage is getting full. Export a backup and remove some images.');
		}
		input.value = '';
	}

	const TYPES: { value: CardType; label: string; hint: string }[] = [
		{ value: 'basic', label: 'Basic', hint: 'Front and back' },
		{ value: 'reversed', label: 'Basic and reversed', hint: 'Two review cards' },
		{ value: 'cloze', label: 'Cloze deletion', hint: '{{c1::hidden}}' },
		{ value: 'typed', label: 'Typed answer', hint: 'You type the answer' }
	];
</script>

<div class="mx-auto flex w-full max-w-4xl flex-col gap-4">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h1 class="ff-h1">{editing ? 'Edit card' : 'Add cards'}</h1>
		<div class="flex gap-2">
			{#if addedCount > 0}
				<span class="ff-chip">{addedCount} added</span>
			{/if}
			<a class="ff-btn ff-btn-sm" href="/browse">Card browser</a>
		</div>
	</div>

	{#if app.data.decks.length === 0}
		<div class="ff-card p-8 text-center">
			<p class="ff-h2">You need a deck first</p>
			<p class="ff-muted mt-2 text-[0.88rem]">Create a deck on the Decks screen, then come back.</p>
			<a class="ff-btn ff-btn-primary mt-4" href="/">Go to Decks</a>
		</div>
	{:else}
		<div class="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
			<!-- Form -->
			<section class="ff-card flex flex-col gap-3 p-4">
				<div class="grid gap-3 sm:grid-cols-2">
					<div>
						<label class="ff-label" for="add-deck">Deck</label>
						<DeckPicker id="add-deck" value={deckId} onchange={(v) => (deckId = v)} />
					</div>
					<div>
						<label class="ff-label" for="add-type">Card type</label>
						<select
							id="add-type"
							class="ff-input"
							bind:value={type}
							disabled={!!editing && false}
						>
							{#each TYPES as t (t.value)}
								<option value={t.value}>{t.label} — {t.hint}</option>
							{/each}
						</select>
					</div>
				</div>

				<div>
					<label class="ff-label" for="add-front">
						{type === 'cloze' ? 'Text with cloze markers' : 'Front'}
					</label>
					<textarea
						id="add-front"
						class="ff-input"
						rows={type === 'cloze' ? 4 : 2}
						bind:this={frontEl}
						bind:value={front}
						onkeydown={(e) => onFieldKeydown(e, true)}
						placeholder={type === 'cloze'
							? 'The capital of India is {{c1::New Delhi}}.'
							: 'Question or term'}
					></textarea>
					{#if duplicate}
						<p class="mt-1 text-[0.76rem] font-semibold" style="color: var(--color-again)">
							A card with this front already exists in this deck.
						</p>
					{/if}
					{#if clozeInfo}
						{#if clozeInfo.errors.length}
							{#each clozeInfo.errors as err, i (i)}
								<p class="mt-1 text-[0.76rem]" style="color: var(--color-again)">{err}</p>
							{/each}
						{:else}
							<p class="ff-muted mt-1 text-[0.76rem]">
								Cloze numbers found: {clozeInfo.numbers.map((n) => `c${n}`).join(', ')}
							</p>
						{/if}
					{/if}
				</div>

				{#if type !== 'cloze'}
					<div>
						<label class="ff-label" for="add-back">Back</label>
						<textarea
							id="add-back"
							class="ff-input"
							rows="2"
							bind:value={back}
							onkeydown={(e) => onFieldKeydown(e, true)}
							placeholder="Answer"
						></textarea>
					</div>
				{/if}

				<div>
					<label class="ff-label" for="add-extra">Extra — notes or mnemonic (optional)</label>
					<textarea
						id="add-extra"
						class="ff-input"
						rows="2"
						bind:value={extra}
						onkeydown={(e) => onFieldKeydown(e, true)}
					></textarea>
				</div>

				<div class="grid gap-3 sm:grid-cols-2">
					<div>
						<label class="ff-label" for="add-tags">Tags (space separated)</label>
						<input
							id="add-tags"
							class="ff-input"
							bind:value={tagsText}
							onkeydown={(e) => onFieldKeydown(e, false)}
						/>
					</div>
					<div class="flex items-end gap-3 pb-1">
						<label class="flex items-center gap-2 text-[0.85rem] font-semibold">
							<input type="checkbox" bind:checked={starred} class="h-4 w-4" />
							Starred
						</label>
					</div>
				</div>

				<!-- Images -->
				<fieldset class="rounded-lg border p-3" style="border-color: var(--border)">
					<legend class="ff-label mb-0 px-1">Images (optional, under 100 KB each)</legend>
					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label class="ff-muted block text-[0.76rem] font-semibold" for="img-front"
								>Front image</label
							>
							<input
								id="img-front"
								type="file"
								accept="image/*"
								class="mt-1 w-full text-[0.78rem]"
								onchange={(e) => pickImage('front', e)}
							/>
							{#if imageFront}
								<div class="mt-2 flex items-center gap-2">
									<img src={imageFront} alt="" class="h-12 rounded" />
									<button class="ff-btn ff-btn-sm" onclick={() => (imageFront = null)}
										>Remove</button
									>
								</div>
							{/if}
						</div>
						<div>
							<label class="ff-muted block text-[0.76rem] font-semibold" for="img-back"
								>Back image</label
							>
							<input
								id="img-back"
								type="file"
								accept="image/*"
								class="mt-1 w-full text-[0.78rem]"
								onchange={(e) => pickImage('back', e)}
							/>
							{#if imageBack}
								<div class="mt-2 flex items-center gap-2">
									<img src={imageBack} alt="" class="h-12 rounded" />
									<button class="ff-btn ff-btn-sm" onclick={() => (imageBack = null)}>Remove</button
									>
								</div>
							{/if}
						</div>
					</div>
					{#if imageError}
						<p class="mt-2 text-[0.78rem]" style="color: var(--color-again)">{imageError}</p>
					{/if}
				</fieldset>

				<div class="flex flex-wrap items-center gap-2 pt-1">
					<button class="ff-btn ff-btn-primary" onclick={() => save()} disabled={!canSave}>
						{editing ? 'Save changes' : 'Add card'}
					</button>
					{#if editing}
						<a class="ff-btn" href="/browse">Cancel</a>
					{/if}
					<p class="ff-muted text-[0.76rem]">
						{cardCountLabel} Enter adds · Ctrl/Cmd+Enter adds from any field · Tab moves on.
					</p>
				</div>
			</section>

			<!-- Live preview + formatting help -->
			<section class="flex flex-col gap-4">
				<div class="ff-card p-4">
					<h2 class="ff-h2 mb-3">Preview</h2>
					<div class="rounded-lg p-4" style="background: var(--surface-sunken)">
						<p class="ff-muted mb-2 text-[0.68rem] font-semibold uppercase">Front</p>
						<CardFace
							text={type === 'cloze'
								? front.replace(/\{\{c\d+::(.*?)(::.*?)?\}\}/g, '[...]')
								: front || '—'}
							image={imageFront}
							scale={0.85}
						/>
						<p class="ff-muted mt-4 mb-2 text-[0.68rem] font-semibold uppercase">Back</p>
						<CardFace
							text={type === 'cloze'
								? front.replace(/\{\{c\d+::(.*?)(::.*?)?\}\}/g, '$1') || '—'
								: back || '—'}
							image={imageBack}
							scale={0.85}
						/>
					</div>
				</div>

				<div class="ff-card p-4">
					<h2 class="ff-h2 mb-2">Formatting</h2>
					<ul class="ff-muted flex flex-col gap-1 text-[0.8rem]">
						<li><code class="ff-code">**bold**</code> and <code class="ff-code">*italic*</code></li>
						<li><code class="ff-code">- item</code> at line start makes a bullet list</li>
						<li><code class="ff-code">`code`</code> inline, and ``` on its own line for a block</li>
						<li>A blank line starts a new paragraph; single line breaks are kept</li>
						<li>
							Cloze: <code class="ff-code">{'{{c1::hidden}}'}</code> or
							<code class="ff-code">{'{{c1::hidden::hint}}'}</code>
						</li>
					</ul>
				</div>
			</section>
		</div>
	{/if}
</div>
