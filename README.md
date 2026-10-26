# FlashFlow

**Study less. Remember more.**

A free spaced repetition flashcard app. Create decks and cards, import from CSV, study a
daily review queue, and track your progress with clear statistics. FlashFlow shows each card
shortly before you are likely to forget it.

**Every byte of your data stays in your browser.** No account, no server database, no
uploads, no tracking.

## Live demo

- **Live app:** https://flashflow-mu.vercel.app
- **Source:** https://github.com/DIVYAPRIYADHARSHINI-GIT/flashflow

The live app opens with three sample decks and a generated 60-day review history, so every
screen has realistic content on the first visit.

## Features

### Decks and cards

- Decks with a name, description and colour, and optional one-level nesting with
  `Parent::Child` names. Rename, move, duplicate and delete (with confirmation). Renaming a
  parent renames its children so the tree stays intact.
- Four card types:
  - **Basic** — front and back.
  - **Basic and reversed** — creates two review cards (front→back and back→front).
  - **Cloze deletion** — `{{c1::hidden part}}`, one review card per cloze number, with
    optional hints (`{{c1::answer::hint}}`) and nested braces inside the hidden text.
  - **Typed answer** — you type the answer and see a character-level difference highlight.
- Simple formatting in card text: `**bold**`, `*italic*`, `- bullet lists`, line breaks,
  `` `inline code` `` and ``` fenced code blocks. All user text is escaped before any markup
  is applied, so a card can never inject HTML.
- Optional extra field for notes or mnemonics, and one optional image per side, compressed
  under 100 KB and stored locally. A warning appears when storage is getting full.
- Tags with search and filter, and duplicate detection when a card with the same front
  already exists in the same deck.
- **Card browser** — a table on desktop and cards on mobile, showing front, deck, tags,
  state, due date, interval, ease, lapses and last reviewed, with search, filters, sorting,
  bulk select and bulk actions (move, tag, suspend, unsuspend, reset progress, delete). The
  table is paged at 100 rows so 10,000 cards never freeze the page.
- Keyboard-friendly fast entry: Enter adds a card and keeps the deck, type and tags; Tab
  moves between fields; Ctrl/Cmd+Enter adds from any field.

### Study

- A distraction-free study screen: the card in the centre, New / Learning / Due counts in the
  corner, a slim progress bar, **Show answer** (Space), then the four answer buttons
  (keys **1** to **4**). Each button shows the next interval before you choose, for example
  "Again 1m · Hard 6d · Good 10d · Easy 15d".
- Answer colours are never colour-only: every button carries a text label and its shortcut
  number as well as its colour.
- Typed answer mode compares your answer tolerantly (case and extra spaces always ignored;
  accents and punctuation optional) and highlights the difference.
- Session timer that ignores idle time (at most 60 seconds counted per card), with Pause and
  Resume, and a session summary at the end: cards studied, correct percentage, time spent
  and what is due next.
- Undo the last answer, and Suspend or Bury a card during study.
- **Custom study** that never changes your schedule: Cram (a whole deck before an exam, with
  an end date), Review ahead (cards due in the next N days), Leeches only and Starred only.
  The screen states clearly when a session will not affect the schedule.
- A light flip animation only, and none at all with `prefers-reduced-motion`.

### Home, reminders and streaks

- Decks list with New / Learning / Due counts, a big **Study now** button, a streak counter
  and a short "Today" summary.
- The number of due cards appears in the tab title and as an in-app banner. An optional
  browser notification can fire while the app is open.
- A day counts towards your streak once you complete your daily goal (one review by
  default). Current and longest streak are both shown.

### Statistics

Hand-written SVG charts, no chart library:

- **Today** — cards studied, time, Again/Hard/Good/Easy counts, correct percentage.
- **Forecast** — cards due for the next 30 days (bar chart, mature portion highlighted,
  overdue cards counted on today).
- **Reviews per day** and **time studied per day** for the last 30, 90 or 365 days.
- **Retention** — the share of mature answers (interval of 21 days or more) that were not
  "Again", with young cards shown separately.
- **Card states** (donut) and **interval distribution** (bar chart).
- **Calendar heatmap** of the last 365 days.
- Per-deck and all-decks views with a date range filter, clear empty states, and a dash
  instead of a number whenever there is no data — FlashFlow never shows a made-up figure.

### Import, export and print

- **CSV import** — choose a file, preview the first rows, map columns (front, back, tags,
  deck, extra) with automatic detection by header name, choose a delimiter (comma, semicolon
  or tab, auto-detected), and skip or update duplicates. Handles quoted fields, line breaks
  inside fields, escaped `""` quotes, a UTF-8 BOM and non-English text (Tamil, Hindi, emoji).
  A summary reports what was added, updated and skipped, with row-level errors. There is a
  **Download sample CSV** button.
- **Export** a deck or all decks as CSV (with a BOM so spreadsheets detect UTF-8) or as
  tab-separated text. Your scheduling progress is included in the JSON backup.
- **PDF export** through the one SvelteKit server route: a printable deck list, and a
  printable card sheet laid out for double-sided printing — fronts on odd pages and backs on
  even pages **mirrored left to right**, so a duplex print (flip on the long edge) puts each
  answer behind its own question. Fonts are embedded from self-hosted open-licensed files.
- **Complex scripts:** see the note below.

### Settings

New cards per day, maximum reviews per day, reviews between new cards, daily goal, learning
and relearning steps, graduating and easy intervals, starting ease, easy bonus, interval
modifier, maximum interval, leech threshold, day rollover hour, bury siblings, next-interval
labels, typed-answer tolerance, theme, card font and card font size — each with a plain
explanation next to the control. Plus a per-deck new-card override, **Reset to defaults**,
**Load sample data** and **Start fresh**, with confirmation dialogs on the destructive ones.

## How the scheduler works

**A simple spaced repetition scheduler in the SM-2 style. It is a study aid, not a guarantee
of memory.** This is stated on the in-app About page too.

### New and learning cards

A new card walks the configurable learning steps (default **1 minute**, then **10 minutes**).

| Answer | Effect |
| --- | --- |
| Again | Back to the first step |
| Hard | Repeats the current step; on step 0 it uses the average of the first two steps, so it differs from Again |
| Good | Moves to the next step, and graduates to the **graduating interval** (default 1 day) when the steps are done |
| Easy | Skips the remaining steps and graduates straight to the **easy interval** (default 4 days) |

Graduation intervals are exact — "Good 1d" and "Easy 4d" land on precisely that interval.

### Review cards

Each card carries an **ease factor** (default 2.5, floor **1.3**).

| Answer | Interval | Ease |
| --- | --- | --- |
| Again | Lapse: interval reset to 1 day, card enters the relearning steps (default 10 minutes) | −0.20 |
| Hard | × 1.2 | −0.15 |
| Good | × ease | unchanged |
| Easy | × ease × easy bonus (1.3) | +0.15 |

Every interval is then multiplied by the interval modifier and capped at the maximum
interval (default **365 days**). An answer never shortens the schedule: a review card always
moves forward by at least one day.

### Fuzz, leeches, limits and days

- **Seeded fuzz** — intervals of 3 days or more get a small random offset so a batch of
  cards does not all come back on the same day. The offset is a deterministic hash of the
  card id and the interval, so it is identical on every reload and fully repeatable in
  tests. Intervals under 3 days and cards already at the maximum are left exact.
- **Leeches** — a card with 8 or more lapses (configurable) is tagged `leech`, and the app
  suggests suspending or rewriting it.
- **Daily limits** — new cards per day (default 20) and maximum reviews per day (default
  200), with a per-deck override for new cards. The review ceiling applies to the whole daily
  queue, so new cards fill only what is left after the due reviews.
- **Study order** — learning cards due now first, then due reviews mixed with new cards at a
  configurable ratio (one new card after every 4 reviews by default).
- **Bury siblings** — by default only one card per note is shown each day, so the two sides
  of a reversed card or several clozes from one sentence never appear together.
- **Day rollover** — a configurable "new day starts at" hour (default **4 AM**) means
  studying at 01:30 still counts for the previous day. Study days are plain `YYYY-MM-DD`
  strings derived from the **local** calendar date (never from a UTC ISO string, which is the
  classic off-by-one-day bug). Day boundaries are built with `new Date(y, m, d, hour)`, which
  the platform resolves correctly across daylight saving changes, and the code never assumes
  a day is 86,400,000 ms long. This is verified by browser probes at 01:30, 03:59, 04:00,
  across midnight, across both DST transitions, and in Tokyo, Los Angeles and Kolkata.

### What the scheduler cannot do

- It cannot know whether a card is well written. A confusing card becomes a leech.
- It does not measure your actual recall probability. Intervals come from fixed multipliers,
  not from a fitted memory model.
- Retention percentages are simply the share of answers that were not "Again" — a useful
  signal, not a prediction.

## Storage and backup

**All user data is stored only in this browser's `localStorage`, under the single key
`flashflow:data:v1`. It is never uploaded anywhere.**

- There is no account, no database, no KV store, no blob storage and no analytics. The only
  Vercel resource for this project is the hosting project itself.
- The one server route (`/api/pdf`) receives only the rows you chose to print, returns the
  PDF, and stores and logs nothing.
- All data access goes through a single **`StudyStore`** interface with one implementation
  (`LocalStudyStore`). The data schema is versioned (`DATA_VERSION`) with a migration step
  list, so a server-backed store could be added later by writing a second implementation —
  nothing else in the app touches storage directly. **No database is implemented now.**
- Every storage access is wrapped in `try`/`catch`, saves are debounced (400 ms), and the
  size is checked before writing. When storage is blocked (private-mode Safari, disabled by
  policy) or full, the app says so in a banner and keeps working for the session.

### Limits you should know about

- Browsers allow roughly **5 MB** per site. To keep a year of study comfortably inside that,
  FlashFlow stores a permanent one-line summary per study day (which powers every chart) and
  caps the detailed review log at the most recent **4,000** answers. Images are compressed
  under 100 KB each.
- **Clearing your browser data, using a different browser, or using a different device means
  a different, empty FlashFlow.** Losing browser data loses your study progress.
- A persistent **"Your data stays in this browser"** badge, a storage usage meter, and a
  **Privacy and backup** page are always available. The page shows a **Last backup** date and
  reminds you if there has been no backup for 7 days.
- **JSON backup export and import.** An imported file is validated first and a clear error is
  shown for a broken one. Nothing is overwritten until you explicitly choose **Replace
  everything** or **Merge into my data** — and merge matches decks by name and skips a card
  whose front already exists in the same deck rather than replacing it.

## Tamil, Hindi and other complex scripts

`pdf-lib` embeds fonts but has no complex-script **shaping** engine, so it cannot correctly
lay out Tamil or Devanagari glyph clusters (consonant conjuncts and reordered vowel signs).

**What FlashFlow does about it:** the app detects complex-script text in your selection and
shows a warning on the Import and export page, and the server route **refuses** the request
with HTTP 422 and a clear message rather than producing a PDF with broken text. Those decks
use the **Print to PDF** route instead (`/print`), which renders the cards with a print
stylesheet and lets the browser's own text shaper lay the glyphs out correctly — choose "Save
as PDF" in the print dialog. Latin-script decks use the generated PDF normally.

Self-hosted fonts shipped with the app: Inter and Source Serif (SIL Open Font License) for
the interface and Latin card text, and Noto Sans Tamil and Noto Sans Devanagari (SIL Open
Font License) so Tamil and Hindi card text renders correctly on screen and in the print
route.

## Design

A calm, focused study-tool feel: soft off-white background (`#F6F7FB`) with white cards and
light borders, deep navy (`#10213C`) text, and a clear blue (`#2F6FED`) primary colour.
Answer colours — Again `#E03131`, Hard `#F59F00`, Good `#2F9E44`, Easy `#1C7ED6` — each carry
a text label and a shortcut number, so they are never colour-only. Dark mode uses deep navy
surfaces. Inter for the interface with Source Serif as a card-text option, and an adjustable
card font size. A card-stack / flow-wave SVG logo mark. No emoji, no cartoon illustrations.

