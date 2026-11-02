// Builds the app's card data from a wiki export (data/raw/wiki-export.json).
//
//   npm run data [-- path/to/export.json]
//
// Outputs:
//   src/data/cards.json      card list, sets and boxes (bundled into the client)
//   src/data/kingdoms.json   recommended kingdoms (bundled)
//   public/data/faq.json     per-card FAQ sections (served as a static asset, fetched lazily)
//   public/data/rules.json   rules reference pages (static asset)
//   data/generated/report.txt  warnings to review after each refresh

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Box, Card, CardData, CardKind, Cost, Edition, FaqSection, RecommendedKingdom, RulesPage, SetInfo,
} from "../src/shared/types";
import {
  EXCLUDED_SETS, FIRST_EDITION_BOX, KINGDOM_FIXES, RULES_PAGE_SKIP_HEADINGS, SETS, SPLIT_PILES,
} from "./supplement";
import {
  extractTables, parseBullets, parseInfobox, setCurrentPage, splitSections, unknownTemplates, wikiToMarkup,
} from "./wikitext";

interface ExportPage { title: string; redirectFrom: string | null; categories: string[]; wikitext: string }
interface Export { source: string; fetched: string; pages: Record<string, ExportPage> }

const exportPath = process.argv[2] ?? "data/raw/wiki-export.json";
const exp: Export = JSON.parse(readFileSync(exportPath, "utf8"));
const pages = Object.values(exp.pages);
const warnings: string[] = [];
const warn = (msg: string) => warnings.push(msg);

