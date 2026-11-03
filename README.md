# Dominion Randomizer

Randomizer and setup reference for *Dominion*, deployed to dominion.adambyle.net on Cloudflare
(Workers static assets + D1 + Durable Objects). The product spec is in `.claude/spec.md`.

## Layout

- `scripts/` — data pipeline (wiki export → app data) and checks
- `src/shared/` — types, seeded RNG, and the setup engine (used by the client and the Worker)
- `src/client/` — front end in plain TypeScript (no framework): `main.ts` shell and routing, `state.ts` store, `model.ts` table layout, `views/` (the expansion selection pane is `views/expansions.ts`; Tune holds weights and limits)
- `src/worker/` — API (Hono): accounts, synced history and settings in D1; multiplayer rooms (Durable Object)
- `src/data/` — generated card and recommended-kingdom data, bundled into the client
- `data/rules/` — the app's own rules reference, hand-written Markdown (see below)
- `public/data/` — generated FAQ and rules reference, served as static assets
- `public/img/` — card, box and symbol images from the wiki (git-ignored; `npm run images`)

## Deploying

The site is a Cloudflare Worker with static assets, served at https://dominion.adambyle.net.

```bash
npm run images   # on a fresh checkout: card images are not in git
npm run deploy   # builds, then wrangler deploy
```

## Accounts and history

Played kingdoms ("Mark as played" under the table) are saved in the browser and listed at
`#/history`. With an account (`#/account`) the history and the owned sets sync across devices.

- The Worker (`src/worker/`) serves `/api/*` with Hono and stores accounts, sessions and history in
  D1 (binding `DB`). The tables are created on first use, so there is no migration step.
- `wrangler.jsonc` names the database without an id; `wrangler deploy` creates it on the first
  deploy (automatic provisioning). If you'd rather create it yourself:
  `npx wrangler d1 create dominion-randomizer` and add the printed `database_id` to the binding.
- Without a `DB` binding the API answers 503 and the app quietly stays local-only.
- Passwords are hashed with PBKDF2-SHA256 at 2,000 iterations (about 1.5 ms of CPU) (`PBKDF2_ITERATIONS` in
  `src/worker/auth.ts`): accounts only guard game history, so hashing is kept cheap enough for the
  Workers Free plan. Each hash stores its iteration count, and sign-in re-hashes passwords made
  with a different count.
- Recommended kingdoms marked played / crossed off sync the same way (D1 table `marks`). History
  also feeds Tune → *Cards you've played* and the Stats tab on `#/history`.
- `npm run dev` runs the Worker and a local D1 (in `.wrangler/`) through the Cloudflare Vite plugin.

## Refreshing card data from the wiki

The Dominion Strategy wiki blocks automated clients, so the export runs in a browser session that
has passed the site's check:

1. Open https://wiki.dominionstrategy.com in a browser and let the bot check finish.
2. Run `scripts/wiki-export.browser.js` in that tab (paste it into the console, or ask Claude to run
   it in the built-in browser). It downloads `dominion-wiki-export.json`.
3. Move it to `data/raw/wiki-export.json` and run:

   ```bash
   npm run data
   npx tsx scripts/check-setup.ts > data/generated/setup-check.txt
   npm test
   ```

4. Review `data/generated/report.txt` (parse warnings) and diff `setup-check.txt` (what each card
   pulls into setup) before committing.

### Images

Card scans, art crops, box covers, set icons and cost symbols come from the wiki too. Image *files*
aren't behind the bot check, but their URLs have to be looked up through the API, so:

1. In the same verified browser tab, run `scripts/wiki-images.browser.js`. It downloads
   `dominion-wiki-images.json`; move it to `data/raw/wiki-images.json`.
2. `npm run images` downloads anything missing into `public/img/` and writes `src/data/images.json`.
   Run it on any fresh checkout before `npm run dev` or `npm run deploy`.

Things the wiki doesn't express in a machine-readable way live in `scripts/supplement.ts`: boxes and
editions, the 1st-edition Cornucopia/Guilds split, split-pile composition, excluded sets (Arcana,
until it's released) and corrections to recommended kingdoms.

## The app's own rules reference

`data/rules/cards/<card-id>.md` holds rules explanations for one card or split pile, and
`data/rules/topics/<id>.md` holds general rules pages (shown at `#/rules`). They're written for
this app, not copied from the wiki, and a wiki refresh never touches them. The card sheet shows them
first, with the wiki FAQ as a secondary source. The format is documented at the top of
`src/shared/guide.ts`: Markdown lists using the same inline markup as the card data, plus
`{rule:topic-id}` links and a trailing `[official]` on statements that restate an official ruling.
`npm test` checks that every file names a real card and that every link points to a card or topic
that exists.

## Multiplayer rooms

`#/room` starts or joins a room. Each room is a `Room` Durable Object (`src/worker/room.ts`, binding
`ROOMS`, migration `v1` in `wrangler.jsonc`) reached at `/api/rooms/<code>/ws`; rooms work without
D1 or accounts. Rooms relay the table's inputs and settings; every client resolves the setup itself
with the seeded engine. `npm run dev` runs Durable Objects locally too.

## Card interactions

`src/shared/interactions.ts` detects interactions from card mechanics; `public/data/mentions.json`
indexes rulings that name two cards (from the wiki FAQ and `data/rules/cards`). Regenerate it with
`npm run mentions` after editing rules files (`npm run data` also runs it); `npm test` fails if it's
stale.

Wiki content is CC BY-NC-SA 3.0; the app credits the wiki wherever FAQ or rules text is shown.
