// StudyStore: the ONLY data access surface in FlashFlow.
//
// Storage rule (from the project brief): all user data lives in this browser's
// localStorage and is never uploaded anywhere. No database, no KV, no Blob, no accounts,
// no API keys. A server-backed store could be added later by writing a second
// implementation of this interface - nothing else in the app touches storage directly.

import { DATA_VERSION, DEFAULT_SETTINGS, REVLOG_CAP, type AppData } from '#lib/types';
import { migrate } from './migrations';

export const STORAGE_KEY = 'flashflow:data:v1';

/** localStorage is ~5 MB per origin in every mainstream browser. */
export const STORAGE_BUDGET_BYTES = 5_000_000;
export const SIZE_WARN_BYTES = 3_500_000;
export const SIZE_LIMIT_BYTES = 4_500_000;

export type StoreStatus = 'ok' | 'unavailable' | 'full' | 'error';

export interface SaveOutcome {
	ok: boolean;
	status: StoreStatus;
	message?: string;
	bytes?: number;
}

export interface StudyStore {
	/** True when the backing store can actually be used in this browser. */
	isAvailable(): boolean;
	load(): AppData | null;
	save(data: AppData): SaveOutcome;
	clear(): void;
	/** Approximate serialised size in bytes. */
	sizeOf(data: AppData): number;
	/** Bytes currently used by this app's key. */
	usedBytes(): number;
}

export function emptyData(): AppData {
	return {
		version: DATA_VERSION,
		decks: [],
		notes: [],
		cards: [],
		revlog: [],
		days: [],
		settings: { ...DEFAULT_SETTINGS },
		meta: { lastBackupAt: null, sampleDataLoaded: false, nextPosition: 0 }
	};
}

/**
 * Keep the payload small: the detailed review log is capped to the newest REVLOG_CAP
 * entries. Day aggregates are kept forever because they are tiny (one short object per
 * day) and every chart is built from them.
 */
export function trimForStorage(data: AppData): AppData {
	if (data.revlog.length <= REVLOG_CAP) return data;
	return { ...data, revlog: data.revlog.slice(-REVLOG_CAP) };
}

/** The one implementation. Every access is wrapped in try/catch. */
export class LocalStudyStore implements StudyStore {
	private available: boolean | null = null;

	isAvailable(): boolean {
		if (this.available !== null) return this.available;
		try {
			if (typeof localStorage === 'undefined') {
				this.available = false;
				return false;
			}
			const probe = '__ff_probe__';
			localStorage.setItem(probe, '1');
			localStorage.removeItem(probe);
			this.available = true;
		} catch {
			// Private-mode Safari, disabled by policy, or quota already exhausted.
			this.available = false;
		}
		return this.available;
	}

	load(): AppData | null {
		if (!this.isAvailable()) return null;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as AppData;
			return migrate(parsed);
		} catch {
			// Corrupt JSON: do not wipe it - the user can still export the raw key by hand.
			return null;
		}
	}

	save(data: AppData): SaveOutcome {
		if (!this.isAvailable()) {
			return {
				ok: false,
				status: 'unavailable',
				message: 'This browser is blocking local storage, so changes cannot be saved.'
			};
		}
		const trimmed = trimForStorage(data);
		let serialised: string;
		try {
			serialised = JSON.stringify(trimmed);
		} catch {
			return { ok: false, status: 'error', message: 'The data could not be serialised.' };
		}
		const bytes = serialised.length * 2; // UTF-16 code units
		if (bytes > SIZE_LIMIT_BYTES) {
			return {
				ok: false,
				status: 'full',
				bytes,
				message:
					'Storage is nearly full. Export a backup, then delete some images or old decks before adding more.'
			};
		}
		try {
			localStorage.setItem(STORAGE_KEY, serialised);
			return { ok: true, status: 'ok', bytes };
		} catch {
			return {
				ok: false,
				status: 'full',
				bytes,
				message:
					'The browser refused to save (storage is full). Export a backup now so nothing is lost.'
			};
		}
	}

	clear(): void {
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch {
			// Nothing to do - the data was never stored.
		}
	}

	sizeOf(data: AppData): number {
		try {
			return JSON.stringify(trimForStorage(data)).length * 2;
		} catch {
			return 0;
		}
	}

	usedBytes(): number {
		if (!this.isAvailable()) return 0;
		try {
			return (localStorage.getItem(STORAGE_KEY)?.length ?? 0) * 2;
		} catch {
			return 0;
		}
	}
}

/** In-memory store used by unit tests and by SSR, where there is no localStorage. */
export class MemoryStudyStore implements StudyStore {
	private payload: string | null = null;
	isAvailable() {
		return true;
	}
	load(): AppData | null {
		return this.payload ? migrate(JSON.parse(this.payload) as AppData) : null;
	}
	save(data: AppData): SaveOutcome {
		this.payload = JSON.stringify(trimForStorage(data));
		return { ok: true, status: 'ok', bytes: this.payload.length * 2 };
	}
	clear() {
		this.payload = null;
	}
	sizeOf(data: AppData) {
		return JSON.stringify(trimForStorage(data)).length * 2;
	}
	usedBytes() {
		return (this.payload?.length ?? 0) * 2;
	}
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
