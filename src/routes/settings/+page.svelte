<script lang="ts">
	// Settings. Every option is explained in plain language next to the control.
	import { app } from '#lib/store/app-state.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import DeckPicker from '#lib/components/DeckPicker.svelte';
	import { DEFAULT_SETTINGS } from '#lib/types';
	import { formatBytes } from '#lib/store/study-store';

	let confirmReset = $state(false);
	let confirmFresh = $state(false);
	let confirmSample = $state(false);
	let deckOverrideId = $state('');
	let notifyStatus = $state('');

	const s = $derived(app.data.settings);

	function stepsText(steps: number[]): string {
		return steps.join(' ');
	}

	function parseSteps(text: string): number[] {
		const out = text
			.split(/[\s,]+/)
			.map((p) => parseFloat(p))
			.filter((n) => Number.isFinite(n) && n > 0);
		return out.length ? out : [1];
	}

	function num(e: Event): number {
		return parseFloat((e.currentTarget as HTMLInputElement).value);
	}

	async function enableNotifications() {
		if (typeof Notification === 'undefined') {
			notifyStatus = 'This browser does not support notifications.';
			return;
		}
		const permission = await Notification.requestPermission();
		if (permission === 'granted') {
			app.updateSettings({ notificationsEnabled: true });
			notifyStatus = 'Notifications enabled for while the app is open.';
		} else {
			app.updateSettings({ notificationsEnabled: false });
			notifyStatus = `Permission was ${permission}. You can change it in your browser settings.`;
		}
	}

	const deckOverride = $derived(deckOverrideId ? app.deck(deckOverrideId) : undefined);
</script>