export const slug = (s: string) =>
  s.toLowerCase().replace(/['’]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const KIND_BY_PURPOSE: Record<string, CardKind> = {
  "Kingdom Pile": "kingdom",
  "Mixed Pile Card": "pileMember",
  "Non-Supply": "nonSupply",
  Basic: "basic",
  Landscape: "landscape",
  Status: "status",
};

const setByWikiName = new Map(SETS.map((s) => [s.wikiName, s]));
const promoBoxes: Box[] = [];

// ---------------------------------------------------------------------------
// Cards

function parseCost(f: Record<string, string>, kind: CardKind): Cost | null {
  const coinRaw = (f.cost ?? "").replace(/[^0-9]/g, "");
  const debt = Number((f.cost2 ?? "").replace(/[^0-9]/g, "") || 0);
  const potion = /P/i.test(f.cost3 ?? "");
  if (!coinRaw && !debt && !potion && (kind === "landscape" || kind === "status")) return null;
  const cost: Cost = { coin: Number(coinRaw || 0), debt, potion };
  const extra = (f.cost_extra ?? "").trim() || (/[*+]$/.test(f.cost ?? "") ? f.cost!.trim().slice(-1) : "");
  if (extra === "*" || extra === "+") cost.extra = extra;
  return cost;
}

function boxesFor(name: string, set: (typeof SETS)[number], editionField: string): string[] {
  if (set.id === "promo") return []; // assigned after split piles are known
  if (set.boxes.length === 1) return [set.boxes[0]!.id];
  const eds = editionField.split("&").map((e) => Number(e.trim())).filter(Boolean) as Edition[];
  if (!eds.length) warn(`${name}: no edition field; assuming both editions`);
  const out: string[] = [];
  for (const ed of eds.length ? eds : [1, 2]) {
    if (set.id === "cornucopia-guilds" && ed === 1) {
      const box = FIRST_EDITION_BOX[name];
      if (box) out.push(box);
      else warn(`${name}: 1st-edition Cornucopia & Guilds card not assigned to Cornucopia or Guilds`);
      continue;
    }
    const box = set.boxes.find((b) => b.edition === ed);
    if (box) out.push(box.id);
    else warn(`${name}: edition ${ed} has no box for ${set.name}`);
  }
  return out;
}

const cards: Card[] = [];
const cardPages = new Map<string, ExportPage>(); // card id -> page

for (const page of pages) {
  if (/^\w+:/.test(page.title)) continue; // Template:, File:, ...
  const info = parseInfobox(page.wikitext);
  if (!info || (info.kind !== "Card" && info.kind !== "Landscape")) continue;
  const f = info.fields;
  if (EXCLUDED_SETS.has(f.set ?? "")) continue;
  const set = setByWikiName.get(f.set ?? "");
  if (!set) { warn(`${page.title}: unknown set "${f.set}"`); continue; }
  const kind = KIND_BY_PURPOSE[f.purpose ?? ""];
  if (!kind) { warn(`${page.title}: unknown purpose "${f.purpose}"`); continue; }

  const name = wikiToMarkup(f.name ?? page.title);
  const card: Card = {
    id: slug(name),
    name,
    set: set.id,
    boxes: boxesFor(name, set, f.edition ?? ""),
    kind,
    types: (f.types ?? "").split("-").map((t) => t.trim()).filter(Boolean),
    cost: parseCost(f, kind),
    text: wikiToMarkup(f.text ?? ""),
    wikiTitle: page.title,
  };
  if (f.text2) card.text2 = wikiToMarkup(f.text2);
  const qty = parseInt(f.quantity ?? "", 10);
  if (!Number.isNaN(qty) && qty > 0) card.quantity = qty;
  if (f.illustrator) card.illustrator = wikiToMarkup(f.illustrator);
  if (f.image) card.image = f.image.trim();
  if (cards.some((c) => c.id === card.id)) { warn(`duplicate card id ${card.id} (${page.title})`); continue; }
  cards.push(card);
  cardPages.set(card.id, page);
}

const byName = new Map<string, Card>();
for (const c of cards) {
  byName.set(c.name.toLowerCase(), c);
  byName.set(c.wikiTitle.toLowerCase(), c);
}
for (const p of pages) {
  if (p.redirectFrom) { const c = byName.get(p.title.toLowerCase()); if (c) byName.set(p.redirectFrom.toLowerCase(), c); }
}
const findCard = (name: string) => byName.get(name.trim().toLowerCase());

// Split piles: attach members, synthesizing the Kingdom pile where the wiki has no page for it.
for (const sp of SPLIT_PILES) {
  const members = sp.members.map((m) => {
    const c = findCard(m);
    if (!c) throw new Error(`split pile ${sp.pile}: member "${m}" not found`);
    return c;
  });
  let pile = findCard(sp.pile);
  if (!pile) {
    const top = members[0]!;
    pile = {
      id: slug(sp.pile),
      name: sp.pile,
      set: top.set,
      boxes: [...top.boxes],
      kind: "kingdom",
      types: [...top.types],
      cost: top.cost ? { ...top.cost } : null,
      text: `Split pile: ${members.map((m) => `${m.quantity ?? 5} {card:${m.name}}`).join(", ")}, in that order.`,
      wikiTitle: "Split pile",
    };
    cards.push(pile);
    byName.set(pile.name.toLowerCase(), pile);
  }
  pile.pile = { members: members.map((m) => m.id), shuffled: sp.shuffled };
  for (const m of members) m.pileId = pile.id;
}
for (const c of cards) if (c.kind === "pileMember" && !c.pileId) warn(`${c.name}: pile member without a pile`);

// Promos: one box per Kingdom pile; members and related cards inherit it.
for (const c of cards.filter((c) => c.set === "promo")) {
  if (c.kind === "pileMember") continue;
  const box: Box = { id: `promo-${c.id}`, set: "promo", name: `${c.name} (Promo)`, edition: null, released: "2009-01" };
  promoBoxes.push(box);
  c.boxes = [box.id];
  for (const id of c.pile?.members ?? []) cards.find((m) => m.id === id)!.boxes = [box.id];
}
for (const c of cards) if (!c.boxes.length) warn(`${c.name}: belongs to no box`);

// ---------------------------------------------------------------------------
// FAQ

const FAQ_LEVEL2 = /^(FAQ|Official FAQ|Unofficial FAQ|Additional rules|Rules|Preparation|Setup)$/i;
const faq: Record<string, FaqSection[]> = {};

for (const [id, page] of cardPages) {
  const sections = splitSections(page.wikitext);
  const out: FaqSection[] = [];
  let inFaq = false;
  for (const s of sections) {
    if (s.level === 2) inFaq = FAQ_LEVEL2.test(s.heading);
    if (!inFaq || s.level === 0) continue;
    const { rest, boxes } = extractTables(s.body);
    const items = parseBullets(rest);
    if (items.length) out.push({ heading: s.level === 2 && /^FAQ$/i.test(s.heading) ? "FAQ" : s.heading, items });
    for (const b of boxes) {
      const boxItems = parseBullets(b.body);
      if (boxItems.length) out.push({ heading: b.heading, items: boxItems, deprecated: /deprecated/i.test(b.heading) || undefined });
    }
  }
  if (out.length) faq[id] = out;
}
for (const c of cards) if (!faq[c.id] && c.kind !== "pileMember") warn(`${c.name}: no FAQ on the wiki`);

// ---------------------------------------------------------------------------
// Rules reference

const isKingdomPage = (t: string) => t.startsWith("Recommended Kingdoms");
const rules: RulesPage[] = [];
for (const page of pages) {
  if (cardPages.has(slug(page.title)) || isKingdomPage(page.title)) continue;
  if ([...cardPages.values()].includes(page)) continue;
  if (/^(Arcana)$/.test(page.title) || /^\w+:/.test(page.title)) continue;
  setCurrentPage(page.title);
  const out: RulesPage = { id: slug(page.title), title: page.title, sections: [] };
  let skipBelow = 0;
  for (const s of splitSections(page.wikitext)) {
    if (skipBelow && s.level > skipBelow) continue;
    skipBelow = 0;
    if (s.level > 0 && RULES_PAGE_SKIP_HEADINGS.test(s.heading)) { skipBelow = s.level; continue; }
    const { rest, boxes } = extractTables(s.body);
    const body = wikiToMarkup(rest);
    if (body) out.sections.push({ heading: s.level === 0 ? "Overview" : s.heading, body });
    for (const b of boxes) out.sections.push({ heading: b.heading, body: wikiToMarkup(b.body) });
  }
  if (out.sections.length) rules.push(out);
}

// ---------------------------------------------------------------------------
// Recommended kingdoms

const setNames = SETS.flatMap((s) => [
  [s.wikiName, s.id],
  ...(s.id === "cornucopia-guilds" ? [["Cornucopia", s.id], ["Guilds", s.id]] : []),
] as [string, string][]).sort((a, b) => b[0].length - a[0].length);

function headingEditions(heading: string): Record<string, Edition> {
  const out: Record<string, Edition> = {};
  let rest = heading;
  for (const [name, id] of setNames) {
    const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&")}(?: \\(expansion\\))?\\s*([12])E`);
    const m = re.exec(rest);
    if (m) { out[id] = Number(m[1]) as Edition; rest = rest.replace(m[0], ""); }
  }
  return out;
}

const LANDSCAPE_PARAMS = /^(event|landmark|project|way|trait)\d*$|^(ally|prophecy)$/;
const editionKey = (e: Record<string, Edition>) =>
  Object.entries(e).sort().map(([s, n]) => `${s}:${n}`).join(",");

// Each kingdom is listed on the page of every set it uses, and copies sometimes disagree
// (typos, a stray extra card). Collect every copy, then keep the cleanest one per kingdom.
interface Candidate { rk: RecommendedKingdom; problems: string[]; order: number }
const candidates = new Map<string, Candidate[]>();
let order = 0;

for (const page of pages.filter((p) => isKingdomPage(p.title))) {
  const source = page.title.includes("Donald X") ? "donald-x" : "rulebook";
  // Only the rulebook kingdoms: tournament and community sets are left out.
  if (page.title.includes("Designed by") || page.title === "Recommended Kingdoms") continue;
  for (const s of splitSections(page.wikitext)) {
    if (/trivia|occurrences/i.test(s.heading)) continue;
    for (const m of s.body.matchAll(/\{\{Kingdom\|([^{}]*)\}\}/g)) {
      const params = m[1]!.split("|").map((p) => p.trim());
      const named: Record<string, string> = {};
      const positional: string[] = [];
      for (const p of params) {
        const kv = /^(\w+)\s*=\s*(.*)$/.exec(p);
        if (kv) named[kv[1]!] = kv[2]!; else if (p) positional.push(p);
      }
      const title = wikiToMarkup(named.title ?? "Untitled");
      const editions = headingEditions(s.heading);
      const fix = KINGDOM_FIXES.find((f) => f.title === title && f.editions === editionKey(editions));
      const problems: string[] = [];
      const resolve = (n: string, ctx: string) => {
        const c = findCard(n);
        if (!c) problems.push(`unknown ${ctx} "${n}"`);
        return c;
      };
      const kingdom = positional
        .filter((n) => !fix?.remove?.includes(n))
        .filter((n) => !(/_/.test(n) && !findCard(n))) // stray anchor ids like "Collider_1E1E"
        .map((n) => resolve(n, "card"))
        .filter((c): c is Card => !!c);
      if (new Set(kingdom).size !== kingdom.length) problems.push("duplicate card");
      const landscapes: Card[] = [];
      const choices: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(named)) {
        if (!v || ["title", "id", "imgwidth", "colony", "shelters"].includes(k)) continue;
        if (LANDSCAPE_PARAMS.test(k)) { const c = resolve(v, k); if (c) landscapes.push(c); continue; }
        if (/^dboon\d$/.test(k)) { const c = resolve(v, k); if (c) ((choices.druidBoons ??= []) as string[]).push(c.id); continue; }
        const c = resolve(v, k);
        if (!c) continue;
        const key = { bane: "bane", ferryman: "ferryman", riverboat: "riverboat", mouse: "wayOfTheMouse",
          appr_army: "approachingArmy", traitfor: "traitFor1", traitfor1: "traitFor1" }[k];
        if (key) choices[key] = c.id; else problems.push(`unhandled parameter ${k}=${v}`);
      }
      const ids = [...new Set(kingdom.map((c) => c.id))];
      if (ids.length !== 10) problems.push(`${ids.length} Kingdom piles`);
      const rk: RecommendedKingdom = {
        id: "", name: title, source, group: s.heading,
        sets: [...new Set([...kingdom, ...landscapes].map((c) => c.set))], editions,
        kingdom: ids, landscapes: landscapes.map((c) => c.id),
        colony: named.colony === "1", shelters: named.shelters === "1", choices,
      };
      // Donald X.'s tournament kingdoms are on one page and reuse titles across events.
      const groupKey = source === "donald-x" ? `donald-x|${order}` : `${source}|${title}|${editionKey(editions)}`;
      const list = candidates.get(groupKey) ?? [];
      list.push({ rk, problems, order: order++ });
      candidates.set(groupKey, list);
    }
  }
}

