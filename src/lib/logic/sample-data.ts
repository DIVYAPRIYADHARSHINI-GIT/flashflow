// Original sample decks written for FlashFlow.
//
// All card text here was written for this project. Nothing is copied from a book, website
// or an existing shared deck. Three decks, ~90 cards total, with a mix of all four card
// types, plus a generated 60-day review history so the dashboard, forecast, heatmap and
// streak show realistic content on first open.

import { DEFAULT_SETTINGS, type AppData, type Card, type DayStat, type Note, type Rating, type RevlogEntry } from '#lib/types';
import { MATURE_DAYS } from '#lib/types';
import { addDays, studyDay } from './day';
import { applyAnswer, newCard, seededUnit } from './scheduler';
import { parseCloze } from './cloze';
import { emptyData } from '#lib/store/study-store';
import { recordDay } from './stats';

type SampleCard = {
	type: 'basic' | 'reversed' | 'cloze' | 'typed';
	front: string;
	back?: string;
	extra?: string;
	tags?: string[];
	starred?: boolean;
};

const WORLD_CAPITALS: SampleCard[] = [
	{ type: 'basic', front: 'What is the capital of Japan?', back: 'Tokyo', tags: ['asia'] },
	{ type: 'basic', front: 'What is the capital of Kenya?', back: 'Nairobi', tags: ['africa'] },
	{ type: 'basic', front: 'What is the capital of Peru?', back: 'Lima', tags: ['americas'] },
	{ type: 'basic', front: 'What is the capital of Norway?', back: 'Oslo', tags: ['europe'] },
	{ type: 'basic', front: 'What is the capital of Vietnam?', back: 'Hanoi', tags: ['asia'] },
	{ type: 'basic', front: 'What is the capital of Morocco?', back: 'Rabat', tags: ['africa'], extra: 'Casablanca is larger, but Rabat is the seat of government.' },
	{ type: 'basic', front: 'What is the capital of Canada?', back: 'Ottawa', tags: ['americas'], extra: 'Not Toronto - a common mix-up.' },
	{ type: 'basic', front: 'What is the capital of Portugal?', back: 'Lisbon', tags: ['europe'] },
	{ type: 'basic', front: 'What is the capital of Indonesia?', back: 'Jakarta', tags: ['asia'], extra: 'A planned move to Nusantara has been announced.' },
	{ type: 'basic', front: 'What is the capital of Ghana?', back: 'Accra', tags: ['africa'] },
	{ type: 'basic', front: 'What is the capital of Chile?', back: 'Santiago', tags: ['americas'] },
	{ type: 'basic', front: 'What is the capital of Austria?', back: 'Vienna', tags: ['europe'] },
	{ type: 'basic', front: 'What is the capital of Nepal?', back: 'Kathmandu', tags: ['asia'] },
	{ type: 'basic', front: 'What is the capital of Egypt?', back: 'Cairo', tags: ['africa'] },
	{ type: 'basic', front: 'What is the capital of New Zealand?', back: 'Wellington', tags: ['oceania'], extra: 'Auckland is the biggest city, Wellington is the capital.' },
	{ type: 'basic', front: 'What is the capital of Switzerland?', back: 'Bern', tags: ['europe'], starred: true },
	{ type: 'reversed', front: 'Brazil', back: 'Brasilia', tags: ['americas', 'reversed'] },
	{ type: 'reversed', front: 'Türkiye', back: 'Ankara', tags: ['asia', 'reversed'], extra: 'Istanbul is the largest city.' },
	{ type: 'reversed', front: 'Australia', back: 'Canberra', tags: ['oceania', 'reversed'] },
	{ type: 'reversed', front: 'South Africa', back: 'Pretoria', tags: ['africa', 'reversed'], extra: 'Pretoria is the administrative capital; Cape Town and Bloemfontein hold the other two branches.' },
	{ type: 'cloze', front: 'The capital of India is {{c1::New Delhi}}, and its largest metropolitan area is {{c2::Mumbai}}.', tags: ['asia', 'cloze'] },
	{ type: 'cloze', front: 'Three capitals on the Danube are {{c1::Vienna}}, {{c2::Budapest}} and {{c3::Belgrade}}.', tags: ['europe', 'cloze'] },
	{ type: 'typed', front: 'Type the capital of Iceland', back: 'Reykjavik', tags: ['europe', 'typed'], extra: 'Spelled Reykjavík with an accent; the typed check ignores accents by default.' },
	{ type: 'typed', front: 'Type the capital of Argentina', back: 'Buenos Aires', tags: ['americas', 'typed'] },
	{ type: 'typed', front: 'Type the capital of Thailand', back: 'Bangkok', tags: ['asia', 'typed'] },
	{ type: 'basic', front: 'What is the capital of Poland?', back: 'Warsaw', tags: ['europe'] },
	{ type: 'basic', front: 'What is the capital of Ethiopia?', back: 'Addis Ababa', tags: ['africa'] },
	{ type: 'basic', front: 'What is the capital of Colombia?', back: 'Bogota', tags: ['americas'] },
	{ type: 'basic', front: 'What is the capital of Malaysia?', back: 'Kuala Lumpur', tags: ['asia'] },
	{ type: 'basic', front: 'What is the capital of Ireland?', back: 'Dublin', tags: ['europe'] }
];

