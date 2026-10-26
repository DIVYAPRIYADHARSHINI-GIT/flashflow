<script lang="ts">
	// Calendar heatmap of the last 365 days, laid out in week columns like a contribution
	// graph. Built from day aggregates only - no made-up values.
	import type { HeatCell } from '#lib/logic/stats';
	import { parseDayKey } from '#lib/logic/day';

	let { cells }: { cells: HeatCell[] } = $props();

	const LEVEL_COLORS = [
		'var(--surface-sunken)',
		'#cfe0fd',
		'#9dbbfb',
		'#5c8ff4',
		'var(--color-primary)'
	];

	// Pad the front so the first column starts on a Sunday.
	const weeks = $derived.by(() => {
		if (cells.length === 0) return [];
		const first = parseDayKey(cells[0].day).getDay();
		const padded: (HeatCell | null)[] = [...Array(first).fill(null), ...cells];
		const out: (HeatCell | null)[][] = [];
		for (let i = 0; i < padded.length; i += 7) out.push(padded.slice(i, i + 7));
		return out;
	});

	const totalReviews = $derived(cells.reduce((s, c) => s + c.reviews, 0));
	const activeDays = $derived(cells.filter((c) => c.reviews > 0).length);
</script>

<div>
	<div class="overflow-x-auto pb-1">
		<div class="flex gap-[3px]" role="img" aria-label="Review activity for the last 365 days">
			{#each weeks as week, wi (wi)}
				<div class="flex flex-col gap-[3px]">
					{#each week as cell, di (di)}
						{#if cell}
							<div
								class="h-[10px] w-[10px] rounded-[2px]"
								style="background: {LEVEL_COLORS[cell.level]}"
								title="{cell.day}: {cell.reviews} review{cell.reviews === 1 ? '' : 's'}"
							></div>
						{:else}
							<div class="h-[10px] w-[10px]"></div>
						{/if}
					{/each}
				</div>
			{/each}
		</div>
	</div>
	<div class="ff-muted mt-2 flex items-center gap-2 text-[0.72rem]">
		<span>{totalReviews} reviews on {activeDays} days</span>
		<span class="flex-1"></span>
		<span>Less</span>
		{#each LEVEL_COLORS as color, i (i)}
			<span class="h-[10px] w-[10px] rounded-[2px]" style="background: {color}"></span>
		{/each}
		<span>More</span>
	</div>
</div>
