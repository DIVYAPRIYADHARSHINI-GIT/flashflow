// Study days, day rollover and time zones.
//
// Rules from the brief:
// - A configurable "new day starts at" hour (default 4 AM) means studying at 01:30 still
//   counts for the previous calendar date.
// - Use LOCAL time correctly, never shift a date by a day, and survive daylight saving
//   changes and the user travelling between time zones.
//
// How that is done: a study day is a plain YYYY-MM-DD string derived from the LOCAL
// calendar date after subtracting the rollover hour. Local date fields are read with
// getFullYear/getMonth/getDate (never from a UTC ISO string, which is the classic
// off-by-one-day bug). Day boundaries are computed by building a local Date with
// `new Date(y, m, d, hour)`, which the platform resolves correctly across DST: on a
// spring-forward day the 4 AM boundary still exists, and on a fall-back day the duplicated
// hour resolves to the first occurrence. The *length* of a day in ms can therefore be 23 or
// 25 hours - we never assume 86_400_000.

/** An injectable clock so every module can be unit tested deterministically. */
export interface Clock {
	now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export function fixedClock(at: number | Date): Clock & { set(at: number | Date): void } {
	let t = typeof at === 'number' ? at : at.getTime();
	return {
		now: () => t,
		set(next: number | Date) {
			t = typeof next === 'number' ? next : next.getTime();
		}
	};
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

/** Format a Date as a local YYYY-MM-DD string (never via toISOString). */
export function localDateKey(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse YYYY-MM-DD into a local Date at midnight. */
export function parseDayKey(key: string): Date {
	const [y, m, d] = key.split('-').map((p) => parseInt(p, 10));
	return new Date(y, m - 1, d);
}

/**
 * The study day a timestamp belongs to, honouring the rollover hour.
 * 2024-03-10T01:30 local with dayStartHour 4 -> "2024-03-09".
 */
export function studyDay(at: number | Date, dayStartHour: number): string {
	const d = typeof at === 'number' ? new Date(at) : new Date(at.getTime());
	// Shift by whole hours in LOCAL terms: step back a calendar day when before rollover.
	if (d.getHours() < dayStartHour) {
		const prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12);
		return localDateKey(prev);
	}
	return localDateKey(d);
}

/** Epoch ms when the given study day begins in local time. */
export function dayStart(day: string, dayStartHour: number): number {
	const d = parseDayKey(day);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate(), dayStartHour, 0, 0, 0).getTime();
}

/** Epoch ms when the given study day ends (= start of the next study day). */
export function dayEnd(day: string, dayStartHour: number): number {
	return dayStart(addDays(day, 1), dayStartHour);
}

/** Add days to a YYYY-MM-DD key using local calendar arithmetic (DST safe). */
export function addDays(day: string, n: number): string {
	const d = parseDayKey(day);
	// Noon anchor so a 23-hour DST day cannot roll the date backwards.
	const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
	return localDateKey(next);
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
	const a = parseDayKey(from);
	const b = parseDayKey(to);
	const ms =
		new Date(b.getFullYear(), b.getMonth(), b.getDate(), 12).getTime() -
		new Date(a.getFullYear(), a.getMonth(), a.getDate(), 12).getTime();
	return Math.round(ms / 86_400_000);
}

/** Inclusive list of day keys from `from` to `to`. */
export function dayRange(from: string, to: string): string[] {
	const out: string[] = [];
	const n = daysBetween(from, to);
	for (let i = 0; i <= n; i++) out.push(addDays(from, i));
	return out;
}

/** The last `count` study days ending at `endDay`, oldest first. */
export function lastDays(endDay: string, count: number): string[] {
	return dayRange(addDays(endDay, -(count - 1)), endDay);
}

export function todayKey(clock: Clock, dayStartHour: number): string {
	return studyDay(clock.now(), dayStartHour);
}

/**
 * Due-day for an interval measured in days from now. Used for the forecast: a card due at
 * an epoch timestamp belongs to the study day that timestamp falls in.
 */
export function dueDay(dueAt: number, dayStartHour: number): string {
	return studyDay(dueAt, dayStartHour);
}

/** Human label for a duration in minutes, e.g. "1m", "10m", "1d", "2.5mo". */
export function formatInterval(days: number): string {
	if (days <= 0) return '1m';
	const minutes = Math.round(days * 1440);
	if (minutes < 60) return `${Math.max(1, minutes)}m`;
	if (minutes < 1440) {
		const h = minutes / 60;
		return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
	}
	if (days < 30) {
		return `${days % 1 === 0 ? days : days.toFixed(1)}d`;
	}
	if (days < 365) {
		const mo = days / 30;
		return `${mo < 10 ? mo.toFixed(1) : Math.round(mo)}mo`;
	}
	const y = days / 365;
	return `${y < 10 ? y.toFixed(1) : Math.round(y)}y`;
}

export function formatDuration(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rs = s % 60;
	if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
}