Left sidebar on desktop, bottom tab bar on mobile. Skeleton loaders, helpful empty states,
error states, toast messages and confirmation dialogs for destructive actions. Responsive
from 360 px to wide desktop, WCAG AA contrast, 44 px tap targets, full keyboard support for
studying, visible focus states, aria labels and screen-reader-friendly card flipping.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | SvelteKit 3 + Svelte 5 runes + TypeScript |
| Styling | Tailwind CSS 4 |
| Hosting | Vercel (free Hobby plan), `@sveltejs/adapter-vercel`, runtime `nodejs22.x` |
| Storage | `localStorage` only, behind the `StudyStore` interface |
| PDF | `pdf-lib` + `@pdf-lib/fontkit` (MIT), in the single `/api/pdf` server route |
| Charts | Hand-written SVG — no chart library |
| Tests | Vitest unit tests + Playwright browser probes |

Every dependency is free, well maintained, pinned to an exact version, and at least two
weeks old. The app is client-rendered (`ssr = false` in `+layout.ts`) because all data lives
in the browser — there is nothing for a server to render, and that avoids a hydration
mismatch between an empty server render and the real local data.

### Logic modules

The logic lives in separate, unit-tested modules with an injectable clock:

| Module | What it covers |
| --- | --- |
| `logic/day.ts` | Study days, rollover hour, time zones, DST, interval formatting |
| `logic/scheduler.ts` | Learning steps, graduation, Hard/Good/Easy, lapses, ease limits, maximum interval, seeded fuzz |
| `logic/queue.ts` | Daily limits, study order, sibling burying, custom study modes, suspend/bury/reset |
| `logic/cloze.ts` | Cloze parsing — several clozes, nested braces, hints, invalid markers |
| `logic/typed.ts` | Typed-answer comparison and the difference highlight |
| `logic/csv.ts` | CSV parsing and writing — quotes, delimiters, line breaks, BOM, Tamil/Hindi/emoji |
| `logic/stats.ts` | Streaks, forecast, retention, card states, interval distribution, heatmap, day aggregation |
| `logic/backup.ts` | JSON backup validation and non-destructive merge |
| `logic/format.ts` | Safe card-text formatting |
| `logic/session.ts` | Session timer with idle capping, pause and resume |
| `logic/sample-data.ts` | The three original sample decks and the generated review history |
| `store/study-store.ts` | The `StudyStore` interface and its one localStorage implementation |
| `store/migrations.ts` | Versioned schema migrations |

