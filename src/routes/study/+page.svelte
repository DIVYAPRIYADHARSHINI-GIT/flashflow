<script lang="ts">
	// The study screen - the hero of FlashFlow.
	// Distraction free: card in the centre, counts in the corner, slim progress bar,
	// Show answer (Space), then the four answer buttons (keys 1-4).
	import { app } from '#lib/store/app-state.svelte';
	import { page } from '$app/state';
	import { buildQueue, type QueueOptions, type StudyMode } from '#lib/logic/queue';
	import { answerPreviews } from '#lib/logic/scheduler';
	import { renderCloze, clozeAnswer } from '#lib/logic/cloze';
	import { compareTyped } from '#lib/logic/typed';
	import { formatDuration } from '#lib/logic/day';
	import { SessionTimer } from '#lib/logic/session';
	import CardFace from '#lib/components/CardFace.svelte';
	import DeckPicker from '#lib/components/DeckPicker.svelte';
	import type { Card, Rating } from '#lib/types';

	// ---- session configuration from the URL -------------------------------------
	const mode = $derived((page.url.searchParams.get('mode') ?? 'normal') as StudyMode);
	const deckParam = $derived(page.url.searchParams.get('deck'));
	const tagParam = $derived(page.url.searchParams.get('tag'));

	let aheadDays = $state(3);
	let cramEnd = $state('');
	let localDeck = $state<string | null>(null);
	let localTag = $state<string | null>(null);

	const deckId = $derived(localDeck ?? deckParam);
	const tag = $derived(localTag ?? tagParam);

	// ---- session state ----------------------------------------------------------
	let sessionId = $state(0); // bumped to force a fresh queue
	let queueIds = $state<string[]>([]);
	let index = $state(0);
	let revealed = $state(false);
	let typedValue = $state('');
	let typedChecked = $state(false);
	let finished = $state(false);
	let paused = $state(false);
	let tick = $state(0);
	let answeredCount = $state(0);
	let correctCount = $state(0);
	let leechNotice = $state<string | null>(null);

	const timer = new SessionTimer();

	const options = $derived<QueueOptions>({
		mode,
		deckId,
		tag,
		aheadDays,
		now: app.now(),
		day: app.today
	});

	const built = $derived(app.loaded ? buildQueue(app.data, options) : null);
	const affectsSchedule = $derived(built?.affectsSchedule ?? true);

	// Rebuild the queue whenever the configuration changes. Writing queueIds inside an
	// effect is safe here because the effect only depends on the options, not on queueIds.
	let lastKey = $state('');
	$effect(() => {
		if (!app.loaded || !built) return;
		const key = `${sessionId}|${mode}|${deckId}|${tag}|${aheadDays}|${app.today}`;
		if (key === lastKey) return;
		lastKey = key;
		queueIds = built.cards.map((c) => c.id);
		index = 0;
		revealed = false;
		typedValue = '';
		typedChecked = false;
		finished = queueIds.length === 0;
		answeredCount = 0;
		correctCount = 0;
		timer.reset();
		timer.startCard(app.now());
	});

	// A 1-second heartbeat so the session clock is visible. No layout thrash: it only
	// updates a counter that one small label reads.
	$effect(() => {
		const id = setInterval(() => {
			tick++;
		}, 1000);
		return () => clearInterval(id);
	});

	const current = $derived.by<Card | null>(() => {
		const id = queueIds[index];
		if (!id) return null;
		return app.data.cards.find((c) => c.id === id) ?? null;
	});
	const note = $derived(current ? app.noteOf(current) : undefined);

	const counts = $derived(built?.counts ?? { new: 0, learning: 0, due: 0 });
	const remaining = $derived(Math.max(0, queueIds.length - index));
	const progress = $derived(
		queueIds.length === 0 ? 0 : Math.round((index / queueIds.length) * 100)
	);

	// ---- card content -----------------------------------------------------------
	const questionText = $derived.by(() => {
		if (!current || !note) return '';
		if (note.type === 'cloze') return renderCloze(note.front, current.ord, false);
		if (note.type === 'reversed' && current.ord === 1) return note.back;
		return note.front;
	});

	const answerText = $derived.by(() => {
		if (!current || !note) return '';
		if (note.type === 'cloze') return renderCloze(note.front, current.ord, true);
		if (note.type === 'reversed' && current.ord === 1) return note.front;
		return note.back;
	});

	const expectedTyped = $derived.by(() => {
		if (!current || !note) return '';
		if (note.type === 'cloze') return clozeAnswer(note.front, current.ord);
		return note.back;
	});

	const questionImage = $derived.by(() => {
		if (!note) return null;
		return note.type === 'reversed' && current?.ord === 1 ? note.imageBack : note.imageFront;
	});
	const answerImage = $derived.by(() => {
		if (!note) return null;
		return note.type === 'reversed' && current?.ord === 1 ? note.imageFront : note.imageBack;
	});

	const typedResult = $derived(
		typedChecked && note
			? compareTyped(typedValue, expectedTyped, {
					ignoreAccents: app.data.settings.typedIgnoreAccents,
					ignorePunctuation: app.data.settings.typedIgnorePunctuation
				})
			: null
	);

	const previews = $derived(
		current ? answerPreviews(current, app.data.settings, app.now()) : null
	);

	const stateLabel = $derived.by(() => {
		if (!current) return '';
		switch (current.state) {
			case 'new':
				return 'New';
			case 'learning':
				return 'Learning';
			case 'relearning':
				return 'Relearning';
			case 'suspended':
				return 'Suspended';
			default:
				return current.interval >= 21 ? 'Review (mature)' : 'Review';
		}
	});

	// Cram sessions can carry an end date; the label just reminds the user.
	const cramLabel = $derived(
		mode === 'cram' && cramEnd ? `Cram until ${cramEnd}` : mode === 'cram' ? 'Cram' : ''
	);

	// ---- actions ------------------------------------------------------------------
	function reveal() {
		if (!current || revealed || paused) return;
		if (note?.type === 'typed' && !typedChecked) {
			typedChecked = true;
		}
		revealed = true;
	}

	function advance() {
		revealed = false;
		typedValue = '';
		typedChecked = false;
		leechNotice = null;
		if (index + 1 >= queueIds.length) {
			finished = true;
		} else {
			index += 1;
			timer.startCard(app.now());
		}
	}

	function answer(rating: Rating) {
		if (!current || !revealed || paused) return;
		const ms = timer.finishCard(app.now());
		const result = app.answer(current.id, rating, ms, affectsSchedule);
		answeredCount += 1;
		if (rating > 1) correctCount += 1;
		if (result && 'becameLeech' in result && result.becameLeech) {
			leechNotice = current.id;
			app.toast(
				'info',
				'This card has reached the leech threshold. Consider suspending or rewriting it.'
			);
		}

		if (affectsSchedule) {
			// A learning card that is still due in this session comes back at the end.
			const updated = app.data.cards.find((c) => c.id === current!.id);
			if (
				updated &&
				(updated.state === 'learning' || updated.state === 'relearning') &&
				updated.due <= app.now() + 20 * 60_000
			) {
				queueIds = [...queueIds.filter((_, i) => i !== index), updated.id];
				// Removing the current index means the next card slides into this position.
				revealed = false;
				typedValue = '';
				typedChecked = false;
				timer.startCard(app.now());
				if (index >= queueIds.length) finished = true;
				return;
			}
		}
		advance();
	}

	function undo() {
		if (!app.undo) return;
		const cardId = app.undo.card.id;
		if (app.undoLast()) {
			answeredCount = Math.max(0, answeredCount - 1);
			// Put the card back in front of the user.
			const at = queueIds.indexOf(cardId);
			if (at === -1) {
				queueIds = [...queueIds.slice(0, index), cardId, ...queueIds.slice(index)];
			} else {
				index = at;
			}
			finished = false;
			revealed = false;
			typedValue = '';
			typedChecked = false;
			timer.startCard(app.now());
			app.toast('success', 'Last answer undone.');
		}
	}

	function suspendCurrent() {
		if (!current) return;
		app.suspend([current.id]);
		app.toast('info', 'Card suspended. You can unsuspend it from Browse.');
		queueIds = queueIds.filter((id) => id !== current!.id);
		if (index >= queueIds.length) finished = true;
		revealed = false;
		timer.startCard(app.now());
	}

	function buryCurrent() {
		if (!current) return;
		app.bury([current.id]);
		app.toast('info', 'Card buried until tomorrow.');
		queueIds = queueIds.filter((id) => id !== current!.id);
		if (index >= queueIds.length) finished = true;
		revealed = false;
		timer.startCard(app.now());
	}

	function togglePause() {
		paused = !paused;
		if (paused) timer.pause(app.now());
		else timer.resume(app.now());
	}

	function restart() {
		sessionId += 1;
		lastKey = '';
		finished = false;
	}

	// ---- keyboard ------------------------------------------------------------------
	function onKeydown(e: KeyboardEvent) {
		const el = e.target as HTMLElement | null;
		const typing =
			el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

		if (typing) {
			// In the typed-answer box, Enter checks the answer.
			if (e.key === 'Enter' && note?.type === 'typed' && !revealed) {
				e.preventDefault();
				reveal();
			}
			return;
		}

		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			if (finished) return;
			if (!revealed) reveal();
			else answer(3);
			return;
		}
		if (revealed && e.key >= '1' && e.key <= '4') {
			e.preventDefault();
			answer(Number(e.key) as Rating);
			return;
		}
		if (e.key === 'u' || e.key === 'z') {
			e.preventDefault();
			undo();
		}
		if (e.key === 'p') {
			e.preventDefault();
			togglePause();
		}
		if (e.key === '!') suspendCurrent();
		if (e.key === '-') buryCurrent();
	}

	// `tick` is read here so the label refreshes once a second without touching layout.
	const elapsedLabel = $derived.by(() => {
		void tick;
		return formatDuration(timer.elapsed(app.now()));
	});

	const BUTTONS: { rating: Rating; label: string; color: string; key: string }[] = [
		{ rating: 1, label: 'Again', color: 'var(--color-again)', key: '1' },
		{ rating: 2, label: 'Hard', color: 'var(--color-hard)', key: '2' },
		{ rating: 3, label: 'Good', color: 'var(--color-good)', key: '3' },
		{ rating: 4, label: 'Easy', color: 'var(--color-easy)', key: '4' }
	];

	// What is due next after this session, for the summary screen.
	const nextDue = $derived.by(() => {
		const future = app.data.cards
			.filter((c) => c.state === 'review' || c.state === 'learning' || c.state === 'relearning')
			.map((c) => c.due)
			.filter((d) => d > app.now())
			.sort((a, b) => a - b);
		return future[0] ?? null;
	});