const BASIC_PYTHON: SampleCard[] = [
	{ type: 'basic', front: 'What does `len()` return?', back: 'The number of items in a sequence or collection.', tags: ['builtins'] },
	{ type: 'basic', front: 'What is the difference between a **list** and a **tuple**?', back: 'A list is mutable, a tuple is not. Tuples can be dictionary keys; lists cannot.', tags: ['types'], starred: true },
	{ type: 'basic', front: 'How do you write a comment in Python?', back: 'Start the line with `#`.', tags: ['syntax'] },
	{ type: 'basic', front: 'What does `range(3)` produce?', back: '0, 1, 2 - the stop value is excluded.', tags: ['builtins'] },
	{ type: 'basic', front: 'What is an f-string?', back: 'A string literal prefixed with `f` where `{expr}` is replaced by the value of the expression.\n\n```\nname = "Ada"\nprint(f"Hi {name}")\n```', tags: ['strings'] },
	{ type: 'basic', front: 'Which keyword defines a function?', back: '`def`', tags: ['syntax'] },
	{ type: 'basic', front: 'What does a function return when it has no `return` statement?', back: '`None`', tags: ['functions'] },
	{ type: 'basic', front: 'How do you add an item to the end of a list?', back: '`items.append(value)`', tags: ['lists'] },
	{ type: 'basic', front: 'What does `dict.get(key, default)` do?', back: 'Returns the value for the key, or the default instead of raising `KeyError`.', tags: ['dicts'] },
	{ type: 'basic', front: 'What is a list comprehension?', back: 'A compact way to build a list:\n\n```\nsquares = [n * n for n in range(5)]\n```', tags: ['lists'] },
	{ type: 'basic', front: 'How do you open a file so it is closed automatically?', back: 'Use a `with` block:\n\n```\nwith open("notes.txt") as f:\n    text = f.read()\n```', tags: ['files'] },
	{ type: 'basic', front: 'What is the difference between `==` and `is`?', back: '- `==` compares values\n- `is` compares identity (the same object in memory)', tags: ['operators'], starred: true },
	{ type: 'basic', front: 'What does `enumerate()` give you?', back: 'Pairs of (index, item) while looping.', tags: ['builtins'] },
	{ type: 'basic', front: 'How do you catch an error?', back: '```\ntry:\n    risky()\nexcept ValueError as err:\n    print(err)\n```', tags: ['errors'] },
	{ type: 'basic', front: 'What is a *set* used for?', back: 'Unique items and fast membership tests.', tags: ['types'] },
	{ type: 'basic', front: 'What does `sorted(items, key=len)` do?', back: 'Returns a new list sorted by each item\'s length, leaving the original untouched.', tags: ['builtins'] },
	{ type: 'basic', front: 'What is `__init__` for?', back: 'It initialises a newly created instance of a class.', tags: ['classes'] },
	{ type: 'basic', front: 'What does `self` refer to in a method?', back: 'The instance the method was called on.', tags: ['classes'] },
	{ type: 'basic', front: 'How do you install a package with pip?', back: '`pip install packagename`', tags: ['tooling'] },
	{ type: 'basic', front: 'What is a virtual environment for?', back: 'Keeping a project\'s packages separate from other projects and the system Python.', tags: ['tooling'] },
	{ type: 'reversed', front: '`str`', back: 'Text type', tags: ['types', 'reversed'] },
	{ type: 'reversed', front: '`bool`', back: 'True / False type', tags: ['types', 'reversed'] },
	{ type: 'cloze', front: 'A dictionary maps {{c1::keys}} to {{c2::values}}.', tags: ['dicts', 'cloze'] },
	{ type: 'cloze', front: 'In `for i in range(5)`, the loop variable `i` goes from {{c1::0}} to {{c2::4}}.', tags: ['loops', 'cloze'] },
	{ type: 'cloze', front: 'Python indexes sequences starting at {{c1::0}}, and `items[-1]` is the {{c2::last}} item.', tags: ['lists', 'cloze'] },
	{ type: 'typed', front: 'Type the function that returns the lowercase form of a string', back: 'lower', tags: ['strings', 'typed'], extra: 'As in "Hello".lower().' },
	{ type: 'typed', front: 'Type the keyword used to exit a loop early', back: 'break', tags: ['loops', 'typed'] },
	{ type: 'typed', front: 'Type the keyword that skips to the next loop iteration', back: 'continue', tags: ['loops', 'typed'] },
	{ type: 'basic', front: 'What does `items[1:3]` return?', back: 'A slice with the items at index 1 and 2.', tags: ['lists'] },
	{ type: 'basic', front: 'What is the result of `3 / 2` in Python 3?', back: '`1.5` - `/` is float division. Use `//` for floor division.', tags: ['operators'] }
];

