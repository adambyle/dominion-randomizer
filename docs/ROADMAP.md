# Roadmap

What's left after the first prototype (commit 8749484). The product spec is `.claude/spec.md`
(kept out of git because it contains a wiki session cookie).

## Done

**1. Our own rules reference.** Every card (850) has a hand-written rules file in
`data/rules/cards/`, and there are 18 general topic pages in `data/rules/topics/` (setup, turns,
game end, split piles, Durations, Reserves, Travellers, tokens, costs/Debt, Exile, Night/Boons/Hexes,
Loot, Shadows/Omens, landscapes, Attacks/Reactions, stop-moving and lose-track rules). The card
sheet shows them first with *Official* tags; the wiki FAQ is a collapsed secondary source.
`npm test` validates every file; `npm run data` reports any card without a file (e.g. after a wiki
refresh adds Arcana).

Follow-ups for the rules reference:

- Review pass against the rulebooks, especially which statements are tagged *Official*.
- More topics as needed (Black Market deck, the no-visiting rule, Possession/extra turns).
- New cards from future refreshes need files; the report lists them.

**2. Accounts and history.** Username + password accounts (PBKDF2, HttpOnly session cookie,
throttled sign-in), a "Mark as played" control under the table, `#/history` with multi-select,
delete and delete-all, "Set up again", and sync of history (newest version wins, deletions kept as
tombstones) and owned sets across devices. History works without an account; signing in merges the
device's history into the account and signing out clears it from the device. D1 binding added
(created automatically on deploy). See README → Accounts and history.

Follow-ups for accounts:

- Password change / reset (there is no email, so a reset would need another mechanism).
- Notes or scores on history entries.
- Rate limiting by IP as well as by username.

**3. History-driven features.** Recommended kingdoms can be marked *Played* or *Crossed off*
without adding history (synced like history; a game set up from a recommended kingdom and marked
played counts too), with badges, an "X of Y done" count and a "Hide played and crossed off" filter.
Tune → *Cards you've played*: As usual / Less often / Skip (Skip falls back to "less often" with a
note when there aren't enough unplayed cards). History → *Stats*: games played, share of your
cards played, recommended kingdoms done, most played cards, games per expansion, and the Kingdom
cards you haven't played yet.

**4. Card interactions.** `src/shared/interactions.ts` detects 14 kinds of interaction from card
mechanics (replaying Durations or cards that move themselves, Command/"leave it there" plays, Ways
on Durations and movers, discard and trash triggers, gain-to-deck vs gained-to-hand, cost reducers
vs gain-by-cost, play-on-gain, Events vs "when you buy", Attacks vs Reactions, Patron reveals,
Shadows, Capitalism), each with an explanation linking to the rules topics. Rulings that name two
cards (wiki FAQ and this app's rules) are indexed by `npm run mentions` into
`public/data/mentions.json` (a test checks it's current). Shown as "Notable interactions" on the
table (and phone Setup sheet), an Interactions section in each card sheet, "Interacts with" in the
phone quick card, and the `#/interactions/<a>/<b>` explorer (one card lists everything it interacts
with).

Follow-ups for interactions:

- More detectors (Possession, Outpost/extra turns, Black Market timing, Enchantress, Highwayman,
  Trait targets, Reactions to gaining).
- Tune the broad detectors (discard/trash triggers match many cards) using play feedback.

**5. Multiplayer rooms.** A Room Durable Object per 6-character code (`src/worker/room.ts`,
WebSocket hibernation, SQLite-backed storage, deleted after two weeks idle). Rooms share the
table's inputs (Kingdom, landscapes, locks, choices, seed) and the settings that decide the deal;
each client resolves the setup with the seeded engine, so everyone sees the same setup. Anyone
can deal, swap, lock, add or load a recommended kingdom. `#/room` creates or joins (invite links
`#/room/<code>`), lists who's there, sets the room's sets ("Use my sets" / "Combine everyone's
sets"), and shows the room's played games; "Mark as played" in a room saves the game to every
member's history. Your own table and settings are kept and come back when you leave; reloading
rejoins the room.

Follow-ups for rooms:

- Drafting games (pick piles in turn).
- Last-writer-wins today: simultaneous edits can overwrite each other; add per-change merging if
  that bites.
- Rate limits / size caps per room beyond the current message limits.

## Next, in priority order

1. ~~**Our own rules reference for every card.**~~ Done (see above). Synthesize the official FAQ (rulebooks) and the
   wiki's unofficial FAQ/rules clarifications into rules explanations written for this app — not
   copied from the wiki — and fill gaps where the wiki's FAQ is thin or missing (e.g. split-pile
   randomizer cards, basic cards, Allies piles; see `data/generated/report.txt` for cards with no
   FAQ). Store them alongside the wiki data (e.g. `data/rules/<card-id>.md`) so a wiki refresh
   doesn't overwrite them, mark which statements come from official rulings, and show them in the
   card view with the wiki FAQ as a secondary source. Include general rules reference pages
   (Setup, Stop-moving rule, Lose-track rule, Durations, Split piles ...) the same way.
2. ~~**Accounts and history (D1).**~~ Done (see above). Username + password login (hashed, e.g. PBKDF2 via WebCrypto),
   history stored locally and synced when logged in. Decide how edits affect history: a generated
   kingdom is a draft until the user confirms they played it; replacing cards edits the draft, not
   a played entry. Multi-select and delete-all. Owned expansions saved per account and used as the
   default pool and to filter the card reference.
3. ~~**History-driven features.**~~ Done (see above). Mark recommended kingdoms as played or crossed off (counts as done
   without adding history); show which ones haven't been played; bias towards unseen cards or
   exclude seen ones (the randomizer already accepts a per-card weight via `RollContext.cardWeight`);
   stats on played cards and expansions.
4. ~~**Card interactions.**~~ Done (see above). Procedurally detect interactions between cards' mechanics (e.g.
   Innovation + Sculptor, Way of the Mouse + Durations, Trait targets, gain-to-hand vs gain
   triggers, stop-moving / lose-track cases). Highlight interactions with a selected pile, summarize
   notable ones on the kingdom screen, and a standalone two-card interaction explorer with a
   shortcut from any card in a kingdom. The wiki's "Synergies"/"Other rules clarifications"
   sections and card-mentions in FAQ text are a starting corpus.
5. ~~**Multiplayer rooms (Durable Objects).**~~ Done (see above). Shared room code; collaborative pile selection and a
   common reference (kingdom, setup, rules, interactions) once generated; shared history. Room
   state can reuse the seeded engine: share inputs + seed, not results. Drafting games later.
6. ~~**Bindings for rooms.**~~ Done: `ROOMS` Durable Object binding and the `v1` migration
   (`new_sqlite_classes: ["Room"]`) are in `wrangler.jsonc`.

## Smaller items

- Code-split the card data (the bundle is ~500 kB before gzip).
- Black Market: decide on split piles/Knights/Castles in the deck (currently excluded).
- Arcana: remove from `EXCLUDED_SETS` in `scripts/supplement.ts` once it's released.
- Kingdom fix list in `scripts/supplement.ts` (Hand Madness) should be re-checked after each refresh.
