<script lang="ts">
	// Renders one side of a card with the user's font and size choice.
	import { renderCardText } from '#lib/logic/format';
	import { app } from '#lib/store/app-state.svelte';

	interface Props {
		text: string;
		image?: string | null;
		/** Multiplier applied to the configured card font size. */
		scale?: number;
		align?: 'center' | 'left';
	}
	let { text, image = null, scale = 1, align = 'center' }: Props = $props();

	const html = $derived(renderCardText(text));
	const size = $derived(Math.round(app.data.settings.cardFontSize * scale));
	// Latin UI font first, then the Indic fallbacks so Tamil / Hindi card text renders.
	const family = $derived(
		app.data.settings.cardFont === 'serif'
			? "var(--font-card-serif), 'FF Noto Tamil', 'FF Noto Devanagari', serif"
			: "var(--font-ui), 'FF Noto Tamil', 'FF Noto Devanagari', sans-serif"
	);
</script>

<div
	class="ff-content"
	style="font-family: {family}; font-size: {size}px; line-height: 1.45; text-align: {align}"
>
	<!-- The text is escaped in renderCardText before any markup is added. -->
	{@html html}
	{#if image}
		<img
			src={image}
			alt=""
			class="mx-auto mt-3 max-h-64 rounded-lg"
			style="max-width: 100%; object-fit: contain"
		/>
	{/if}
</div>