## Testing

```bash
npm test            # 176 unit tests across the logic modules
npm run check       # svelte-check: 0 errors, 0 warnings
npm run build       # production build
npm run probe       # Playwright browser probes (needs a server running)
```

**176 unit tests** cover the scheduler (learning steps, graduation, each answer button, ease
floor, interval cap, interval modifier, lapses, leeches, determinism, a 60-day simulated
run), day/rollover/time-zone/DST/leap-day arithmetic, daily limits and queue order, sibling
burying, all four custom study modes, cloze parsing (multiple clozes, nested braces, hints,
unterminated markers), typed-answer comparison (including Tamil and Hindi), CSV parsing
(quotes, delimiters, embedded newlines, BOM, Tamil/Hindi/emoji, a messy combined file),
column mapping and row errors, safe formatting, every statistic, JSON backup validation
against malformed/foreign/truncated/empty files, the store and its migrations, the session
timer, the sample data, and performance guards over 10,000 cards.

**30 browser probe checks** (Playwright, short timeouts) run the real app:

- `probes/e2e.probe.ts` (21) — sample data on first open, adding each of the four card
  types and checking the card counts, duplicate detection, importing a messy CSV with a BOM,
  semicolons, quoted commas, embedded newlines, escaped quotes, Tamil, Hindi and emoji,
  studying with all four answers while **comparing each button's promised interval against
  what was actually stored**, undo, leeches, daily limits, cram mode leaving the schedule
  byte-identical, typed answers, every statistics chart, CSV export, both PDFs (parsed with
  `pdf-lib` to check page count and A4 size), the complex-script refusal and print fallback,
  JSON backup export → start fresh → restore, broken and foreign backup files being rejected
  without touching existing data, dark mode, 360 px with the bottom tab bar, full keyboard
  studying, and 10,000 cards without freezing.
