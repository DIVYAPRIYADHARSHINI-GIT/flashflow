<script lang="ts">
	// Statistics. Every figure comes from stored day aggregates, the capped revlog or the
	// live card states - nothing is estimated. Empty states say so explicitly.
	import { app } from '#lib/store/app-state.svelte';
	import DeckPicker from '#lib/components/DeckPicker.svelte';
	import BarChart from '#lib/components/BarChart.svelte';
	import Donut from '#lib/components/Donut.svelte';
	import Heatmap from '#lib/components/Heatmap.svelte';
	import {
		cardsForDeck,
		dailySeries,
		forecast,
		heatmap,
		intervalDistribution,
		retention,
		stateBreakdown,
		todaySummary
	} from '#lib/logic/stats';
	import { addDays, formatDuration, parseDayKey } from '#lib/logic/day';

	let deckId = $state('');
	let range = $state<30 | 90 | 365>(30);

	const today = $derived(app.today);
	const cards = $derived(app.loaded ? cardsForDeck(app.data, deckId || null) : []);
	const cardIds = $derived(new Set(cards.map((c) => c.id)));

	// Day aggregates are global (they are the cheap summary). When a deck filter is active
	// the per-day numbers are recomputed from the revlog for that deck instead, and the
	// page says so, rather than showing all-deck numbers under a deck heading.
	const deckFiltered = $derived(deckId !== '');

	const days = $derived.by(() => {
		if (!deckFiltered) return app.data.days;
		const map = new Map<string, { day: string; reviews: number; newCards: number; timeMs: number; again: number; hard: number; good: number; easy: number; matureTotal: number; matureCorrect: number }>();
		for (const r of app.data.revlog) {
			if (!cardIds.has(r.cardId)) continue;
			const d = map.get(r.day) ?? {
				day: r.day,
				reviews: 0,
				newCards: 0,
				timeMs: 0,
				again: 0,
				hard: 0,
				good: 0,
				easy: 0,
				matureTotal: 0,
				matureCorrect: 0
			};
			d.reviews++;
			if (r.from === 'new') d.newCards++;
			d.timeMs += r.ms;
			if (r.rating === 1) d.again++;
			else if (r.rating === 2) d.hard++;
			else if (r.rating === 3) d.good++;
			else d.easy++;
			if ((r.from === 'review' || r.from === 'relearning') && r.prevInterval >= 21) {
				d.matureTotal++;
				if (r.rating > 1) d.matureCorrect++;
			}
			map.set(r.day, d);
		}
		return [...map.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
	});

	const summary = $derived(todaySummary(days, today));
	const series = $derived(dailySeries(days, today, range));
	const fore = $derived(forecast(cards, today, app.data.settings.dayStartHour, 30));
	const breakdown = $derived(stateBreakdown(cards));
	const intervals = $derived(intervalDistribution(cards));
	const heat = $derived(heatmap(days, today, 365));
	const ret = $derived(
		app.loaded
			? retention(
					deckFiltered
						? { ...app.data, days, revlog: app.data.revlog.filter((r) => cardIds.has(r.cardId)) }
						: app.data,
					addDays(today, -(range - 1)),
					today
				)
			: null
	);

	const reviewBars = $derived(
		series.map((d) => ({
			label: parseDayKey(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
			value: d.reviews,
			highlight: d.newCards
		}))
	);
	const timeBars = $derived(
		series.map((d) => ({
			label: parseDayKey(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
			value: Math.round(d.timeMs / 60000)
		}))
	);
	const forecastBars = $derived(
		fore.map((b) => ({
			label: parseDayKey(b.day).toLocaleDateString(undefined, { day: 'numeric' }),
			value: b.due,
			highlight: b.mature
		}))
	);
	const intervalBars = $derived(intervals.map((b) => ({ label: b.label, value: b.count })));

	const forecastTotal = $derived(fore.reduce((s, b) => s + b.due, 0));
	const rangeReviews = $derived(series.reduce((s, d) => s + d.reviews, 0));
	const rangeTime = $derived(series.reduce((s, d) => s + d.timeMs, 0));
	const labelEvery = $derived(range === 30 ? 5 : range === 90 ? 15 : 30);
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<h1 class="ff-h1">Statistics</h1>
		<div class="flex flex-wrap items-end gap-2">
			<div class="w-44">
				<label class="ff-label" for="stats-deck">Deck</label>
				<DeckPicker id="stats-deck" value={deckId} includeAll onchange={(v) => (deckId = v)} />
			</div>
			<div class="w-32">
				<label class="ff-label" for="stats-range">Date range</label>
				<select id="stats-range" class="ff-input" bind:value={range}>
					<option value={30}>Last 30 days</option>
					<option value={90}>Last 90 days</option>
					<option value={365}>Last 365 days</option>
				</select>
			</div>
		</div>
	</div>

	{#if !app.loaded}
		<div class="ff-card p-6"><div class="ff-skeleton h-32 w-full"></div></div>
	{:else}
		<!-- Today -->
		<section class="ff-card p-4">
			<h2 class="ff-h2">Today</h2>
			{#if summary.reviews === 0}
				<p class="ff-muted mt-2 text-[0.86rem]">
					Nothing studied today yet{deckFiltered ? ' in this deck' : ''}.
				</p>
			{:else}
				<dl class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
					<div class="rounded-lg p-2.5" style="background: var(--surface-sunken)">
						<dt class="ff-muted text-[0.7rem] font-semibold uppercase">Cards studied</dt>
						<dd class="mt-0.5 text-lg font-bold">{summary.reviews}</dd>
					</div>
					<div class="rounded-lg p-2.5" style="background: var(--surface-sunken)">
						<dt class="ff-muted text-[0.7rem] font-semibold uppercase">Time</dt>
						<dd class="mt-0.5 text-lg font-bold">{formatDuration(summary.timeMs)}</dd>
					</div>
					<div class="rounded-lg p-2.5" style="background: var(--surface-sunken)">
						<dt class="ff-muted text-[0.7rem] font-semibold uppercase">Correct</dt>
						<dd class="mt-0.5 text-lg font-bold">{summary.correctPercent}%</dd>
					</div>
					<div class="rounded-lg p-2.5" style="background: var(--surface-sunken)">
						<dt class="ff-muted text-[0.7rem] font-semibold uppercase">New cards</dt>
						<dd class="mt-0.5 text-lg font-bold">{summary.newCards}</dd>
					</div>
				</dl>
				<div class="mt-3 flex flex-wrap gap-2 text-[0.78rem] font-semibold">
					<span class="rounded px-2 py-1" style="background: #ffe3e3; color: #b02525"
						>Again {summary.again}</span
					>
					<span class="rounded px-2 py-1" style="background: #fff4e6; color: #a35a00"
						>Hard {summary.hard}</span
					>
					<span class="rounded px-2 py-1" style="background: #e9f8ee; color: #1f7a32"
						>Good {summary.good}</span
					>
					<span class="rounded px-2 py-1" style="background: var(--chip); color: var(--color-easy)"
						>Easy {summary.easy}</span
					>
				</div>
			{/if}
		</section>

		<!-- Forecast -->
		<section class="ff-card p-4">
			<div class="flex items-baseline justify-between gap-2">
				<h2 class="ff-h2">Forecast — next 30 days</h2>
				<span class="ff-muted text-[0.76rem]">{forecastTotal} cards scheduled</span>
			</div>
			<p class="ff-muted mt-1 text-[0.76rem]">
				Light blue is the mature portion (interval of 21 days or more). Overdue cards are counted
				on today.
			</p>
			<div class="mt-3">
				<BarChart bars={forecastBars} labelEvery={3} title="Cards due per day for the next 30 days" />
			</div>
		</section>

		<!-- Reviews and time -->
		<div class="grid gap-4 lg:grid-cols-2">
			<section class="ff-card p-4">
				<div class="flex items-baseline justify-between gap-2">
					<h2 class="ff-h2">Reviews per day</h2>
					<span class="ff-muted text-[0.76rem]">{rangeReviews} in range</span>
				</div>
				<p class="ff-muted mt-1 text-[0.76rem]">Light blue is the new-card portion.</p>
				<div class="mt-3">
					<BarChart bars={reviewBars} {labelEvery} title="Reviews per day" />
				</div>
			</section>

			<section class="ff-card p-4">
				<div class="flex items-baseline justify-between gap-2">
					<h2 class="ff-h2">Time studied per day</h2>
					<span class="ff-muted text-[0.76rem]">{formatDuration(rangeTime)} in range</span>
				</div>
				<p class="ff-muted mt-1 text-[0.76rem]">Minutes per day, idle time excluded.</p>
				<div class="mt-3">
					<BarChart
						bars={timeBars}
						{labelEvery}
						color="var(--color-good)"
						valueSuffix=" min"
						title="Minutes studied per day"
					/>
				</div>
			</section>
		</div>

		<!-- Retention + states -->
		<div class="grid gap-4 lg:grid-cols-2">
			<section class="ff-card p-4">
				<h2 class="ff-h2">Retention</h2>
				<p class="ff-muted mt-1 text-[0.78rem]">
					Share of answers that were not "Again", over the selected range.
				</p>
				{#if ret && ret.matureTotal === 0 && ret.youngTotal === 0}
					<p class="ff-muted mt-4 text-[0.86rem]">
						No review answers in this range yet. Retention appears once cards have been reviewed.
					</p>
				{:else if ret}
					<div class="mt-3 grid grid-cols-2 gap-3">
						<div class="rounded-lg p-3" style="background: var(--surface-sunken)">
							<p class="ff-muted text-[0.7rem] font-semibold uppercase">Mature (21d+)</p>
							<p class="mt-1 text-2xl font-bold">
								{ret.percent === null ? '—' : `${ret.percent}%`}
							</p>
							<p class="ff-muted text-[0.72rem]">
								{ret.matureCorrect} of {ret.matureTotal} answers
							</p>
						</div>
						<div class="rounded-lg p-3" style="background: var(--surface-sunken)">
							<p class="ff-muted text-[0.7rem] font-semibold uppercase">Young (under 21d)</p>
							<p class="mt-1 text-2xl font-bold">
								{ret.youngPercent === null ? '—' : `${ret.youngPercent}%`}
							</p>
							<p class="ff-muted text-[0.72rem]">
								{ret.youngCorrect} of {ret.youngTotal} answers
							</p>
						</div>
					</div>
					{#if ret.matureTotal === 0}
						<p class="ff-muted mt-2 text-[0.74rem]">
							No mature answers yet, so mature retention is shown as a dash rather than a guess.
						</p>
					{/if}
				{/if}
			</section>

			<section class="ff-card p-4">
				<h2 class="ff-h2 mb-3">Card states</h2>
				<Donut
					title="Card states"
					slices={[
						{ label: 'New', value: breakdown.new, color: '#9DBBFB' },
						{ label: 'Learning', value: breakdown.learning, color: 'var(--color-hard)' },
						{ label: 'Relearning', value: breakdown.relearning, color: '#F76707' },
						{ label: 'Young', value: breakdown.young, color: 'var(--color-primary)' },
						{ label: 'Mature', value: breakdown.mature, color: 'var(--color-good)' },
						{ label: 'Suspended', value: breakdown.suspended, color: '#adb5bd' }
					]}
				/>
			</section>
		</div>

		<!-- Interval distribution -->
		<section class="ff-card p-4">
			<h2 class="ff-h2">Interval distribution</h2>
			<p class="ff-muted mt-1 text-[0.76rem]">Review cards grouped by current interval.</p>
			<div class="mt-3">
				<BarChart bars={intervalBars} color="var(--color-easy)" title="Interval distribution" />
			</div>
		</section>

		<!-- Heatmap -->
		<section class="ff-card p-4">
			<h2 class="ff-h2">Last 365 days</h2>
			<p class="ff-muted mt-1 mb-3 text-[0.76rem]">
				Each square is one study day{deckFiltered ? ' in this deck' : ''}.
			</p>
			<Heatmap cells={heat} />
		</section>

		{#if deckFiltered}
			<p class="ff-muted text-[0.76rem]">
				Per-deck daily figures are recomputed from the stored review log, which keeps the most
				recent {app.data.revlog.length} answers. All-decks figures use the permanent daily
				summaries, so they can cover a longer period.
			</p>
		{/if}
	{/if}
</div>
