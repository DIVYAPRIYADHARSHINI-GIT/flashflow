<script lang="ts">
	// Confirmation dialog for destructive actions. Focus is trapped to the dialog and
	// Escape cancels, so it is fully keyboard usable.
	interface Props {
		open: boolean;
		title: string;
		body?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		danger?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	}
	let {
		open,
		title,
		body = '',
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		danger = true,
		onconfirm,
		oncancel
	}: Props = $props();

	let confirmEl = $state<HTMLButtonElement | null>(null);

	$effect(() => {
		if (open && confirmEl) confirmEl.focus();
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			oncancel();
		}
	}
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open}
	<div
		class="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) oncancel();
		}}
	>
		<div
			class="ff-card w-full max-w-md p-5 shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="confirm-title"
		>
			<h2 id="confirm-title" class="ff-h2">{title}</h2>
			{#if body}
				<p class="ff-muted mt-2 text-[0.88rem] leading-relaxed">{body}</p>
			{/if}
			<div class="mt-5 flex justify-end gap-2">
				<button class="ff-btn" onclick={oncancel}>{cancelLabel}</button>
				<button
					bind:this={confirmEl}
					class="ff-btn {danger ? 'ff-btn-danger' : 'ff-btn-primary'}"
					onclick={onconfirm}>{confirmLabel}</button
				>
			</div>
		</div>
	</div>
{/if}