const kingdoms: RecommendedKingdom[] = [];
const contentKey = (k: RecommendedKingdom) => [...k.kingdom].sort().join(",") + "|" + [...k.landscapes].sort().join(",");
for (const list of candidates.values()) {
  const best = [...list].sort((a, b) => a.problems.length - b.problems.length || a.order - b.order)[0]!;
  for (const p of best.problems) warn(`kingdom "${best.rk.name}" (${best.rk.group}): ${p}`);
  const distinct = new Set(list.filter((c) => !c.problems.length).map((c) => contentKey(c.rk)));
  if (distinct.size > 1) warn(`kingdom "${best.rk.name}" (${best.rk.group}): wiki copies disagree; kept the first`);
  // The same kingdom can appear under headings with and without explicit editions.
  if (kingdoms.some((k) => k.source === best.rk.source && contentKey(k) === contentKey(best.rk))) continue;
  const rk = best.rk;
  let id = slug(rk.name);
  if (kingdoms.some((k) => k.id === id)) id = `${id}-${Object.values(rk.editions).includes(1) ? "1e" : "2e"}`;
  while (kingdoms.some((k) => k.id === id)) id += "-x";
  rk.id = id;
  kingdoms.push(rk);
}

// ---------------------------------------------------------------------------
// Output

const boxes: Box[] = [
  ...SETS.flatMap((s) => s.boxes.map((b) => ({ ...b, set: s.id }))),
  ...promoBoxes,
];
const sets: SetInfo[] = SETS.map((s) => ({
  id: s.id, name: s.name, boxes: boxes.filter((b) => b.set === s.id).map((b) => b.id),
}));
cards.sort((a, b) => a.name.localeCompare(b.name));

