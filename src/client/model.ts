// Turns a SetupResult into what's laid out on the table: the Supply column, the Kingdom, the
// landscapes, the "off to the side" tray grouped by the card that needs it, and a checklist of
// things to hand out. Every item knows which table cards it ultimately comes from, so hovering a
// pile can light up everything it brings.

import type { Reason, RerollKey, SetupResult } from "../shared/setup";
import { byCost, db, name } from "./data";

export interface TableItem {
  /** Card id shown (for Ruins/Loot, a representative member). */
  card: string;
  label?: string;
  count?: number;
  /** Small caption under the card ("Bane", "×9 shuffled"). */
  note?: string;
  /** Table cards (Kingdom piles / landscapes) this item exists because of. */
  roots: string[];
  /** Set when the item is a random pick the user can ask to have picked again. */
  reroll?: Reroll;
}

export interface Reroll { key: RerollKey; label: string }

const REROLL_LABELS: Record<string, string> = {
  bane: "Swap the Bane", ferryman: "Swap Ferryman's pile", riverboat: "Swap the Riverboat card", wayOfTheMouse: "Swap the Way of the Mouse card",
  approachingArmy: "Swap Approaching Army's pile", obelisk: "Move Obelisk to another pile", ally: "Swap the Ally", prophecy: "Swap the Prophecy",
  blackMarket: "Draw a new Black Market deck", druidBoons: "Draw new Boons",
};
const reroll = (key: RerollKey): Reroll => ({ key, label: key.startsWith("trait:") ? "Move to another pile" : REROLL_LABELS[key]! });

/** The Kingdom cards that make a pick, and what they pick. */
const PICKERS: Record<string, RerollKey> = {
  "young-witch": "bane", ferryman: "ferryman", riverboat: "riverboat", "way-of-the-mouse": "wayOfTheMouse", "approaching-army": "approachingArmy",
  obelisk: "obelisk", "black-market": "blackMarket", druid: "druidBoons",
};

/** Every re-pickable choice that concerns a card: the pick itself (a Bane, an Ally ...) or the card that made it (Young Witch, a Liaison, a Trait ...). */
export function choiceRerolls(setup: SetupResult, id: string): Reroll[] {
  const c = setup.choices;
  const keys = new Set<RerollKey>();
  const asPick: [RerollKey, unknown][] = [["bane", c.bane], ["ferryman", c.ferryman], ["riverboat", c.riverboat], ["wayOfTheMouse", c.wayOfTheMouse],
    ["approachingArmy", c.approachingArmy], ["ally", c.ally], ["prophecy", c.prophecy]];
  for (const [key, value] of asPick) if (value === id) keys.add(key);
  const picker = PICKERS[id];
  if (picker && !picker.startsWith("trait:") && (c as Record<string, unknown>)[picker] !== undefined) keys.add(picker);
  const types = db.get(id).types;
  if (c.ally && types.includes("Liaison")) keys.add("ally");
  if (c.prophecy && types.includes("Omen")) keys.add("prophecy");
  if (c.traits?.[id]) keys.add(`trait:${id}`);
  return [...keys].map(reroll);
}

export interface TrayGroup {
  key: string;
  /** The card that needs these, or null for general rules. */
  by: string | null;
  what: string;
  items: TableItem[];
  roots: string[];
}

export interface CheckItem {
  key: string;
  title: string;
  detail: string;
  roots: string[];
}

export interface TableModel {
  supply: TableItem[];
  kingdom: string[];
  extraKingdom: TableItem[];
  landscapes: TableItem[];
  tray: TrayGroup[];
  checklist: CheckItem[];
  /** Pile/landscape id -> Trait/Obelisk ids pointing at it. */
  targetedBy: Map<string, string[]>;
  /** Kingdom pile id -> number of cards in it for this player count. */
  pileCounts: Map<string, number>;
}

/** The Supply column of an empty table. */
export const BASICS_PREVIEW = ["copper", "silver", "gold", "estate", "duchy", "province", "curse"];

const VISIBLE_BASICS = ["copper", "silver", "gold", "platinum", "estate", "duchy", "province", "colony", "curse", "potion", "ruins"];

