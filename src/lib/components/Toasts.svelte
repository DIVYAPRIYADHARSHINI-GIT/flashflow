<script lang="ts">
	import { app } from '#lib/store/app-state.svelte';
</script>

<div
	class="no-print pointer-events-none fixed bottom-20 left-1/2 z-50 flex w-[min(92vw,30rem)] -translate-x-1/2 flex-col gap-2 md:bottom-6"
	aria-live="polite"
	aria-atomic="false"
>
	{#each app.toasts as toast (toast.id)}
		<div
			class="ff-card pointer-events-auto flex items-start gap-3 px-3.5 py-2.5 shadow-lg"
			style="border-left: 4px solid {toast.kind === 'error'
				? 'var(--color-again)'
				: toast.kind === 'success'
					? 'var(--color-good)'
					: 'var(--color-primary)'}"
			role={toast.kind === 'error' ? 'alert' : 'status'}
		>
			<p class="flex-1 text-[0.86rem] leading-snug">{toast.text}</p>
			<button
				class="ff-muted shrink-0 rounded px-1 text-lg leading-none hover:opacity-70"
				onclick={() => app.dismissToast(toast.id)}
				aria-label="Dismiss message">×</button
			>
		</div>
	{/each}
</div>
