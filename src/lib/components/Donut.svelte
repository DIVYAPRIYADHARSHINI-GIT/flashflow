<script lang="ts">
	// Hand-written SVG donut. Slices are drawn with stroke-dasharray on concentric circles,
	// which avoids any arc-path maths and renders crisply at every size.
	interface Slice {
		label: string;
		value: number;
		color: string;
	}
	interface Props {
		slices: Slice[];
		size?: number;
		title: string;
	}
	let { slices, size = 160, title }: Props = $props();

	const total = $derived(slices.reduce((s, x) => s + x.value, 0));
	const radius = 40;
	const circumference = 2 * Math.PI * radius;

	const segments = $derived.by(() => {
		let offset = 0;
		return slices
			.filter((s) => s.value > 0)
			.map((s) => {
				const fraction = total ? s.value / total : 0;
				const seg = {
					...s,
					dash: fraction * circumference,
					gap: circumference - fraction * circumference,
					offset: -offset
				};
				offset += fraction * circumference;
				return seg;
			});
	});
</script>

{#if total === 0}
	<p class="ff-muted py-6 text-center text-[0.84rem]">No cards yet.</p>
{:else}
	<div class="flex flex-wrap items-center gap-4">
		<svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title}>
			<circle cx="50" cy="50" r={radius} fill="none" stroke="var(--surface-sunken)" stroke-width="16" />
			{#each segments as seg (seg.label)}
				<circle
					cx="50"
					cy="50"
					r={radius}
					fill="none"
					stroke={seg.color}
					stroke-width="16"
					stroke-dasharray="{seg.dash} {seg.gap}"
					stroke-dashoffset={seg.offset}
					transform="rotate(-90 50 50)"
				/>
			{/each}
			<text
				x="50"
				y="50"
				text-anchor="middle"
				dominant-baseline="central"
				font-size="15"
				font-weight="700"
				fill="var(--text)">{total}</text
			>
		</svg>
		<ul class="flex min-w-32 flex-col gap-1 text-[0.8rem]">
			{#each slices as s (s.label)}
				<li class="flex items-center gap-2">
					<span class="h-2.5 w-2.5 shrink-0 rounded-sm" style="background: {s.color}"></span>
					<span class="flex-1">{s.label}</span>
					<span class="font-semibold">{s.value}</span>
				</li>
			{/each}
		</ul>
	</div>
{/if}