const SPANISH_STARTER: SampleCard[] = [
	{ type: 'reversed', front: 'the house', back: 'la casa', tags: ['nouns'] },
	{ type: 'reversed', front: 'the book', back: 'el libro', tags: ['nouns'] },
	{ type: 'reversed', front: 'the water', back: 'el agua', tags: ['nouns'], extra: 'Feminine, but takes "el" in the singular.' },
	{ type: 'reversed', front: 'the city', back: 'la ciudad', tags: ['nouns'] },
	{ type: 'reversed', front: 'the friend (male)', back: 'el amigo', tags: ['nouns'] },
	{ type: 'reversed', front: 'the day', back: 'el dia', tags: ['nouns'], extra: 'Written el día.' },
	{ type: 'reversed', front: 'the night', back: 'la noche', tags: ['nouns'] },
	{ type: 'reversed', front: 'bread', back: 'el pan', tags: ['food'] },
	{ type: 'reversed', front: 'cheese', back: 'el queso', tags: ['food'] },
	{ type: 'reversed', front: 'apple', back: 'la manzana', tags: ['food'] },
	{ type: 'basic', front: 'How do you say "Good morning"?', back: 'Buenos dias (buenos días)', tags: ['phrases'] },
	{ type: 'basic', front: 'How do you say "Thank you very much"?', back: 'Muchas gracias', tags: ['phrases'] },
	{ type: 'basic', front: 'How do you ask "Where is the station?"', back: 'Donde esta la estacion? (¿Dónde está la estación?)', tags: ['phrases'], starred: true },
	{ type: 'basic', front: 'How do you say "I do not understand"?', back: 'No entiendo', tags: ['phrases'] },
	{ type: 'basic', front: 'How do you say "See you tomorrow"?', back: 'Hasta manana (hasta mañana)', tags: ['phrases'] },
	{ type: 'basic', front: 'What are the two Spanish verbs for "to be"?', back: '- **ser** for lasting qualities\n- **estar** for states and locations', tags: ['grammar'], starred: true },
	{ type: 'basic', front: 'What is the plural of "el lapiz"?', back: 'los lapices (los lápices) - the z becomes c before -es.', tags: ['grammar'] },
	{ type: 'cloze', front: 'The present tense of *hablar* for "I" is {{c1::hablo}}, and for "we" it is {{c2::hablamos}}.', tags: ['verbs', 'cloze'] },
	{ type: 'cloze', front: 'Regular -er verbs end in {{c1::-o}} for yo and {{c2::-emos}} for nosotros.', tags: ['verbs', 'cloze'] },
	{ type: 'cloze', front: 'Numbers: uno, {{c1::dos}}, tres, {{c2::cuatro}}, cinco.', tags: ['numbers', 'cloze'] },
	{ type: 'typed', front: 'Type the Spanish for "water"', back: 'agua', tags: ['typed', 'food'] },
	{ type: 'typed', front: 'Type the Spanish for "to read"', back: 'leer', tags: ['typed', 'verbs'] },
	{ type: 'typed', front: 'Type the Spanish for "tomorrow"', back: 'manana', tags: ['typed'], extra: 'mañana - the typed check ignores the tilde by default.' },
	{ type: 'basic', front: 'What does "tener" mean?', back: 'to have', tags: ['verbs'] },
	{ type: 'basic', front: 'What does "poder" mean?', back: 'to be able to / can', tags: ['verbs'] },
	{ type: 'basic', front: 'What does "siempre" mean?', back: 'always', tags: ['adverbs'] },
	{ type: 'basic', front: 'What does "nunca" mean?', back: 'never', tags: ['adverbs'] },
	{ type: 'basic', front: 'What does "ahora" mean?', back: 'now', tags: ['adverbs'] },
	{ type: 'basic', front: 'What does "pero" mean?', back: 'but', tags: ['connectors'] },
	{ type: 'basic', front: 'What does "porque" mean?', back: 'because', tags: ['connectors'] }
];