</script>

<svelte:window onkeydown={onKeydown} />

<div class="mx-auto flex min-h-[70vh] w-full max-w-3xl flex-col">
	<!-- Header: counts, mode, controls -->
	<div class="no-print flex flex-wrap items-center gap-2 pb-2">
		<a class="ff-btn ff-btn-sm" href="/" aria-label="Back to decks">Decks</a>

		<div class="flex items-center gap-1.5 text-[0.78rem] font-bold" aria-live="polite">
			<span
				class="min-w-7 rounded px-1.5 py-0.5 text-center"
				style="background: var(--chip); color: var(--color-primary)"
				title="New">{counts.new}</span
			>
			<span
				class="min-w-7 rounded px-1.5 py-0.5 text-center"
				style="background: #fff4e6; color: #a35a00"
				title="Learning">{counts.learning}</span
			>
			<span
				class="min-w-7 rounded px-1.5 py-0.5 text-center"
				style="background: #e9f8ee; color: #1f7a32"
				title="Due">{counts.due}</span
			>
			<span class="sr-only"
				>{counts.new} new, {counts.learning} learning, {counts.due} due</span
			>
		</div>

		<div class="flex-1"></div>

		<span class="ff-muted text-[0.75rem]">{elapsedLabel}</span>
		<button class="ff-btn ff-btn-sm" onclick={togglePause} aria-pressed={paused}
			>{paused ? 'Resume' : 'Pause'}</button
		>
		<button class="ff-btn ff-btn-sm" onclick={undo} disabled={!app.undo}>Undo</button>
	</div>

	<!-- Schedule notice for custom study -->
	{#if !affectsSchedule}
		<p
			class="no-print mb-2 rounded-lg px-3 py-1.5 text-[0.78rem] font-semibold"
			style="background: #fff4e6; color: #8a4b00"
			role="status"
		>
			{cramLabel || (mode === 'ahead' ? 'Review ahead' : mode === 'leeches' ? 'Leeches only' : 'Starred only')}
			— this session does not change your schedule.
		</p>
	{/if}

	<!-- Mode controls -->
	{#if mode !== 'normal'}
		<div class="no-print ff-card mb-2 flex flex-wrap items-end gap-2 p-3">
			<div class="min-w-40 flex-1">
				<label class="ff-label" for="study-deck">Deck</label>
				<DeckPicker
					id="study-deck"
					value={deckId ?? ''}
					includeAll
					onchange={(v) => {
						localDeck = v || null;
						restart();
					}}
				/>
			</div>
			{#if mode === 'ahead'}
				<div class="w-32">
					<label class="ff-label" for="ahead-days">Days ahead</label>
					<input
						id="ahead-days"
						class="ff-input"
						type="number"
						min="1"
						max="60"
						bind:value={aheadDays}
						onchange={restart}
					/>
				</div>
			{/if}
			{#if mode === 'cram'}
				<div class="w-44">
					<label class="ff-label" for="cram-end">Exam / end date</label>
					<input id="cram-end" class="ff-input" type="date" bind:value={cramEnd} />
				</div>
			{/if}
			<button class="ff-btn ff-btn-sm" onclick={restart}>Restart session</button>
		</div>
	{/if}

	<!-- Progress bar -->
	<div
		class="no-print h-1 w-full overflow-hidden rounded-full"
		style="background: var(--surface-sunken)"
		role="progressbar"
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={progress}
		aria-label="Session progress"
	>
		<div class="h-full" style="width: {progress}%; background: var(--color-primary)"></div>
	</div>

	<!-- Card -->
	{#if !app.loaded}
		<div class="ff-card mt-4 flex-1 p-8">
			<div class="ff-skeleton mx-auto h-6 w-2/3"></div>
			<div class="ff-skeleton mx-auto mt-4 h-4 w-1/2"></div>
		</div>
	{:else if paused}
		<div class="ff-card mt-4 flex flex-1 flex-col items-center justify-center gap-4 p-10">
			<p class="ff-h2">Paused</p>
			<p class="ff-muted text-[0.88rem]">The session clock is stopped.</p>
			<button class="ff-btn ff-btn-primary" onclick={togglePause}>Resume (P)</button>
		</div>
	{:else if finished}
		<!-- Session summary -->
		<div class="ff-card mt-4 flex-1 p-6 text-center">
			<h1 class="ff-h1">
				{answeredCount > 0 ? 'Session complete' : 'Nothing to study'}
			</h1>
			{#if answeredCount > 0}
				<dl class="mx-auto mt-5 grid max-w-lg grid-cols-3 gap-3">
					<div class="rounded-lg p-3" style="background: var(--surface-sunken)">
						<dt class="ff-muted text-[0.72rem] font-semibold uppercase">Cards studied</dt>
						<dd class="mt-1 text-xl font-bold">{answeredCount}</dd>
					</div>
					<div class="rounded-lg p-3" style="background: var(--surface-sunken)">
						<dt class="ff-muted text-[0.72rem] font-semibold uppercase">Correct</dt>
						<dd class="mt-1 text-xl font-bold">
							{Math.round((correctCount / answeredCount) * 100)}%
						</dd>
					</div>
					<div class="rounded-lg p-3" style="background: var(--surface-sunken)">
						<dt class="ff-muted text-[0.72rem] font-semibold uppercase">Time</dt>
						<dd class="mt-1 text-xl font-bold">{formatDuration(timer.elapsed(app.now()))}</dd>
					</div>
				</dl>
			{:else}
				<p class="ff-muted mx-auto mt-3 max-w-md text-[0.9rem]">
					{#if mode === 'normal'}
						There are no cards due in this selection right now. Daily limits may also be reached —
						check Settings, or try a custom study session.
					{:else}
						No cards match this custom session.
					{/if}
				</p>
			{/if}

			<p class="ff-muted mt-4 text-[0.85rem]">
				{#if nextDue}
					Next card is due {new Date(nextDue).toLocaleString()}.
				{:else}
					Nothing else is scheduled yet.
				{/if}
			</p>

			<div class="mt-5 flex flex-wrap justify-center gap-2">
				<a class="ff-btn ff-btn-primary" href="/">Back to decks</a>
				<button class="ff-btn" onclick={restart}>Study again</button>
				<a class="ff-btn" href="/stats">See statistics</a>
			</div>
		</div>
	{:else if current && note}
		<div class="ff-card mt-4 flex flex-1 flex-col p-5 md:p-8">
			<div class="ff-muted mb-3 flex items-center justify-between gap-2 text-[0.72rem]">
				<span class="ff-chip">{app.deckName(current.deckId)}</span>
				<span>{stateLabel} · {remaining} left</span>
			</div>

			<!-- Question -->
			<div class="flex flex-1 flex-col items-center justify-center py-4">
				<div class="w-full" aria-live="polite">
					<CardFace text={questionText} image={questionImage} />
				</div>

				{#if note.type === 'typed' && !revealed}
					<div class="mt-6 w-full max-w-md">
						<label class="ff-label" for="typed-answer">Type the answer</label>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							id="typed-answer"
							class="ff-input text-center"
							bind:value={typedValue}
							autofocus
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
						/>
						<p class="ff-muted mt-1 text-[0.74rem]">Press Enter to check.</p>
					</div>
				{/if}

				{#if revealed}
					<div class="ff-flip mt-5 w-full border-t pt-5" style="border-color: var(--border)">
						{#if typedResult}
							<p
								class="mb-3 text-center text-[0.82rem] font-bold"
								style="color: {typedResult.correct ? 'var(--color-good)' : 'var(--color-again)'}"
								role="status"
							>
								{typedResult.correct ? 'Correct' : 'Not quite'}
							</p>
							{#if !typedResult.correct}
								<p class="mb-3 text-center text-[0.95rem]">
									<span class="ff-muted text-[0.74rem] font-semibold uppercase">You typed:</span>
									<br />
									{#each typedResult.diff as chunk, i (i)}
										{#if chunk.op === 'same'}<span>{chunk.text}</span
											>{:else if chunk.op === 'added'}<span
												style="background: #ffe3e3; color: #b02525; text-decoration: line-through"
												>{chunk.text}</span
											>{:else}<span style="background: #e9f8ee; color: #1f7a32">{chunk.text}</span
											>{/if}
									{/each}
									<br />
									<span class="ff-muted text-[0.7rem]"
										>Struck-through red = extra, green = missing.</span
									>
								</p>
							{/if}
						{/if}

						<div aria-live="polite">
							<CardFace text={answerText} image={answerImage} />
						</div>

						{#if note.extra}
							<div
								class="mt-4 rounded-lg p-3"
								style="background: var(--surface-sunken)"
							>
								<p class="ff-muted mb-1 text-[0.7rem] font-semibold uppercase">Notes</p>
								<CardFace text={note.extra} scale={0.72} align="left" />
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Answer controls -->
			<div class="no-print mt-2">
				{#if !revealed}
					<button class="ff-btn ff-btn-primary w-full py-3 text-[1rem]" onclick={reveal}>
						Show answer <span class="ff-muted ml-1 text-[0.75rem] text-white/70">(Space)</span>
					</button>
				{:else}
					<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
						{#each BUTTONS as btn (btn.rating)}
							<button
								class="flex min-h-[3.25rem] flex-col items-center justify-center rounded-lg border px-2 py-1.5 font-bold text-white"
								style="background: {btn.color}; border-color: {btn.color}"
								onclick={() => answer(btn.rating)}
								aria-label="{btn.label}, next interval {previews?.[btn.rating].label}, shortcut {btn.key}"
							>
								<span class="text-[0.92rem]">{btn.label} <span class="opacity-70">{btn.key}</span></span>
								{#if app.data.settings.showNextIntervals && previews}
									<span class="text-[0.75rem] font-semibold opacity-90"
										>{previews[btn.rating].label}</span
									>
								{/if}
							</button>
						{/each}
					</div>
				{/if}

				<div class="mt-2 flex flex-wrap justify-center gap-2">
					<button class="ff-btn ff-btn-sm" onclick={suspendCurrent}>Suspend</button>
					<button class="ff-btn ff-btn-sm" onclick={buryCurrent}>Bury</button>
					<a class="ff-btn ff-btn-sm" href="/add?edit={note.id}">Edit</a>
					<button class="ff-btn ff-btn-sm" onclick={() => app.toggleStar(note.id)}
						>{note.starred ? 'Unstar' : 'Star'}</button
					>
				</div>

				{#if current.lapses >= app.data.settings.leechThreshold}
					<p
						class="mt-2 rounded-lg px-3 py-2 text-center text-[0.78rem]"
						style="background: #ffe3e3; color: #b02525"
						role="status"
					>
						Leech: {current.lapses} lapses. Consider suspending this card or rewriting it so it is
						easier to recall.
					</p>
				{/if}
			</div>
		</div>
	{:else}
		<div class="ff-card mt-4 flex-1 p-8 text-center">
			<p class="ff-h2">Nothing to study</p>
			<p class="ff-muted mt-2 text-[0.88rem]">
				Add cards or pick another deck.
			</p>
			<a class="ff-btn ff-btn-primary mt-4" href="/">Back to decks</a>
		</div>
	{/if}

	<p class="ff-muted no-print mt-3 text-center text-[0.72rem]">
		Space show answer · 1 Again · 2 Hard · 3 Good · 4 Easy · U undo · P pause
	</p>
</div>