<div class="flex max-w-3xl flex-col gap-4">
	<h1 class="ff-h1">Settings</h1>

	<!-- Daily limits -->
	<section class="ff-card p-4">
		<h2 class="ff-h2">Daily limits</h2>
		<div class="mt-3 grid gap-4 sm:grid-cols-2">
			<div>
				<label class="ff-label" for="s-new">New cards per day</label>
				<input
					id="s-new"
					class="ff-input"
					type="number"
					min="0"
					max="9999"
					value={s.newPerDay}
					onchange={(e) => app.updateSettings({ newPerDay: Math.max(0, num(e)) })}
				/>
				<p class="ff-muted mt-1 text-[0.76rem]">
					How many never-seen cards enter the queue each day. Introducing fewer keeps tomorrow's
					review load smaller.
				</p>
			</div>
			<div>
				<label class="ff-label" for="s-max">Maximum reviews per day</label>
				<input
					id="s-max"
					class="ff-input"
					type="number"
					min="0"
					max="99999"
					value={s.maxReviewsPerDay}
					onchange={(e) => app.updateSettings({ maxReviewsPerDay: Math.max(0, num(e)) })}
				/>
				<p class="ff-muted mt-1 text-[0.76rem]">
					A ceiling on the whole daily queue, so a backlog cannot show up as 900 cards at once.
				</p>
			</div>
			<div>
				<label class="ff-label" for="s-ratio">Reviews between new cards</label>
				<input
					id="s-ratio"
					class="ff-input"
					type="number"
					min="1"
					max="50"
					value={s.newReviewRatio}
					onchange={(e) => app.updateSettings({ newReviewRatio: Math.max(1, num(e)) })}
				/>
				<p class="ff-muted mt-1 text-[0.76rem]">
					New cards are mixed in at this ratio: one new card after this many reviews.
				</p>
			</div>
			<div>
				<label class="ff-label" for="s-goal">Daily goal (reviews for a streak day)</label>
				<input
					id="s-goal"
					class="ff-input"
					type="number"
					min="1"
					max="999"
					value={s.dailyGoal}
					onchange={(e) => app.updateSettings({ dailyGoal: Math.max(1, num(e)) })}
				/>
				<p class="ff-muted mt-1 text-[0.76rem]">
					A day counts towards your streak once you complete this many reviews.
				</p>
			</div>
		</div>

		<hr class="my-4" style="border-color: var(--border)" />
		<h3 class="ff-h2 text-[0.95rem]">Per-deck new card limit</h3>
		<p class="ff-muted mt-1 text-[0.8rem]">
			Override the new-cards-per-day limit for one deck. Leave empty to use the global setting.
		</p>
		<div class="mt-2 flex flex-wrap items-end gap-2">
			<div class="w-52">
				<label class="ff-label" for="s-override-deck">Deck</label>
				<DeckPicker
					id="s-override-deck"
					value={deckOverrideId}
					includeAll
					allLabel="Choose a deck"
					onchange={(v) => (deckOverrideId = v)}
				/>
			</div>
			{#if deckOverride}
				<div class="w-40">
					<label class="ff-label" for="s-override-value">New cards per day</label>
					<input
						id="s-override-value"
						class="ff-input"
						type="number"
						min="0"
						placeholder="Global ({s.newPerDay})"
						value={deckOverride.newPerDay ?? ''}
						onchange={(e) => {
							const raw = (e.currentTarget as HTMLInputElement).value.trim();
							app.updateDeck(deckOverride!.id, {
								newPerDay: raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0)
							});
							app.toast('success', 'Deck limit updated.');
						}}
					/>
				</div>
			{/if}
		</div>
	</section>

	<!-- Scheduler -->
	<section class="ff-card p-4">
		<h2 class="ff-h2">Scheduler</h2>
		<p class="ff-muted mt-1 text-[0.8rem]">
			FlashFlow uses a simple spaced repetition scheduler in the SM-2 style. See
			<a class="underline" href="/about">About</a> for exactly how it works.
		</p>
		<div class="mt-3 grid gap-4 sm:grid-cols-2">
			<div>
				<label class="ff-label" for="s-learn">Learning steps (minutes)</label>
				<input
					id="s-learn"
					class="ff-input"
					value={stepsText(s.learningSteps)}
					onchange={(e) =>
						app.updateSettings({
							learningSteps: parseSteps((e.currentTarget as HTMLInputElement).value)
						})}
				/>
				<p class="ff-muted mt-1 text-[0.76rem]">
					A new card walks these steps before it becomes a review card. Default "1 10" means one
					minute, then ten minutes.
				</p>
			</div>
			<div>
				<label class="ff-label" for="s-relearn">Relearning steps (minutes)</label>
				<input
					id="s-relearn"
					class="ff-input"
					value={stepsText(s.relearningSteps)}
					onchange={(e) =>
						app.updateSettings({
							relearningSteps: parseSteps((e.currentTarget as HTMLInputElement).value)
						})}
				/>
				<p class="ff-muted mt-1 text-[0.76rem]">
					Where a lapsed card goes after you answer Again. Default is ten minutes.
				</p>
			</div>
			<div>
				<label class="ff-label" for="s-grad">Graduating interval (days)</label>
				<input
					id="s-grad"
					class="ff-input"
					type="number"
					min="1"
					value={s.graduatingInterval}
					onchange={(e) => app.updateSettings({ graduatingInterval: Math.max(1, num(e)) })}
				/>
				<p class="ff-muted mt-1 text-[0.76rem]">
					The first review interval after finishing the learning steps with Good.
				</p>
			</div>
			<div>
				<label class="ff-label" for="s-easy-int">Easy interval (days)</label>
				<input
					id="s-easy-int"
					class="ff-input"
					type="number"
					min="1"
					value={s.easyInterval}
					onchange={(e) => app.updateSettings({ easyInterval: Math.max(1, num(e)) })}
				/>
				<p class="ff-muted mt-1 text-[0.76rem]">
					Answering Easy on a learning card skips the remaining steps and jumps to this interval.
				</p>
			</div>
			<div>
				<label class="ff-label" for="s-ease">Starting ease</label>
				<input
					id="s-ease"
					class="ff-input"
					type="number"
					min="1.3"
					max="5"
					step="0.1"
					value={s.startingEase}
					onchange={(e) => app.updateSettings({ startingEase: Math.max(1.3, num(e)) })}
				/>
				<p class="ff-muted mt-1 text-[0.76rem]">
					The multiplier a new card starts with. Good multiplies the interval by the ease; the ease
					never drops below 1.3.
				</p>
			</div>
			<div>
				<label class="ff-label" for="s-bonus">Easy bonus</label>
				<input
					id="s-bonus"
					class="ff-input"
					type="number"
					min="1"
					max="3"
					step="0.05"
					value={s.easyBonus}
					onchange={(e) => app.updateSettings({ easyBonus: Math.max(1, num(e)) })}
				/>
				<p class="ff-muted mt-1 text-[0.76rem]">
					Extra multiplier applied on top of the ease when you answer Easy.
				</p>
			</div>
			<div>
				<label class="ff-label" for="s-mod">Interval modifier</label>
				<input
					id="s-mod"
					class="ff-input"
					type="number"
					min="0.5"
					max="2"
					step="0.05"
					value={s.intervalModifier}
					onchange={(e) => app.updateSettings({ intervalModifier: Math.max(0.5, num(e)) })}
				/>
				<p class="ff-muted mt-1 text-[0.76rem]">
					Scales every review interval. Below 1 means more frequent reviews overall.
				</p>
			</div>
			<div>
				<label class="ff-label" for="s-max-int">Maximum interval (days)</label>
				<input
					id="s-max-int"
					class="ff-input"
					type="number"
					min="1"
					max="36500"
					value={s.maxInterval}
					onchange={(e) => app.updateSettings({ maxInterval: Math.max(1, num(e)) })}
				/>
				<p class="ff-muted mt-1 text-[0.76rem]">
					No card is ever scheduled further out than this, however well you know it.
				</p>
			</div>
			<div>
				<label class="ff-label" for="s-leech">Leech threshold (lapses)</label>
				<input
					id="s-leech"
					class="ff-input"
					type="number"
					min="1"
					max="99"
					value={s.leechThreshold}
					onchange={(e) => app.updateSettings({ leechThreshold: Math.max(1, num(e)) })}
				/>
				<p class="ff-muted mt-1 text-[0.76rem]">
					After this many Again answers a card is tagged "leech" and FlashFlow suggests suspending
					or rewriting it.
				</p>
			</div>
			<div>
				<label class="ff-label" for="s-rollover">New day starts at (hour)</label>
				<input
					id="s-rollover"
					class="ff-input"
					type="number"
					min="0"
					max="23"
					value={s.dayStartHour}
					onchange={(e) =>
						app.updateSettings({ dayStartHour: Math.min(23, Math.max(0, Math.round(num(e)))) })}
				/>
				<p class="ff-muted mt-1 text-[0.76rem]">
					Studying before this hour counts for the previous day, so a late-night session does not
					break your streak. Your current study day is {app.today}.
				</p>
			</div>
		</div>

		<div class="mt-4 flex flex-col gap-3">
			<label class="flex items-start gap-2.5 text-[0.88rem]">
				<input
					type="checkbox"
					class="mt-0.5 h-4 w-4"
					checked={s.burySiblings}
					onchange={(e) =>
						app.updateSettings({ burySiblings: (e.currentTarget as HTMLInputElement).checked })}
				/>
				<span>
					<strong>Bury siblings</strong>
					<span class="ff-muted block text-[0.78rem]">
						Only one card per note is shown each day, so the two sides of a reversed card (or
						several clozes from one sentence) do not appear together.
					</span>
				</span>
			</label>
			<label class="flex items-start gap-2.5 text-[0.88rem]">
				<input
					type="checkbox"
					class="mt-0.5 h-4 w-4"
					checked={s.showNextIntervals}
					onchange={(e) =>
						app.updateSettings({ showNextIntervals: (e.currentTarget as HTMLInputElement).checked })}
				/>
				<span>
					<strong>Show next interval on the answer buttons</strong>
					<span class="ff-muted block text-[0.78rem]">
						Each button shows where the card will land, such as "Good 10d".
					</span>
				</span>
			</label>
		</div>
	</section>

	<!-- Typed answers -->
	<section class="ff-card p-4">
		<h2 class="ff-h2">Typed answers</h2>
		<div class="mt-3 flex flex-col gap-3">
			<label class="flex items-start gap-2.5 text-[0.88rem]">
				<input
					type="checkbox"
					class="mt-0.5 h-4 w-4"
					checked={s.typedIgnoreAccents}
					onchange={(e) =>
						app.updateSettings({ typedIgnoreAccents: (e.currentTarget as HTMLInputElement).checked })}
				/>
				<span>
					<strong>Ignore accents</strong>
					<span class="ff-muted block text-[0.78rem]">"cafe" is accepted for "café".</span>
				</span>
			</label>
			<label class="flex items-start gap-2.5 text-[0.88rem]">
				<input
					type="checkbox"
					class="mt-0.5 h-4 w-4"
					checked={s.typedIgnorePunctuation}
					onchange={(e) =>
						app.updateSettings({
							typedIgnorePunctuation: (e.currentTarget as HTMLInputElement).checked
						})}
				/>
				<span>
					<strong>Ignore punctuation</strong>
					<span class="ff-muted block text-[0.78rem]">"its" is accepted for "it's".</span>
				</span>
			</label>
			<p class="ff-muted text-[0.78rem]">
				Letter case and extra spaces are always ignored.
			</p>
		</div>
	</section>

	<!-- Appearance -->
	<section class="ff-card p-4">
		<h2 class="ff-h2">Appearance</h2>
		<div class="mt-3 grid gap-4 sm:grid-cols-3">
			<div>
				<label class="ff-label" for="s-theme">Theme</label>
				<select
					id="s-theme"
					class="ff-input"
					value={s.theme}
					onchange={(e) =>
						app.updateSettings({
							theme: (e.currentTarget as HTMLSelectElement).value as 'light' | 'dark' | 'system'
						})}
				>
					<option value="system">Match my system</option>
					<option value="light">Light</option>
					<option value="dark">Dark</option>
				</select>
			</div>
			<div>
				<label class="ff-label" for="s-font">Card font</label>
				<select
					id="s-font"
					class="ff-input"
					value={s.cardFont}
					onchange={(e) =>
						app.updateSettings({
							cardFont: (e.currentTarget as HTMLSelectElement).value as 'sans' | 'serif'
						})}
				>
					<option value="sans">Inter (sans serif)</option>
					<option value="serif">Source Serif (serif)</option>
				</select>
			</div>
			<div>
				<label class="ff-label" for="s-size">Card font size ({s.cardFontSize}px)</label>
				<input
					id="s-size"
					class="w-full"
					type="range"
					min="14"
					max="40"
					value={s.cardFontSize}
					oninput={(e) => app.updateSettings({ cardFontSize: Math.round(num(e)) })}
				/>
			</div>
		</div>
	</section>

	<!-- Reminders -->
	<section class="ff-card p-4">
		<h2 class="ff-h2">Reminders</h2>
		<p class="ff-muted mt-1 text-[0.84rem] leading-relaxed">
			FlashFlow shows the number of due cards in the tab title and as a banner in the app. It can
			also show one browser notification while the app is open.
			<strong>There is no background push notification</strong>, because FlashFlow has no server
			and no account - nothing runs when the tab is closed.
		</p>
		<div class="mt-3 flex flex-wrap items-center gap-2">
			{#if s.notificationsEnabled}
				<button
					class="ff-btn"
					onclick={() => {
						app.updateSettings({ notificationsEnabled: false });
						notifyStatus = 'Notifications turned off in FlashFlow.';
					}}>Turn off notifications</button
				>
			{:else}
				<button class="ff-btn" onclick={enableNotifications}>Enable notifications</button>
			{/if}
			{#if notifyStatus}
				<span class="ff-muted text-[0.8rem]">{notifyStatus}</span>
			{/if}
		</div>
	</section>

	<!-- Data tools -->
	<section class="ff-card p-4">
		<h2 class="ff-h2">Data</h2>
		<p class="ff-muted mt-1 text-[0.84rem]">
			{formatBytes(app.usedBytes)} used in this browser · {app.data.decks.length} decks · {app.data
				.cards.length} cards
		</p>
		<div class="mt-3 flex flex-wrap gap-2">
			<a class="ff-btn ff-btn-primary" href="/privacy">Backup and storage</a>
			<button class="ff-btn" onclick={() => (confirmSample = true)}>Load sample data</button>
			<button class="ff-btn" onclick={() => (confirmReset = true)}>Reset settings to defaults</button
			>
			<button class="ff-btn ff-btn-danger" onclick={() => (confirmFresh = true)}>Start fresh</button>
		</div>
		<p class="ff-muted mt-2 text-[0.78rem]">
			"Start fresh" deletes every deck, card and review in this browser. Export a backup first if
			you may want your progress back.
		</p>
	</section>
</div>

<ConfirmDialog
	open={confirmReset}
	title="Reset all settings?"
	body="Every scheduler, limit and appearance setting returns to the FlashFlow defaults. Your decks, cards and progress are not touched."
	confirmLabel="Reset settings"
	danger={false}
	onconfirm={() => {
		app.resetSettings();
		app.toast('success', 'Settings reset to defaults.');
		confirmReset = false;
	}}
	oncancel={() => (confirmReset = false)}
/>

<ConfirmDialog
	open={confirmSample}
	title="Load the sample decks?"
	body="This replaces everything in this browser with the three FlashFlow sample decks and their generated 60-day review history."
	confirmLabel="Load sample data"
	onconfirm={() => {
		app.loadSampleData();
		confirmSample = false;
	}}
	oncancel={() => (confirmSample = false)}
/>

<ConfirmDialog
	open={confirmFresh}
	title="Delete everything and start fresh?"
	body="All decks, cards, tags, images and review history in this browser will be deleted. This cannot be undone."
	confirmLabel="Delete everything"
	onconfirm={() => {
		app.startFresh();
		confirmFresh = false;
	}}
	oncancel={() => (confirmFresh = false)}
/>