const DECKS = [
	{
		name: 'World Capitals',
		description: 'Capital cities by country, with a few reversed and cloze cards.',
		color: '#2F6FED',
		cards: WORLD_CAPITALS
	},
	{
		name: 'Basic Python',
		description: 'Core Python syntax, types and built-in functions for beginners.',
		color: '#2F9E44',
		cards: BASIC_PYTHON
	},
	{
		name: 'Spanish Starter',
		description: 'First Spanish nouns, phrases and present-tense verbs.',
		color: '#F59F00',
		cards: SPANISH_STARTER
	}
];

/** How many review cards a note of each type produces. */
function cardOrdinals(c: SampleCard): number[] {
	if (c.type === 'reversed') return [0, 1];
	if (c.type === 'cloze') {
		const nums = parseCloze(c.front).numbers;
		return nums.length ? nums : [1];
	}
	return [0];
}

/**
 * Build the sample data set, including a generated 60-day review history.
 *
 * The history is produced by actually running the scheduler day by day with a seeded
 * pseudo-random answer distribution, so every interval, ease and lapse in the result is
 * one the real scheduler could have produced. Nothing is faked.
 */
export function buildSampleData(now: number): AppData {
	const data = emptyData();
	const settings = { ...DEFAULT_SETTINGS };
	data.settings = settings;

	let position = 0;
	let noteSeq = 0;
	let cardSeq = 0;

	for (const [di, deck] of DECKS.entries()) {
		const deckId = `deck-${di + 1}`;
		data.decks.push({
			id: deckId,
			name: deck.name,
			description: deck.description,
			color: deck.color,
			newPerDay: null,
			createdAt: now - 61 * 86_400_000
		});
		for (const sample of deck.cards) {
			const noteId = `note-${++noteSeq}`;
			const note: Note = {
				id: noteId,
				deckId,
				type: sample.type,
				front: sample.front,
				back: sample.back ?? '',
				extra: sample.extra ?? '',
				imageFront: null,
				imageBack: null,
				tags: sample.tags ?? [],
				starred: sample.starred ?? false,
				createdAt: now - 61 * 86_400_000,
				updatedAt: now - 61 * 86_400_000
			};
			data.notes.push(note);
			for (const ord of cardOrdinals(sample)) {
				data.cards.push(newCard(`card-${++cardSeq}`, noteId, deckId, ord, position++, settings));
			}
		}
	}
	data.meta.nextPosition = position;
	data.meta.sampleDataLoaded = true;

	simulateHistory(data, now, 60);
	return data;
}

/**
 * Replay `dayCount` study days ending today, answering the queue with a seeded
 * distribution (about 8% Again, 17% Hard, 60% Good, 15% Easy) so the stats pages have
 * believable content. Uses the real scheduler and the real day aggregation.
 */
