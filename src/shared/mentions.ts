// Rulings that connect two cards: a statement in one card's FAQ (wiki) or rules file (this app)
// that names another card. Built by scripts/build-mentions.ts into public/data/mentions.json and
// used by the interactions view (src/shared/interactions.ts).

import type { CardData, FaqItem, FaqSection } from "./types";

/** A ruling: [card whose ruling it is, source, text]. */
export type Ruling = [from: string, source: "app" | "wiki", text: string];
export interface MentionIndex {
  rulings: Ruling[];
  /** Card id -> [other card id, index into rulings] (each ruling is listed under both cards). */
  byCard: Record<string, [other: string, ruling: number][]>;
}

/** Rulings that name both cards (either card's own rulings). */
export function rulingsBetween(index: MentionIndex, a: string, b: string): Ruling[] {
  return (index.byCard[a] ?? []).filter(([other]) => other === b).map(([, i]) => index.rulings[i]!);
}

const CARD_REF = /\{card:([^|}]+)/g;

/** Text items from a Markdown rules file (list items and paragraphs), without the [official] tag. */
function guideLines(md: string): string[] {
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, "");
  return body.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    .map((l) => l.replace(/^[-*]\s+/, "").replace(/\s*\[official\]\s*$/i, ""));
}

function faqLines(items: FaqItem[]): string[] {
  return items.flatMap((i) => [i.text, ...faqLines(i.children ?? [])]);
}

export function buildMentions(data: CardData, faq: Record<string, FaqSection[]>, ownRules: Record<string, string>): MentionIndex {
  const byName = new Map<string, string>();
  for (const c of data.cards) {
    byName.set(c.name.toLowerCase(), c.id);
    byName.set(c.wikiTitle.toLowerCase(), c.id);
  }
  const kind = new Map(data.cards.map((c) => [c.id, c.kind]));
  // A pile and its own cards (Knights and Dame Anna, Augurs and Sibyl ...) aren't an interaction.
  const pileOf = new Map(data.cards.map((c) => [c.id, c.pileId ?? c.id]));
  const index: MentionIndex = { rulings: [], byCard: {} };
  const seen = new Set<string>();
  const add = (from: string, source: "app" | "wiki", text: string) => {
    let ruling = -1;
    const others = new Set([...text.matchAll(CARD_REF)].map((m) => byName.get(m[1]!.toLowerCase())).filter((id): id is string => !!id));
    for (const other of others) {
      // Basic cards (Copper, Province ...) are named all the time; they aren't interactions.
      if (other === from || kind.get(other) === "basic" || kind.get(from) === "basic" || pileOf.get(other) === pileOf.get(from)) continue;
      const key = `${from}|${other}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (ruling < 0) ruling = index.rulings.push([from, source, text]) - 1;
      (index.byCard[from] ??= []).push([other, ruling]);
      (index.byCard[other] ??= []).push([from, ruling]);
    }
  };
  for (const id of Object.keys(ownRules).sort()) for (const line of guideLines(ownRules[id]!)) add(id, "app", line);
  for (const id of Object.keys(faq).sort()) {
    for (const s of faq[id]!) if (!s.deprecated) for (const line of faqLines(s.items)) add(id, "wiki", line);
  }
  return index;
}
