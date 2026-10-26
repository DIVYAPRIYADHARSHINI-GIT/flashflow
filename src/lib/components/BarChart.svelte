<script lang="ts">
	// Hand-written SVG bar chart (no chart library, per the brief).
	// Supports an optional stacked "highlight" portion drawn at the base of each bar.
	interface Bar {
		label: string;
		value: number;
		highlight?: number;
	}
	interface Props {
		bars: Bar[];
		height?: number;
		color?: string;
		highlightColor?: string;
		/** Show every Nth label so dense charts stay readable. */
		labelEvery?: number;
		valueSuffix?: string;
		title: string;
	}
	let {
		bars,
		height = 140,
		color = 'var(--color-primary)',
		highlightColor = '#9DBBFB',
		labelEvery = 1,
		valueSuffix = '',
		title
	}: Props = $props();

	const max = $derived(Math.max(1, ...bars.map((b) => b.value)));
	const total = $derived(bars.reduce((s, b) => s + b.value, 0));
</script>

{#if total === 0}
	<p class="ff-muted py-6 text-center text-[0.84rem]">No data for this range yet.</p>
{:else}
	<figure class="m-0">
		<figcaption class="sr-only">{title}</figcaption>
		<div class="flex items-end gap-[2px]" style="height: {height}px" role="img" aria-label={title}>
			{#each bars as bar, i (i)}
				<div
					class="relative flex min-w-0 flex-1 flex-col justify-end"
					style="height: 100%"
					title="{bar.label}: {bar.value}{valueSuffix}"
				>
					{#if bar.value > 0}
						<div
							class="w-full rounded-t-[2px]"
							style="height: {(bar.value / max) * 100}%; background: {color}"
						>
							{#if bar.highlight && bar.highlight > 0}
								<div
									class="absolute bottom-0 w-full rounded-t-[2px]"
									style="height: {(bar.highlight / max) * 100}%; background: {highlightColor}"
								></div>
							{/if}
						</div>
					{:else}
						<div class="w-full" style="height: 1px; background: var(--border)"></div>
					{/if}
				</div>
			{/each}
		</div>
		<div class="ff-muted mt-1 flex gap-[2px] text-[0.6rem]">
			{#each bars as bar, i (i)}
				<span class="min-w-0 flex-1 truncate text-center">
					{i % labelEvery === 0 ? bar.label : ''}
				</span>
			{/each}
		</div>
	</figure>
{/if}
