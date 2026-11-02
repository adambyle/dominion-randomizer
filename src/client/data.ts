import { useEffect, useState } from "react";
import cardsJson from "../data/cards.json";
import kingdomsJson from "../data/kingdoms.json";
import type { Card, CardData, FaqSection, RecommendedKingdom, RulesPage } from "../shared/types";
import { createDb } from "../shared/setup";

export const data = cardsJson as unknown as CardData;
export const db = createDb(data);
export const recommended = kingdomsJson as unknown as RecommendedKingdom[];

const byName = new Map<string, Card>();
for (const c of data.cards) {
  byName.set(c.name.toLowerCase(), c);
  byName.set(c.wikiTitle.toLowerCase(), c);
}
export const cardByName = (name: string) => byName.get(name.toLowerCase());

export const setName = (id: string) => data.sets.find((s) => s.id === id)?.name ?? id;
export const boxName = (id: string) => data.boxes.find((b) => b.id === id)?.name ?? id;

export const wikiUrl = (title: string) =>
  `https://wiki.dominionstrategy.com/index.php/${encodeURIComponent(title.replace(/ /g, "_"))}`;

// FAQ and rules text are large, so they're fetched on first use.
let faqPromise: Promise<Record<string, FaqSection[]>> | null = null;
export function loadFaq() {
  faqPromise ??= fetch("/data/faq.json").then((r) => r.json());
  return faqPromise;
}
let rulesPromise: Promise<RulesPage[]> | null = null;
export function loadRules() {
  rulesPromise ??= fetch("/data/rules.json").then((r) => r.json());
  return rulesPromise;
}

export function useFaq(id: string | null): FaqSection[] | null | undefined {
  const [faq, setFaq] = useState<FaqSection[] | null | undefined>(undefined);
  useEffect(() => {
    if (!id) return;
    let live = true;
    setFaq(undefined);
    loadFaq().then((all) => live && setFaq(all[id] ?? null)).catch(() => live && setFaq(null));
    return () => { live = false; };
  }, [id]);
  return faq;
}

/** Sort key used for Kingdom displays: cost, then name. */
export function costSort(a: Card, b: Card) {
  const ca = a.cost, cb = b.cost;
  const va = ca ? ca.coin + ca.debt * 0.9 + (ca.potion ? 0.5 : 0) : 99;
  const vb = cb ? cb.coin + cb.debt * 0.9 + (cb.potion ? 0.5 : 0) : 99;
  return va - vb || a.name.localeCompare(b.name);
}
