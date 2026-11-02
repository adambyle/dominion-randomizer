# Dominion Randomizer

Randomizer and setup reference for *Dominion*, deployed to dominion.adambyle.net on Cloudflare
(Workers static assets + D1 + Durable Objects). The product spec is in `.claude/spec.md`.

## Layout

- `scripts/` — data pipeline (wiki export → app data) and checks
- `src/shared/` — types, seeded RNG, and the setup engine (used by the client and the Worker)
- `src/client/` — React app
- `src/worker/` — API (Hono), D1 access, multiplayer rooms (Durable Object)
- `src/data/` — generated card and recommended-kingdom data, bundled into the client
- `public/data/` — generated FAQ and rules reference, served as static assets

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

Things the wiki doesn't express in a machine-readable way live in `scripts/supplement.ts`: boxes and
editions, the 1st-edition Cornucopia/Guilds split, split-pile composition, excluded sets (Arcana,
until it's released) and corrections to recommended kingdoms.

Wiki content is CC BY-NC-SA 3.0; the app credits the wiki wherever FAQ or rules text is shown.
