# Roadmap

What's left after the first prototype (commit 8749484). The product spec is `.claude/spec.md`
(kept out of git because it contains a wiki session cookie).

## In progress

Nothing — the plain-TypeScript redesign is built for desktop (table layout) and phones (art tiles, pull-up Setup sheet, thumb bar, tap-to-select quick card).

## Next, in priority order

1. **Our own rules reference for every card.** Synthesize the official FAQ (rulebooks) and the
   wiki's unofficial FAQ/rules clarifications into rules explanations written for this app — not
   copied from the wiki — and fill gaps where the wiki's FAQ is thin or missing (e.g. split-pile
   randomizer cards, basic cards, Allies piles; see `data/generated/report.txt` for cards with no
   FAQ). Store them alongside the wiki data (e.g. `data/rules/<card-id>.md`) so a wiki refresh
   doesn't overwrite them, mark which statements come from official rulings, and show them in the
   card view with the wiki FAQ as a secondary source. Include general rules reference pages
   (Setup, Stop-moving rule, Lose-track rule, Durations, Split piles ...) the same way.
2. **Accounts and history (D1).** Username + password login (hashed, e.g. PBKDF2 via WebCrypto),
   history stored locally and synced when logged in. Decide how edits affect history: a generated
   kingdom is a draft until the user confirms they played it; replacing cards edits the draft, not
   a played entry. Multi-select and delete-all. Owned expansions saved per account and used as the
   default pool and to filter the card reference.
3. **History-driven features.** Mark recommended kingdoms as played or crossed off (counts as done
   without adding history); show which ones haven't been played; bias towards unseen cards or
   exclude seen ones (the randomizer already accepts a per-card weight via `RollContext.cardWeight`);
   stats on played cards and expansions.
4. **Card interactions.** Procedurally detect interactions between cards' mechanics (e.g.
   Innovation + Sculptor, Way of the Mouse + Durations, Trait targets, gain-to-hand vs gain
   triggers, stop-moving / lose-track cases). Highlight interactions with a selected pile, summarize
   notable ones on the kingdom screen, and a standalone two-card interaction explorer with a
   shortcut from any card in a kingdom. The wiki's "Synergies"/"Other rules clarifications"
   sections and card-mentions in FAQ text are a starting corpus.
5. **Multiplayer rooms (Durable Objects).** Shared room code; collaborative pile selection and a
   common reference (kingdom, setup, rules, interactions) once generated; shared history. Room
   state can reuse the seeded engine: share inputs + seed, not results. Drafting games later.
6. **Bindings for accounts and rooms.** The first deploy has no D1 or Durable Objects. When accounts/history
   arrive: `wrangler d1 create dominion-randomizer`, add the `d1_databases` binding and `migrations/`; for rooms,
   add the Durable Object binding plus a `migrations` entry with `new_sqlite_classes`.

## Smaller items

- Code-split the card data (the bundle is ~500 kB before gzip).
- Black Market: decide on split piles/Knights/Castles in the deck (currently excluded).
- Arcana: remove from `EXCLUDED_SETS` in `scripts/supplement.ts` once it's released.
- Kingdom fix list in `scripts/supplement.ts` (Hand Madness) should be re-checked after each refresh.