export function buildModel(setup: SetupResult, kingdom: string[], landscapes: string[]): TableModel {
  const onTable = new Set([...kingdom, ...landscapes]);

  // Who caused what: card id -> the cards named in its reasons.
  const causes = new Map<string, Set<string>>();
  const note = (id: string, reasons: Reason[]) => {
    const set = causes.get(id) ?? new Set<string>();
    for (const r of reasons) if (r.by) set.add(r.by);
    causes.set(id, set);
  };
  for (const p of [...setup.extraKingdom, ...setup.nonSupply, ...setup.basic]) note(p.id, p.reasons);
  for (const s of [...setup.statuses, ...setup.landscapes]) note(s.id, s.reasons);
  for (const d of setup.decks) for (const c of d.cards) note(c, d.reasons);
  for (const s of setup.setAside) for (const c of s.cards) note(c, s.reasons);
  for (const c of setup.startingDeck.cards) {
    const by = setup.startingDeck.reasons.find((r) => r.text.endsWith(`with ${name(c.id)}`))?.by;
    if (by) note(c.id, [{ by, text: "Heirloom" }]);
  }

  const rootCache = new Map<string, string[]>();
  const rootsOf = (id: string, seen = new Set<string>()): string[] => {
    if (onTable.has(id)) return [id];
    if (rootCache.has(id)) return rootCache.get(id)!;
    if (seen.has(id)) return [];
    seen.add(id);
    const out = new Set<string>();
    for (const by of causes.get(id) ?? []) for (const r of rootsOf(by, seen)) out.add(r);
    const list = [...out];
    rootCache.set(id, list);
    return list;
  };
  const rootsOfReasons = (reasons: Reason[]) => [...new Set(reasons.flatMap((r) => (r.by ? rootsOf(r.by) : [])))];

  // Supply column.
  const supply: TableItem[] = [];
  for (const id of VISIBLE_BASICS) {
    const p = setup.basic.find((b) => b.id === id);
    if (!p) continue;
    supply.push({ card: p.members?.[0]?.id ?? p.id, label: id === "ruins" ? "Ruins" : undefined, count: p.count, roots: rootsOfReasons(p.reasons) });
  }

  // Trait / Obelisk targets.
  const targetedBy = new Map<string, string[]>();
  for (const [by, pile] of Object.entries(setup.targets)) targetedBy.set(pile, [...(targetedBy.get(pile) ?? []), by]);

  const extraKingdom: TableItem[] = setup.extraKingdom.map((p) => ({
    card: p.id, count: p.count, roots: rootsOfReasons(p.reasons),
    reroll: p.reasons[0]?.by === "young-witch" ? reroll("bane") : p.reasons[0]?.by === "approaching-army" ? reroll("approachingArmy") : undefined,
    note: p.reasons[0]?.by === "young-witch" ? "Bane" : p.reasons[0]?.by ? `for ${name(p.reasons[0].by)}` : undefined,
  }));

  // Allies and Prophecies name every card that needs them: "for Liaison: Broker, Bauble".
  const inGame = [...kingdom, ...setup.extraKingdom.map((p) => p.id), ...setup.setAside.flatMap((s) => s.cards)];
  const neededBy = (type: string) => {
    const cards = [...new Set(inGame.filter((id) => db.get(id).types.includes(type) || db.get(id).pile?.members.some((m) => db.get(m).types.includes(type))))];
    return cards.length ? `for ${type}: ${cards.map(name).join(", ")}` : undefined;
  };
  const landscapeItems: TableItem[] = [
    ...landscapes.map((id) => ({ card: id, roots: [id] })),
    ...setup.landscapes.filter((l) => !landscapes.includes(l.id)).map((l) => ({
      card: l.id, roots: rootsOfReasons(l.reasons),
      reroll: db.get(l.id).types.includes("Ally") ? reroll("ally") : db.get(l.id).types.includes("Prophecy") ? reroll("prophecy") : undefined,
      note: db.get(l.id).types.includes("Ally") ? neededBy("Liaison") : db.get(l.id).types.includes("Prophecy") ? neededBy("Omen")
        : l.reasons[0]?.by ? `for ${name(l.reasons[0].by)}` : undefined,
    })),
  ];
  const pileCounts = new Map([...setup.kingdom, ...setup.extraKingdom].map((p) => [p.id, p.count]));

  // The tray, grouped by the card that needs each thing.
  const groups = new Map<string, TrayGroup>();
  const whats = new Map<string, string[]>();
  const add = (cause: string | null, what: string, item: TableItem) => {
    // Group under the card on the table the chain starts from ("Cemetery · via Haunted Mirror").
    let by = cause;
    if (cause && !onTable.has(cause)) {
      const root = rootsOf(cause)[0];
      if (root) { by = root; what = what === "not in the Supply" ? `via ${name(cause)}` : `${what} via ${name(cause)}`; }
    }
    const key = by ?? "rules";
    const g = groups.get(key) ?? { key, by, what: "", items: [], roots: [] };
    const labels = whats.get(key) ?? [];
    if (!labels.includes(what)) labels.push(what);
    whats.set(key, labels);
    g.what = labels.join(" · ");
    if (!g.items.some((i) => i.card === item.card)) g.items.push(item);
    g.roots = [...new Set([...g.roots, ...item.roots, ...(by && onTable.has(by) ? [by] : [])])];
    groups.set(key, g);
  };
  const whatFor = (text: string) => text.replace(/^refers to .*/, "").replace(/^uses (\w+)s$/, "$1s");

  for (const s of setup.setAside) {
    const by = s.reasons[0]?.by ?? s.id;
    const what = s.id === "black-market" ? `Black Market deck · ${s.cards.length}` : s.id === "ferryman" ? "pile, set aside"
      : s.id === "druid" ? "set aside face up" : "set aside";
    const cards = s.id === "black-market" ? s.cards.slice(0, 1) : s.cards;
    const key = ({ ferryman: "ferryman", riverboat: "riverboat", "way-of-the-mouse": "wayOfTheMouse", "black-market": "blackMarket", druid: "druidBoons" } as const)[s.id as "ferryman"];
    cards.forEach((c, i) => add(by, what, { card: c, roots: rootsOf(c), reroll: key && i === 0 ? reroll(key) : undefined,
      note: s.id === "black-market" ? `${s.cards.length} cards` : undefined }));
  }
  for (const c of setup.startingDeck.cards) {
    const by = [...(causes.get(c.id) ?? [])][0];
    if (by) add(by, "Heirloom, replaces a Copper", { card: c.id, roots: rootsOf(c.id), note: "1 each" });
  }
  for (const d of setup.decks) {
    const by = d.reasons[0]?.by ?? null;
    add(by, d.id === "boons" ? `Boons deck · ${d.cards.length}` : `Hexes deck · ${d.cards.length}`,
      { card: d.cards[0]!, roots: rootsOfReasons(d.reasons), note: `${d.cards.length}, shuffled` });
  }
  for (const p of setup.nonSupply) {
    const r = p.reasons[0];
    const card = p.members?.[0]?.id ?? p.id;
    add(r?.by ?? null, p.id === "loot" ? "Loot pile" : whatFor(r?.text ?? "") || "not in the Supply",
      { card, label: p.id === "loot" ? "Loot" : undefined, count: p.count, roots: rootsOfReasons(p.reasons) });
  }
  for (const s of setup.statuses) {
    const r = s.reasons[0];
    const type = db.get(s.id).types[0] ?? "";
    add(r?.by ?? null, type === "Artifact" ? "Artifacts" : "States", { card: s.id, roots: rootsOfReasons(s.reasons) });
  }
  for (const z of setup.trash) add("necromancer", "in the trash", { card: z.id, roots: ["necromancer"].filter((x) => onTable.has(x)) });

  // Checklist of things to hand out or do before the first turn.
  const checklist: CheckItem[] = [];
  const deck = setup.startingDeck.cards.map((c) => `${c.count} ${name(c.id)}`).join(", ");
  checklist.push({ key: "deck", title: "Each player", detail: deck, roots: rootsOfReasons(setup.startingDeck.reasons) });
  const extras = [setup.playerStart.coffers && `${setup.playerStart.coffers} Coffers`, setup.playerStart.favors && `${setup.playerStart.favors} Favor${setup.playerStart.favors > 1 ? "s" : ""}`].filter(Boolean);
  if (extras.length) checklist.push({ key: "start", title: "Each player also takes", detail: extras.join(", "), roots: rootsOfReasons(setup.playerStart.reasons) });
  if (setup.tokens.length) {
    checklist.push({ key: "tokens", title: "Tokens and mats", detail: setup.tokens.map((t) => (t.label ?? t.id).replace(/ \(.*\)$/, "")).join(", "),
      roots: [...new Set(setup.tokens.flatMap((t) => rootsOfReasons(t.reasons)))] });
  }
  for (const [by, pile] of Object.entries(setup.targets)) {
    checklist.push({ key: `target-${by}`, title: name(by), detail: by === "obelisk" ? `Its pile is ${name(pile)}` : `Applies to ${name(pile)}`, roots: [by, pile] });
  }
  const covered = new Set(["druid", "black-market", "ferryman", "riverboat", "way-of-the-mouse", "young-witch", "approaching-army", "obelisk"]);
  for (const n of setup.notes) {
    if (!n.by || covered.has(n.by) || db.get(n.by).types.some((t) => t === "Trait")) continue;
    checklist.push({ key: `note-${n.by}`, title: name(n.by), detail: n.text, roots: rootsOf(n.by) });
  }

  return {
    supply,
    kingdom: kingdom.map((id) => db.get(id)).sort(byCost).map((c) => c.id),
    extraKingdom,
    landscapes: landscapeItems,
    tray: [...groups.values()],
    checklist,
    targetedBy,
    pileCounts,
  };
}
