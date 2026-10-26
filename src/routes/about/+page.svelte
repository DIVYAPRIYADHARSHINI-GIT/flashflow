<script lang="ts">
	// About: the honest description of the scheduler and its limits.
	import { app } from '#lib/store/app-state.svelte';
	import Logo from '#lib/components/Logo.svelte';

	const s = $derived(app.data.settings);
</script>

<div class="flex max-w-3xl flex-col gap-4">
	<div class="flex items-center gap-3">
		<Logo size={38} />
		<div>
			<h1 class="ff-h1">FlashFlow</h1>
			<p class="ff-muted text-[0.88rem]">Study less. Remember more.</p>
		</div>
	</div>

	<section class="ff-card p-4">
		<h2 class="ff-h2">The scheduler</h2>
		<p class="mt-2 text-[0.92rem] leading-relaxed">
			<strong
				>A simple spaced repetition scheduler in the SM-2 style. It is a study aid, not a guarantee
				of memory.</strong
			>
		</p>
		<p class="ff-muted mt-3 text-[0.88rem] leading-relaxed">
			FlashFlow shows each card shortly before you are likely to forget it. It is not a
			reimplementation of any particular commercial algorithm, and it does not model your memory
			with machine learning. It applies a handful of documented rules:
		</p>

		<h3 class="ff-h2 mt-4 text-[0.95rem]">New cards</h3>
		<ul class="ff-muted mt-1 flex flex-col gap-1 text-[0.86rem] leading-relaxed">
			<li>
				A new card walks the learning steps (currently {s.learningSteps.join(' and ')} minutes).
			</li>
			<li><strong>Again</strong> returns it to the first step.</li>
			<li>
				<strong>Hard</strong> repeats the current step; on the first step it uses the average of the
				first two steps so it differs from Again.
			</li>
			<li>
				<strong>Good</strong> moves to the next step, and graduates the card to a
				{s.graduatingInterval}-day interval once the steps are finished.
			</li>
			<li>
				<strong>Easy</strong> skips the remaining steps and graduates straight to {s.easyInterval}
				days.
			</li>
		</ul>

		<h3 class="ff-h2 mt-4 text-[0.95rem]">Review cards</h3>
		<ul class="ff-muted mt-1 flex flex-col gap-1 text-[0.86rem] leading-relaxed">
			<li>
				Each card carries an <strong>ease factor</strong> (starting at {s.startingEase}, never below
				1.3).
			</li>
			<li><strong>Hard</strong> multiplies the interval by {s.hardFactor} and lowers ease by 0.15.</li>
			<li><strong>Good</strong> multiplies the interval by the ease.</li>
			<li>
				<strong>Easy</strong> multiplies by the ease and the easy bonus ({s.easyBonus}), and raises
				ease by 0.15.
			</li>
			<li>
				<strong>Again</strong> counts a lapse, lowers ease by 0.20, and sends the card to the
				relearning steps ({s.relearningSteps.join(' and ')} minutes) with a reduced interval.
			</li>
			<li>Every interval is scaled by the interval modifier ({s.intervalModifier}) and capped at {s.maxInterval} days.</li>
			<li>
				Long intervals get a small <strong>seeded fuzz</strong> so a batch of cards does not all come
				back on the same day. The fuzz is derived from the card's id, so it is stable and repeatable.
			</li>
		</ul>

		<h3 class="ff-h2 mt-4 text-[0.95rem]">Other rules</h3>
		<ul class="ff-muted mt-1 flex flex-col gap-1 text-[0.86rem] leading-relaxed">
			<li>
				A card with {s.leechThreshold} or more lapses is tagged <strong>leech</strong>, and
				FlashFlow suggests suspending or rewriting it.
			</li>
			<li>
				Your study day starts at <strong>{s.dayStartHour}:00 local time</strong>, so studying after
				midnight still counts for the previous day. Dates are computed from your local calendar, so
				daylight saving changes and time-zone travel do not shift a day.
			</li>
			<li>
				With <strong>bury siblings</strong> on, only one card per note is shown each day.
			</li>
			<li>
				Custom study - cram, review ahead, leeches and starred - deliberately does
				<strong>not</strong> change the schedule, and the study screen says so while you use it.
			</li>
		</ul>

		<h3 class="ff-h2 mt-4 text-[0.95rem]">What it cannot do</h3>
		<ul class="ff-muted mt-1 flex flex-col gap-1 text-[0.86rem] leading-relaxed">
			<li>It cannot know whether a card is well written. A confusing card becomes a leech.</li>
			<li>
				It does not measure your actual recall probability; the intervals come from fixed
				multipliers, not from a fitted model.
			</li>
			<li>
				Retention percentages are simply the share of answers that were not "Again" - a useful
				signal, not a prediction.
			</li>
		</ul>
	</section>

	<section class="ff-card p-4">
		<h2 class="ff-h2">Your data</h2>
		<p class="ff-muted mt-2 text-[0.88rem] leading-relaxed">
			FlashFlow has no accounts and no database. Everything is stored in this browser's
			localStorage and never uploaded. The single server route generates PDFs from the rows you
			choose and stores nothing. See
			<a class="underline" href="/privacy">Privacy and backup</a> for the storage meter and JSON
			backup.
		</p>
	</section>

	<section class="ff-card p-4">
		<h2 class="ff-h2">Keyboard</h2>
		<ul class="ff-muted mt-2 grid gap-1 text-[0.86rem] sm:grid-cols-2">
			<li><kbd class="ff-code">Space</kbd> show answer / Good</li>
			<li><kbd class="ff-code">1</kbd> Again · <kbd class="ff-code">2</kbd> Hard</li>
			<li><kbd class="ff-code">3</kbd> Good · <kbd class="ff-code">4</kbd> Easy</li>
			<li><kbd class="ff-code">U</kbd> undo the last answer</li>
			<li><kbd class="ff-code">P</kbd> pause / resume</li>
			<li><kbd class="ff-code">Enter</kbd> check a typed answer</li>
		</ul>
	</section>
</div>
