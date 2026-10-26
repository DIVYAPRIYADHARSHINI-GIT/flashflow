// Versioned schema migrations.
//
// The data schema is versioned so a future release (or a future database-backed
// StudyStore) can upgrade old payloads instead of asking the user to start over.
// Each step upgrades by exactly one version. Add new steps to the end.

import { DATA_VERSION, DEFAULT_SETTINGS, type AppData } from '#lib/types';

type Step = (data: AppData) => AppData;

/** version N -> N+1. Index 0 upgrades version 1 to version 2, and so on. */
const STEPS: Step[] = [
	// No migrations yet - v1 is the first public schema. Example of what a step looks like:
	// (data) => ({ ...data, version: 2, cards: data.cards.map((c) => ({ ...c, newField: 0 })) })
];

/** Fill in anything a hand-edited or older payload may be missing, then run the steps. */
export function migrate(input: AppData): AppData {
	let data: AppData = {
		version: typeof input.version === 'number' ? input.version : 1,
		decks: input.decks ?? [],
		notes: input.notes ?? [],
		cards: input.cards ?? [],
		revlog: input.revlog ?? [],
		days: input.days ?? [],
		settings: { ...DEFAULT_SETTINGS, ...(input.settings ?? {}) },
		meta: {
			...{ lastBackupAt: null, sampleDataLoaded: false, nextPosition: 0 },
			...(input.meta ?? {})
		}
	};

	while (data.version < DATA_VERSION) {
		const step = STEPS[data.version - 1];
		if (!step) {
			// No step defined - stamp the version so we do not loop forever.
			data = { ...data, version: data.version + 1 };
			continue;
		}
		data = step(data);
	}

	// Defensive repairs that are cheap and prevent a corrupt payload from breaking the UI.
	data.notes = data.notes.map((n) => ({ ...n, tags: Array.isArray(n.tags) ? n.tags : [] }));
	data.cards = data.cards.map((c) => ({
		...c,
		ease: typeof c.ease === 'number' && c.ease > 0 ? c.ease : data.settings.startingEase,
		interval: typeof c.interval === 'number' ? c.interval : 0,
		lapses: typeof c.lapses === 'number' ? c.lapses : 0,
		reps: typeof c.reps === 'number' ? c.reps : 0,
		step: typeof c.step === 'number' ? c.step : 0
	}));

	return data;
}
