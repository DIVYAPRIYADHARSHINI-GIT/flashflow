// Session timer that ignores idle time.
//
// Rule from the brief: count at most 60 seconds per card, and support Pause / Resume.
// The timer is a plain class (no reactivity) so it can be unit tested with a fixed clock.

export const MAX_MS_PER_CARD = 60_000;

export class SessionTimer {
	private total = 0;
	private cardStart: number | null = null;
	private paused = false;

	/** Call when a new card is shown. */
	startCard(now: number) {
		this.cardStart = now;
	}

	/** Elapsed ms on the current card, capped. */
	cardElapsed(now: number): number {
		if (this.cardStart === null || this.paused) return 0;
		return Math.min(MAX_MS_PER_CARD, Math.max(0, now - this.cardStart));
	}

	/** Call when the card is answered; returns the capped time for that card. */
	finishCard(now: number): number {
		const ms = this.cardElapsed(now);
		this.total += ms;
		this.cardStart = null;
		return ms;
	}

	pause(now: number) {
		if (this.paused) return;
		// Bank whatever the current card has accrued, then stop counting.
		this.total += this.cardElapsed(now);
		this.cardStart = null;
		this.paused = true;
	}

	resume(now: number) {
		if (!this.paused) return;
		this.paused = false;
		this.cardStart = now;
	}

	get isPaused(): boolean {
		return this.paused;
	}

	/** Total counted ms for the session, including the in-progress card. */
	elapsed(now: number): number {
		return this.total + this.cardElapsed(now);
	}

	reset() {
		this.total = 0;
		this.cardStart = null;
		this.paused = false;
	}
}
