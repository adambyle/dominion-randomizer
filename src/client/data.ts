import cardsJson from "../data/cards.json";
import kingdomsJson from "../data/kingdoms.json";
import imagesJson from "../data/images.json";
import type { Card, CardData, FaqSection, RecommendedKingdom } from "../shared/types";
import { createDb } from "../shared/setup";
import type { MentionIndex } from "../shared/mentions";

export const data = cardsJson as unknown as CardData;
export const db = createDb(data);
export const recommended = kingdomsJson as unknown as RecommendedKingdom[];

export interface ImageRef { src: string; w: number; h: number }
const images = imagesJson as unknown as {
  cards: Record<string, { face?: ImageRef; art?: ImageRef }>;
  sets: Record<string, { icon?: ImageRef; box?: ImageRef }>;
  symbols: Record<string, ImageRef>;
};
export const cardImage = (id: string) => images.cards[id]?.face;
export const artImage = (id: string) => images.cards[id]?.art;
export const setIcon = (set: string) => images.sets[set]?.icon;
export const boxImage = (set: string) => images.sets[set]?.box;
export const symbol = (name: string) => images.symbols[name];

const byName = new Map<string, Card>();
for (const c of data.cards) {
  byName.set(c.name.toLowerCase(), c);
  byName.set(c.wikiTitle.toLowerCase(), c);
}
export const cardByName = (name: string) => byName.get(name.toLowerCase());
export const name = (id: string) => db.byId.get(id)?.name ?? id;
export const setName = (id: string) => data.sets.find((s) => s.id === id)?.name ?? id;

export const wikiUrl = (title: string) =>
  `https://wiki.dominionstrategy.com/index.php/${encodeURIComponent(title.replace(/ /g, "_"))}`;

/** Cost, then name — the order piles are laid out on the table. */
export function costValue(c: Card) {
  return c.cost ? c.cost.coin + c.cost.debt * 0.9 + (c.cost.potion ? 0.5 : 0) : 99;
}
export const byCost = (a: Card, b: Card) => costValue(a) - costValue(b) || a.name.localeCompare(b.name);

let faq: Promise<Record<string, FaqSection[]>> | null = null;
export function loadFaq() {
  faq ??= fetch("/data/faq.json").then((r) => r.json());
  return faq;
}

let mentionsPromise: Promise<MentionIndex> | null = null;
let mentionsCache: MentionIndex | null = null;
/** Rulings that name two cards (public/data/mentions.json), loaded on first use. */
export function loadMentions() {
  mentionsPromise ??= fetch("/data/mentions.json").then((r) => r.json() as Promise<MentionIndex>).then((m) => (mentionsCache = m));
  return mentionsPromise;
}
/** The rulings index if it has loaded; otherwise starts loading it and calls `then` once it has. */
const mentionsWaiting = new Set<() => void>();
export function mentions(then?: () => void): MentionIndex | null {
  if (!mentionsCache) {
    const first = !mentionsWaiting.size;
    if (then) mentionsWaiting.add(then);
    if (first) void loadMentions().then(() => { for (const fn of mentionsWaiting) fn(); mentionsWaiting.clear(); }, () => undefined);
  }
  return mentionsCache;
}
