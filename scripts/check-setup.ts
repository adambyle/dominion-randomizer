// Runs every Kingdom pile and landscape through the setup engine on its own and prints what it
// pulls in. Review the output after a data refresh to catch false matches in the text rules.
import { readFileSync } from "node:fs";
import type { CardData } from "../src/shared/types";
import { createDb, resolveSetup } from "../src/shared/setup";
import { createRng } from "../src/shared/random";

const data: CardData = JSON.parse(readFileSync("src/data/cards.json", "utf8"));
const db = createDb(data);
const pool = new Set(data.cards.filter((c) => c.kind === "kingdom" || c.kind === "landscape").map((c) => c.id));
for (const c of data.cards.filter((c) => c.kind === "kingdom" || c.kind === "landscape")) {
  const isLandscape = c.kind === "landscape";
  if (c.types.includes("Ally") || c.types.includes("Prophecy")) continue;
  const r = resolveSetup({ kingdom: isLandscape ? [] : [c.id], landscapes: isLandscape ? [c.id] : [], players: 3,
    platinumColony: false, shelters: false }, db, pool, createRng(1));
  const parts = [
    ...r.extraKingdom.map((p) => `+pile ${p.id}`),
    ...r.basic.filter((p) => !["copper", "silver", "gold", "estate", "duchy", "province", "curse"].includes(p.id)).map((p) => `basic ${p.id}`),
    ...r.nonSupply.map((p) => `ns ${p.id}`),
    ...r.statuses.map((s) => `st ${s.id}`),
    ...r.decks.map((d) => `deck ${d.id}`),
    ...r.setAside.map((s) => `aside ${s.id}`),
    ...r.landscapes.filter((l) => l.id !== c.id).map((l) => `ls ${l.id}`),
    ...r.tokens.map((t) => `tok ${t.id}`),
    ...(r.trash.length ? ["trash zombies"] : []),
    ...r.startingDeck.cards.filter((x) => !["copper", "estate"].includes(x.id)).map((x) => `deck+ ${x.id}`),
  ];
  if (parts.length) console.log(`${c.name}: ${parts.join(", ")}`);
}