- `probes/clock.probe.ts` (7) — the app driven through a mocked clock at 01:30, 03:59 and
  04:00; an answer before midnight and one after it landing in the same study-day row; both
  DST transitions; Tokyo, Los Angeles and Kolkata; and a 60-day simulated run where intervals
  grow, no card is lost, and the streak and forecast on screen match the stored history.
- `probes/clean-live.probe.ts` (2) — a brand-new visitor sees exactly the three sample decks
  with default settings and none of the test artefacts, and `/api/pdf` is the only API route
  (others 404).

Three real bugs were found and fixed by these tests: graduation intervals were being fuzzed
so a button could promise "4d" and store 3 days; a card at the maximum interval was fuzzed
back below the cap; and the storage meter re-serialised the whole payload on every reactive
read, which made the 10,000-card page take 97 seconds — it is now 7 seconds.

## Setup

Requires Node 20 or newer.

```bash
git clone https://github.com/DIVYAPRIYADHARSHINI-GIT/flashflow.git
cd flashflow
npm install
npm run dev          # http://localhost:5173
```

Other commands:

```bash
npm run build        # production build
npm run preview      # preview the production build
npm test             # unit tests
npm run check        # type and Svelte diagnostics
FF_BASE=http://localhost:4188 npm run probe   # browser probes against a running server
```

No environment variables and no API keys are needed — there are none.

## Deployment

Deployed on **Vercel's free Hobby plan**, linked to the GitHub repository so every push to
`main` deploys automatically.

> Vercel's free Hobby plan is for **non-commercial use only**. A commercial deployment needs
> a paid Vercel plan (or any other static/Node host, since the app only needs static files
> plus one small serverless function for PDF generation).

The only Vercel resource for this project is the hosting project itself — no Blob, no KV, no
Postgres, no other Marketplace product, and no environment variables.

## License

The code in this repository is free to read, use and adapt. The bundled fonts (Inter, Source
Serif, Noto Sans Tamil, Noto Sans Devanagari) are used under the SIL Open Font License. All
sample card content was written for this project and is not copied from any book, website or
existing shared deck.