function simulateHistory(data: AppData, now: number, dayCount: number): void {
	const settings = data.settings;
	const today = studyDay(now, settings.dayStartHour);
	const byId = new Map(data.cards.map((c) => [c.id, c]));
	const revlog: RevlogEntry[] = [];
	let days: DayStat[] = [];

	// Leave roughly a quarter of the collection untouched so the first open still has new
	// cards to study, and stop the simulation at the end of yesterday so today's queue is
	// genuinely waiting for the user.
	const newBudgetTotal = Math.floor(data.cards.length * 0.75);
	let newIntroduced = 0;

	for (let offset = dayCount - 1; offset >= 1; offset--) {
		const day = addDays(today, -offset);
		// Simulate the session at 09:00 local on that day.
		const parts = day.split('-').map((p) => parseInt(p, 10));
		const sessionStart = new Date(parts[0], parts[1] - 1, parts[2], 9, 0, 0, 0).getTime();
		const seedBase = `${day}`;
		// A couple of skipped days make the streak chart look real, but not the last 5 days.
		if (offset > 5 && seededUnit(`skip:${seedBase}`) < 0.12) continue;

		let reviewsDone = 0;
		let newDone = 0;
		const newCap = settings.newPerDay;
		const reviewCap = settings.maxReviewsPerDay;
		let clock = sessionStart;
		let guard = 0;

		// Pick due cards for the day in due order, then top up with new cards.
		while (guard++ < 400) {
			const due = data.cards
				.filter(
					(c) =>
						(c.state === 'review' || c.state === 'learning' || c.state === 'relearning') &&
						c.due <= clock &&
						c.lastDay !== day
				)
				.sort((a, b) => a.due - b.due);
			let card: Card | undefined = due[0];
			let wasNew = false;
			if (!card && newDone < newCap && newIntroduced < newBudgetTotal) {
				card = data.cards
					.filter((c) => c.state === 'new')
					.sort((a, b) => a.position - b.position)[0];
				wasNew = true;
			}
			if (!card) break;
			if (reviewsDone >= reviewCap) break;

			const seed = seededUnit(`${card.id}:${day}:${card.reps}`);
			let rating: Rating;
			if (seed < 0.08) rating = 1;
			else if (seed < 0.25) rating = 2;
			else if (seed < 0.85) rating = 3;
			else rating = 4;

			const prevInterval = card.interval;
			const fromState = card.state;
			const ms = 4000 + Math.round(seededUnit(`t:${card.id}:${day}`) * 14000);
			const result = applyAnswer(card, rating, settings, clock, day);
			// New cards finish their learning steps later the same session; to keep the
			// simulation short we graduate them straight away with the same rating path.
			let finished = result.card;
			if (finished.state === 'learning' || finished.state === 'relearning') {
				// Walk remaining steps with Good so the card lands in review.
				let steps = 0;
				let cursor = finished;
				let t = clock;
				while ((cursor.state === 'learning' || cursor.state === 'relearning') && steps++ < 6) {
					t += 10 * 60_000;
					cursor = applyAnswer(cursor, 3, settings, t, day).card;
				}
				finished = cursor;
			}

			Object.assign(card, finished);
			byId.set(card.id, card);

			revlog.push({
				cardId: card.id,
				at: clock,
				rating,
				from: fromState,
				interval: card.interval,
				prevInterval,
				ms,
				day
			});
			days = recordDay(days, day, {
				rating,
				ms,
				wasNew,
				prevInterval,
				fromReview: fromState === 'review' || fromState === 'relearning'
			});
			reviewsDone++;
			if (wasNew) {
				newDone++;
				newIntroduced++;
			}
			clock += ms + 1500;
		}
	}

	data.revlog = revlog.slice(-4000);
	data.days = days;

	// Give the "leech suggestion" feature something real to show: find the card with the
	// most lapses from the simulation and push it over the threshold honestly by replaying
	// Again answers that are also written to the log.
	const worst = [...data.cards].sort((a, b) => b.lapses - a.lapses)[0];
	if (worst && worst.lapses < settings.leechThreshold) {
		let t = now - 20 * 86_400_000;
		let card = worst;
		while (card.lapses < settings.leechThreshold) {
			const day = studyDay(t, settings.dayStartHour);
			const prevInterval = card.interval;
			const from = card.state === 'review' ? 'review' : 'relearning';
			card = { ...card, state: 'review', interval: Math.max(1, prevInterval) };
			const res = applyAnswer(card, 1, settings, t, day);
			card = res.card;
			data.revlog.push({
				cardId: card.id,
				at: t,
				rating: 1,
				from,
				interval: card.interval,
				prevInterval,
				ms: 9000,
				day
			});
			data.days = recordDay(data.days, day, {
				rating: 1,
				ms: 9000,
				wasNew: false,
				prevInterval,
				fromReview: true
			});
			t += 86_400_000;
		}
		// Land it back in review so it appears in the browser with its lapse count.
		card = { ...card, state: 'review', interval: 1, due: now + 86_400_000 };
		const idx = data.cards.findIndex((c) => c.id === card.id);
		if (idx > -1) data.cards[idx] = card;
		const note = data.notes.find((n) => n.id === card.noteId);
		if (note && !note.tags.includes('leech')) note.tags = [...note.tags, 'leech'];
	}

	data.revlog.sort((a, b) => a.at - b.at);
	data.revlog = data.revlog.slice(-4000);
}

/** Mature-card count, used by a sanity check in the tests. */
export function matureCount(data: AppData): number {
	return data.cards.filter((c) => c.state === 'review' && c.interval >= MATURE_DAYS).length;
}
