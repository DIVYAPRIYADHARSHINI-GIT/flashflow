<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { app, BACKUP_REMINDER_DAYS } from '#lib/store/app-state.svelte';
	import Logo from '#lib/components/Logo.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import { buildQueue, DEFAULT_QUEUE_OPTIONS } from '#lib/logic/queue';
	import { formatBytes } from '#lib/store/study-store';

	let { children } = $props();

	// Load from the StudyStore on first mount (client only - localStorage is per browser).
	$effect(() => {
		app.init();
	});

	// Theme class follows the setting without writing back into state.
	$effect(() => {
		if (typeof document === 'undefined') return;
		const theme = app.data.settings.theme;
		const dark =
			theme === 'dark' ||
			(theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
		document.documentElement.classList.toggle('dark', dark);
	});

	const NAV = [
		{ href: '/', label: 'Decks', icon: 'decks' },
		{ href: '/study', label: 'Study', icon: 'study' },
		{ href: '/browse', label: 'Browse', icon: 'browse' },
		{ href: '/stats', label: 'Stats', icon: 'stats' },
		{ href: '/transfer', label: 'Import and export', short: 'Transfer', icon: 'transfer' },
		{ href: '/settings', label: 'Settings', icon: 'settings' }
	] as const;

	const current = $derived(page.url.pathname);

	function isActive(href: string): boolean {
		if (href === '/') return current === '/';
		return current.startsWith(href);
	}

	// Total due across all decks - drives the banner and the tab title count.
	const counts = $derived(
		app.loaded
			? buildQueue(app.data, { ...DEFAULT_QUEUE_OPTIONS, now: app.now(), day: app.today }).counts
			: { new: 0, learning: 0, due: 0 }
	);
	const totalDue = $derived(counts.new + counts.learning + counts.due);
	const title = $derived(
		totalDue > 0 ? `(${totalDue}) FlashFlow` : 'FlashFlow - Study less. Remember more.'
	);

	const saveLabel = $derived(
		app.saveState === 'saving'
			? 'Saving...'
			: app.saveState === 'saved'
				? 'Saved'
				: app.saveState === 'error'
					? 'Not saved'
					: ''
	);

	const showBackupReminder = $derived(app.loaded && app.needsBackupReminder);
	const studyRoute = $derived(current.startsWith('/study'));

	// Optional browser notification while the app is open (no background push - there is
	// no server). Fires at most once per load, and only with granted permission.
	let notified = $state(false);
	$effect(() => {
		if (!app.loaded || notified) return;
		if (!app.data.settings.notificationsEnabled) return;
		if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
		if (totalDue <= 0) return;
		notified = true;
		try {
			new Notification('FlashFlow', {
				body: `${totalDue} card${totalDue === 1 ? '' : 's'} ready to study.`,
				icon: '/favicon.svg'
			});
		} catch {
			// Notifications can throw on some platforms - never break the app for this.
		}
	});

	function iconPath(name: string): string {
		switch (name) {
			case 'decks':
				return 'M4 7h12v9H4zM7 4h12v9';
			case 'study':
				return 'M4 5h16v12H4zM9 11h6';
			case 'browse':
				return 'M4 6h16M4 12h16M4 18h16';
			case 'stats':
				return 'M5 19V9m7 10V5m7 14v-7';
			case 'transfer':
				return 'M7 10l5-5 5 5M12 5v10M5 19h14';
			default:
				return 'M12 9a3 3 0 100 6 3 3 0 000-6M5 12h2m10 0h2M12 5v2m0 10v2';
		}
	}
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<div class="flex min-h-full flex-col">
	<!-- Top bar -->
	<header
		class="no-print sticky top-0 z-30 flex items-center gap-3 border-b px-3 py-2 md:px-4"
		style="background: var(--surface-raised); border-color: var(--border)"
	>
		<a href="/" class="flex items-center gap-2.5 rounded-lg px-1 py-1" aria-label="FlashFlow home">
			<Logo size={30} />
			<span class="flex flex-col leading-none">
				<span class="text-[15px] font-bold tracking-tight">FlashFlow</span>
				<span class="ff-muted mt-0.5 hidden text-[11px] sm:block">Study less. Remember more.</span>
			</span>
		</a>

		<div class="flex-1"></div>

		<!-- Persistent storage badge: required by the brief, shown on every screen. -->
		<a
			href="/privacy"
			class="ff-chip hidden sm:inline-flex"
			title="All your decks, cards and progress are stored only in this browser."
		>
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<path
					d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"
					stroke="currentColor"
					stroke-width="2"
					stroke-linejoin="round"
				/>
			</svg>
			Your data stays in this browser
		</a>

		{#if saveLabel}
			<span
				class="ff-muted hidden text-[11px] md:inline"
				aria-live="polite"
				style={app.saveState === 'error' ? 'color: var(--color-again)' : ''}>{saveLabel}</span
			>
		{/if}
	</header>

	{#if app.loaded && !app.storeAvailable}
		<div
			class="no-print px-3 py-2 text-[0.82rem] md:px-4"
			style="background: #fff4e6; color: #8a4b00"
			role="alert"
		>
			This browser is blocking local storage, so nothing can be saved. Studying still works for
			this session only.
		</div>
	{/if}

	{#if app.loaded && app.storageNearlyFull}
		<div
			class="no-print px-3 py-2 text-[0.82rem] md:px-4"
			style="background: #fff4e6; color: #8a4b00"
			role="alert"
		>
			Storage is getting full ({formatBytes(app.usedBytes)} used).
			<a class="underline" href="/privacy">Export a backup</a> and remove some images or old decks.
		</div>
	{/if}

	<div class="mx-auto flex w-full max-w-[86rem] flex-1 gap-0 md:gap-5 md:px-4 md:py-4">
		<!-- Sidebar (desktop) -->
		<nav
			class="no-print hidden w-52 shrink-0 flex-col gap-1 md:flex"
			aria-label="Main navigation"
		>
			{#each NAV as item (item.href)}
				<a
					href={item.href}
					class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[0.88rem] font-semibold"
					style={isActive(item.href)
						? 'background: var(--chip); color: var(--color-primary)'
						: 'color: var(--text-muted)'}
					aria-current={isActive(item.href) ? 'page' : undefined}
				>
					<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d={iconPath(item.icon)}
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					{item.label}
					{#if item.href === '/study' && totalDue > 0}
						<span
							class="ml-auto rounded-full px-1.5 text-[0.7rem] font-bold text-white"
							style="background: var(--color-primary)">{totalDue}</span
						>
					{/if}
				</a>
			{/each}

			<div class="mt-4 border-t pt-3" style="border-color: var(--border)">
				<a href="/about" class="ff-muted block rounded-lg px-3 py-1.5 text-[0.82rem]">About</a>
				<a href="/privacy" class="ff-muted block rounded-lg px-3 py-1.5 text-[0.82rem]"
					>Privacy and backup</a
				>
			</div>

			{#if showBackupReminder}
				<div
					class="mt-3 rounded-lg p-3 text-[0.78rem] leading-relaxed"
					style="background: #fff4e6; color: #8a4b00"
				>
					{#if app.daysSinceBackup === null}
						You have never exported a backup. Losing this browser's data would lose your study
						progress.
					{:else}
						Last backup was {app.daysSinceBackup} days ago (over {BACKUP_REMINDER_DAYS}).
					{/if}
					<a class="mt-1 block font-semibold underline" href="/privacy">Back up now</a>
				</div>
			{/if}
		</nav>

		<!-- Page -->
		<main class="min-w-0 flex-1 px-3 pt-3 pb-24 md:px-0 md:pt-0 md:pb-4">
			{@render children?.()}
		</main>
	</div>

	<!-- Bottom tab bar (mobile) -->
	{#if !studyRoute}
		<nav
			class="no-print fixed inset-x-0 bottom-0 z-30 flex border-t md:hidden"
			style="background: var(--surface-raised); border-color: var(--border)"
			aria-label="Main navigation"
		>
			{#each NAV as item (item.href)}
				<a
					href={item.href}
					class="relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.65rem] font-semibold"
					style={isActive(item.href) ? 'color: var(--color-primary)' : 'color: var(--text-muted)'}
					aria-current={isActive(item.href) ? 'page' : undefined}
				>
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path
							d={iconPath(item.icon)}
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					{'short' in item ? item.short : item.label}
					{#if item.href === '/study' && totalDue > 0}
						<span
							class="absolute top-1 right-[22%] rounded-full px-1 text-[0.6rem] font-bold text-white"
							style="background: var(--color-primary)">{totalDue}</span
						>
					{/if}
				</a>
			{/each}
		</nav>
	{/if}
</div>

<Toasts />
