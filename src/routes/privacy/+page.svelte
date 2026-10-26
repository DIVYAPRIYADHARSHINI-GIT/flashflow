<script lang="ts">
	// Privacy and Backup: the storage meter, the "Last backup" date with its reminder, and
	// JSON export / import. Import never silently overwrites - the user picks Replace or
	// Merge explicitly.
	import { app, BACKUP_REMINDER_DAYS } from '#lib/store/app-state.svelte';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { download } from '#lib/logic/export';
	import { validateBackup } from '#lib/logic/backup';
	import { formatBytes, STORAGE_BUDGET_BYTES } from '#lib/store/study-store';
	import type { AppData } from '#lib/types';

	let importError = $state<string | null>(null);
	let pending = $state<{ data: AppData; summary: Record<string, number>; name: string } | null>(
		null
	);
	let confirmReplace = $state(false);

	const used = $derived(app.loaded ? app.usedBytes : 0);
	const percent = $derived(app.loaded ? app.storagePercent : 0);
	const days = $derived(app.daysSinceBackup);

	function exportBackup() {
		const payload = app.buildBackup();
		const stamp = new Date(app.now()).toISOString().slice(0, 10);
		download(`flashflow-backup-${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
		app.markBackedUp();
		app.toast('success', 'Backup downloaded and the backup date updated.');
	}

	async function onFile(e: Event) {
		importError = null;
		pending = null;
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		let text: string;
		try {
			text = await file.text();
		} catch {
			importError = 'That file could not be read.';
			input.value = '';
			return;
		}
		const result = validateBackup(text);
		if (!result.ok || !result.data || !result.summary) {
			importError = result.error ?? 'That backup could not be read.';
			input.value = '';
			return;
		}
		pending = {
			data: result.data,
			summary: result.summary as unknown as Record<string, number>,
			name: file.name
		};
		input.value = '';
	}

	function applyImport(mode: 'replace' | 'merge') {
		if (!pending) return;
		app.importBackup(pending.data, mode);
		app.toast(
			'success',
			mode === 'replace'
				? 'Backup restored. It replaced the data in this browser.'
				: 'Backup merged into your existing data.'
		);
		pending = null;
		confirmReplace = false;
	}
</script>

<div class="flex max-w-3xl flex-col gap-4">
	<h1 class="ff-h1">Privacy and backup</h1>

	<!-- Where the data lives -->
	<section class="ff-card p-4">
		<h2 class="ff-h2">Where your data is stored</h2>
		<ul class="ff-muted mt-2 flex flex-col gap-1.5 text-[0.88rem] leading-relaxed">
			<li>
				Every deck, card, review and setting is stored in <strong>this browser's localStorage</strong>,
				under the single key <code class="ff-code">flashflow:data:v1</code>.
			</li>
			<li>Nothing is uploaded. There is no account, no server database and no analytics.</li>
			<li>
				The one server route in this app generates PDFs on request. It receives only the rows you
				chose to print, returns the file, and stores nothing.
			</li>
			<li>
				Clearing your browser data, using a different browser or a different device means a
				different, empty FlashFlow. <strong>Export a backup to move or keep your progress.</strong>
			</li>
		</ul>
	</section>

	<!-- Storage meter -->
	<section class="ff-card p-4">
		<h2 class="ff-h2">Storage</h2>
		<div class="mt-3 flex items-center justify-between text-[0.84rem]">
			<span>{formatBytes(used)} of about {formatBytes(STORAGE_BUDGET_BYTES)} used</span>
			<span class="font-bold">{percent}%</span>
		</div>
		<div
			class="mt-1.5 h-2.5 w-full overflow-hidden rounded-full"
			style="background: var(--surface-sunken)"
			role="progressbar"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={percent}
			aria-label="Local storage used"
		>
			<div
				class="h-full"
				style="width: {Math.max(2, percent)}%; background: {percent > 80
					? 'var(--color-again)'
					: percent > 60
						? 'var(--color-hard)'
						: 'var(--color-good)'}"
			></div>
		</div>
		<dl class="ff-muted mt-3 grid grid-cols-2 gap-2 text-[0.8rem] sm:grid-cols-4">
			<div><dt class="font-semibold">Decks</dt><dd>{app.data.decks.length}</dd></div>
			<div><dt class="font-semibold">Cards</dt><dd>{app.data.cards.length}</dd></div>
			<div><dt class="font-semibold">Reviews logged</dt><dd>{app.data.revlog.length}</dd></div>
			<div><dt class="font-semibold">Study days</dt><dd>{app.data.days.length}</dd></div>
		</dl>
		<p class="ff-muted mt-2 text-[0.78rem]">
			Browsers allow roughly 5 MB per site. To keep a year of study comfortably inside that,
			FlashFlow stores a permanent one-line summary per study day and caps the detailed review log
			at the most recent 4,000 answers. Images are compressed under 100 KB each.
		</p>
	</section>

	<!-- Backup -->
	<section class="ff-card p-4">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 class="ff-h2">JSON backup</h2>
			<span
				class="ff-chip"
				style={app.needsBackupReminder ? 'background: #fff4e6; color: #8a4b00' : ''}
			>
				{#if days === null}
					Never backed up
				{:else if days === 0}
					Last backup: today
				{:else}
					Last backup: {days} day{days === 1 ? '' : 's'} ago
				{/if}
			</span>
		</div>

		{#if app.loaded && app.needsBackupReminder}
			<p
				class="mt-3 rounded-lg px-3 py-2 text-[0.84rem]"
				style="background: #fff4e6; color: #8a4b00"
				role="alert"
			>
				{#if days === null}
					You have never exported a backup.
				{:else}
					It has been {days} days since your last backup (the reminder triggers after {BACKUP_REMINDER_DAYS}).
				{/if}
				Losing this browser's data would lose your study progress.
			</p>
		{/if}

		<p class="ff-muted mt-3 text-[0.84rem]">
			The backup contains everything: decks, cards, tags, images, your full scheduling state and the
			review history.
		</p>
		<div class="mt-3 flex flex-wrap gap-2">
			<button class="ff-btn ff-btn-primary" onclick={exportBackup}>Export backup (JSON)</button>
		</div>

		<hr class="my-4" style="border-color: var(--border)" />

		<h3 class="ff-h2 text-[0.95rem]">Restore a backup</h3>
		<p class="ff-muted mt-1 text-[0.84rem]">
			The file is validated first, and nothing is overwritten until you choose below.
		</p>
		<div class="mt-2">
			<label class="ff-label" for="backup-file">Backup file</label>
			<input
				id="backup-file"
				type="file"
				accept="application/json,.json"
				class="text-[0.85rem]"
				onchange={onFile}
			/>
		</div>

		{#if importError}
			<p
				class="mt-3 rounded-lg px-3 py-2 text-[0.84rem]"
				style="background: #ffe3e3; color: #b02525"
				role="alert"
			>
				{importError}
			</p>
		{/if}

		{#if pending}
			<div class="mt-3 rounded-lg p-3" style="background: var(--surface-sunken)">
				<p class="text-[0.86rem] font-semibold">{pending.name} looks valid.</p>
				<p class="ff-muted mt-1 text-[0.82rem]">
					It contains {pending.summary.decks} decks, {pending.summary.notes} notes, {pending.summary
						.cards} cards, {pending.summary.reviews} logged reviews and {pending.summary.days} study
					days.
				</p>
				<div class="mt-3 flex flex-wrap gap-2">
					<button class="ff-btn ff-btn-danger" onclick={() => (confirmReplace = true)}
						>Replace everything</button
					>
					<button class="ff-btn" onclick={() => applyImport('merge')}>Merge into my data</button>
					<button class="ff-btn" onclick={() => (pending = null)}>Cancel</button>
				</div>
				<p class="ff-muted mt-2 text-[0.76rem]">
					Merge keeps what you already have: decks are matched by name, and a card whose front
					already exists in the same deck is skipped rather than replaced.
				</p>
			</div>
		{/if}
	</section>
</div>

<ConfirmDialog
	open={confirmReplace}
	title="Replace all data in this browser?"
	body="Your current decks, cards and review history will be deleted and replaced by the backup. Export a backup of the current data first if you might want it."
	confirmLabel="Replace everything"
	onconfirm={() => applyImport('replace')}
	oncancel={() => (confirmReplace = false)}
/>