// Setup notes: "* {card:Name} — instruction" and "* Doom cards — instruction" bullets on the Setup page.
const setupNotes: Record<string, string> = {};
const setupPage = exp.pages["Setup"];
if (!setupPage) warn("no Setup page in export");
for (const s of splitSections(setupPage?.wikitext ?? "")) {
  for (const item of parseBullets(s.body)) {
    const m = /^\*?\{card:([^}|]+)[^}]*\}\*?\s*—\s*(.*)$/s.exec(item.text) ?? /^([A-Z][\w ]+?) (?:cards|pile) —\s*(.*)$/s.exec(item.text);
    if (!m) continue;
    const card = findCard(m[1]!);
    setupNotes[card ? card.id : m[1]!.trim()] = m[2]!.trim();
  }
}

const data: CardData = { generated: exp.fetched, source: exp.source, boxes, sets, cards, setupNotes };

function write(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
}
write("src/data/cards.json", data);
write("src/data/kingdoms.json", kingdoms);
write("public/data/faq.json", faq);
write("public/data/rules.json", rules);

const counts = Object.entries(
  cards.reduce<Record<string, number>>((acc, c) => ((acc[c.kind] = (acc[c.kind] ?? 0) + 1), acc), {}),
).map(([k, n]) => `${k}: ${n}`).join(", ");
// The app's own rules (data/rules/cards) are hand-written; list cards that don't have one yet.
const ownRules = new Set(existsSync("data/rules/cards") ? readdirSync("data/rules/cards").map((f) => f.replace(/\.md$/, "")) : []);
const noOwnRules = cards.filter((c) => !ownRules.has(c.id)).map((c) => c.name);

const report = [
  `Export: ${exportPath} (fetched ${exp.fetched})`,
  `Cards: ${cards.length} (${counts})`,
  `FAQ entries: ${Object.keys(faq).length}`,
  `Rules pages: ${rules.length}`,
  `App rules (data/rules/cards): ${cards.length - noOwnRules.length} of ${cards.length} cards${noOwnRules.length ? ` — missing: ${noOwnRules.join(", ")}` : ""}`,
  `Recommended kingdoms: ${kingdoms.length} (${kingdoms.filter((k) => k.source === "rulebook").length} rulebook)`,
  "",
  `Unknown templates (rendered as their first parameter): ${[...unknownTemplates].map(([k, n]) => `${k}×${n}`).join(", ") || "none"}`,
  "",
  `Warnings (${warnings.length}):`,
  ...warnings.map((w) => `  ${w}`),
].join("\n");
write("data/generated/report.txt", report + "\n");
console.log(report.split("\n").slice(0, 6).join("\n") + `\nWarnings: ${warnings.length} (see data/generated/report.txt)`);
