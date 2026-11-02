// Card characteristics the randomizer can weight or require ("at least one +Buy", "no Attacks").
// Type- and cost-based traits are exact; text-based ones (village, trasher ...) are heuristics.

import type { Card } from "./types";
import type { CardDb } from "./setup";

export interface Trait {
  id: string;
  label: string;
  group: "type" | "cost" | "role" | "mechanic";
  /** True when the card (or, for split piles, any card in the pile) has the trait. */
  test(card: Card, db: CardDb): boolean;
}

/** All text on a pile, including split-pile members. */
export function pileText(card: Card, db: CardDb): string {
  const members = card.pile?.members.map((m) => db.get(m)) ?? [];
  return [card, ...members].map((c) => `${c.text}\n${c.text2 ?? ""}`).join("\n");
}

function pileTypes(card: Card, db: CardDb): Set<string> {
  const members = card.pile?.members.map((m) => db.get(m)) ?? [];
  return new Set([card, ...members].flatMap((c) => c.types));
}

const type = (id: string, label: string, t: string): Trait => ({
  id, label, group: "type", test: (c, db) => pileTypes(c, db).has(t),
});
const text = (id: string, label: string, group: Trait["group"], re: RegExp): Trait => ({
  id, label, group, test: (c, db) => re.test(pileText(c, db)),
});
const cost = (id: string, label: string, f: (c: NonNullable<Card["cost"]>) => boolean): Trait => ({
  id, label, group: "cost", test: (c) => !!c.cost && f(c.cost),
});

export const TRAITS: Trait[] = [
  type("attack", "Attacks", "Attack"),
  type("duration", "Durations", "Duration"),
  type("reaction", "Reactions", "Reaction"),
  type("treasure", "Treasures", "Treasure"),
  type("victory", "Victory cards", "Victory"),
  type("night", "Night cards", "Night"),
  type("reserve", "Reserves", "Reserve"),
  type("command", "Commands", "Command"),
  type("liaison", "Liaisons", "Liaison"),
  type("omen", "Omens", "Omen"),
  type("fate", "Fate cards (Boons)", "Fate"),
  type("doom", "Doom cards (Hexes)", "Doom"),
  type("looter", "Looters (Ruins)", "Looter"),
  cost("cost2", "Cost $2 or less", (c) => !c.debt && !c.potion && c.coin <= 2),
  cost("cost3", "Cost $3", (c) => !c.debt && !c.potion && c.coin === 3),
  cost("cost4", "Cost $4", (c) => !c.debt && !c.potion && c.coin === 4),
  cost("cost5", "Cost $5", (c) => !c.debt && !c.potion && c.coin === 5),
  cost("cost6", "Cost $6 or more", (c) => !c.debt && !c.potion && c.coin >= 6),
  cost("potion", "Potion costs", (c) => c.potion),
  cost("debt", "Debt costs", (c) => c.debt > 0),
  text("village", "Villages (+2 Actions)", "role", /\+[2-9] Actions|\+\d+ Villagers?/),
  text("draw", "Draw (+2 Cards or more)", "role", /\+[2-9] Cards/),
  text("buy", "+Buy", "role", /\+\d+ Buys?\b/),
  text("trasher", "Trashing", "role", /\btrash (?:a|up to|any|one|\d+|cards?)\b/i),
  text("gainer", "Gainers", "role", /\bgain an? (?:card|Action|Treasure|Victory|Silver|Gold)/i),
  text("cantrip", "Cantrips (+1 Card +1 Action)", "role", /\+1 Card\*\*\n\*\*\+1 Action/),
  text("loot", "Uses Loot", "mechanic", /\bLoot\b/),
  text("coffers", "Coffers", "mechanic", /\bCoffers\b/),
  text("villagers", "Villagers", "mechanic", /\bVillagers?\b/),
  text("exile", "Exile", "mechanic", /\bExile/),
  text("horse", "Horses", "mechanic", /\bHorses?\b/),
  text("favors", "Favors", "mechanic", /\bFavors?\b/),
  text("tokens", "Victory tokens", "mechanic", /\{vp:\+/),
];

export const TRAIT_BY_ID = new Map(TRAITS.map((t) => [t.id, t]));

/** Precomputes trait membership for every Kingdom pile. */
export function traitIndex(db: CardDb): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const c of db.data.cards) {
    if (c.kind !== "kingdom") continue;
    index.set(c.id, new Set(TRAITS.filter((t) => t.test(c, db)).map((t) => t.id)));
  }
  return index;
}
