// Card reference: every card, searchable, opening the card sheet. A second tab lists the cards with
// a custom weight or a ban, and finds any owned card to tune.

import { h, icon, type Child } from "../dom";
import { byCost, cardImage, data, setName } from "../data";
import type { Card, CardKind } from "../../shared/types";
import { DEFAULT_WEIGHT, isBanned, isTuned, isWeightable, weightOf } from "../../shared/cardPrefs";
import { prefBadge, prefControl } from "./prefs";
import type { App } from "../main";

const KINDS: { id: CardKind | "all"; label: string }[] = [
  { id: "kingdom", label: "Kingdom" }, { id: "landscape", label: "Landscapes" }, { id: "nonSupply", label: "Non-Supply" },
  { id: "status", label: "Boons, Hexes, States" }, { id: "basic", label: "Basic" }, { id: "pileMember", label: "In split piles" },
  { id: "all", label: "Everything" },
];

type Tab = "all" | "tuned";
type Status = "any" | "banned" | "less" | "more";
const STATUSES: { id: Status; label: string }[] = [
  { id: "any", label: "All" }, { id: "banned", label: "Banned" }, { id: "less", label: "Less often" }, { id: "more", label: "More often" },
];

let tab: Tab = "all";
let query = "";
let kind: CardKind | "all" = "kingdom";
let set = "all";
let mine = false;
let tunedQuery = "";
let tunedSet = "all";
let status: Status = "any";

/**
 * Re-rendering patches the elements already on the page (see `morph`), so after the first build a
 * view's own elements may no longer be the live ones: handlers update the live element by id.
 */
function liveElements(): <T extends HTMLElement>(el: T) => T {
  let built = false;
  queueMicrotask(() => { built = true; });
  return <T extends HTMLElement>(el: T) => (built ? (document.getElementById(el.id) as T | null) ?? el : el);
}

const matches = (c: Card, q: string) =>
  !q || c.name.toLowerCase().includes(q) || c.types.some((t) => t.toLowerCase().startsWith(q)) || c.text.toLowerCase().includes(q);

export function cardsView(app: App): Child {
  const title = h("div.history-title", null, h("h1", null, "Cards"),
    h("div.segmented.history-tabs", { role: "tablist", "aria-label": "Card views" },
      ([["all", "All cards"], ["tuned", "Weights & bans"]] as const).map(([t, label]) =>
        h("button", { type: "button", role: "tab", "aria-selected": String(tab === t), class: tab === t ? "on" : "",
          onclick: () => { tab = t; app.render(); } }, label))));
  return tab === "tuned" ? tunedView(app, title) : allView(app, title);
}

function allView(app: App, title: HTMLElement): Child {
  const enabled = new Set(app.store.state.settings.options.enabledBoxes);
  const gridEl = h("div#cards-grid.card-grid");
  const countEl = h("span#cards-count.muted");
  const live = liveElements();

  const update = () => {
    const [grid, count] = [live(gridEl), live(countEl)];
    const q = query.trim().toLowerCase();
    const cards = data.cards
      .filter((c) => (kind === "all" || c.kind === kind) && (set === "all" || c.set === set) && (!mine || c.boxes.some((b) => enabled.has(b))))
      .filter((c) => matches(c, q))
      .sort(byCost);
    count.textContent = `${cards.length} cards`;
    grid.replaceChildren(...cards.slice(0, 240).map((c) => {
      const img = cardImage(c.id);
      const banned = isBanned(app.store.state.settings.cardPrefs, c.id);
      return h("button.grid-card", { type: "button", class: [img && img.w > img.h ? "wide" : "", banned ? "banned" : ""].join(" "), onclick: () => app.openCard(c.id) },
        img ? h("img", { src: img.src, alt: c.name, loading: "lazy", width: img.w, height: img.h }) : h("span.face-missing", null, c.name),
        prefBadge(app, c.id));
    }));
    if (cards.length > 240) grid.append(h("p.muted.more", null, "Showing the first 240 — narrow the search to see more."));
  };
  update();

  return h("div.page", null,
    h("div.filters", null,
      title,
      h("div.filter-row", null,
        h("label.search", null, icon("search"), h("input#cards-search", { type: "search", placeholder: "Search names, types or text", value: query, autocomplete: "off",
          oninput: (e) => { query = (e.target as HTMLInputElement).value; update(); } })),
        h("select", { "aria-label": "Kind", onchange: (e) => { kind = (e.target as HTMLSelectElement).value as CardKind | "all"; update(); } },
          KINDS.map((k) => h("option", { value: k.id, selected: kind === k.id }, k.label))),
        h("select", { "aria-label": "Expansion", onchange: (e) => { set = (e.target as HTMLSelectElement).value; update(); } },
          h("option", { value: "all" }, "All expansions"), data.sets.map((s) => h("option", { value: s.id, selected: set === s.id }, s.name))),
        h("label.toggle", null, h("input", { type: "checkbox", checked: mine, onchange: (e) => { mine = (e.target as HTMLInputElement).checked; update(); } }), "Only sets I own"),
        countEl)),
    gridEl);
}

/** Cards in the sets you own that are dealt less, more or never; searching finds any other owned card to tune. */
function tunedView(app: App, title: HTMLElement): Child {
  const { cardPrefs: prefs, options } = app.store.state.settings;
  const enabled = new Set(options.enabledBoxes);
  const owned = (c: Card) => isWeightable(c) && c.boxes.some((b) => enabled.has(b));
  const listEl = h("ul#prefs-list.pref-list");
  const countEl = h("span#prefs-count.muted");
  const live = liveElements();
  const total = Object.keys(prefs).filter((id) => data.cards.some((c) => c.id === id && owned(c))).length;

  const update = () => {
    const [list, count] = [live(listEl), live(countEl)];
    const q = tunedQuery.trim().toLowerCase();
    const cards = data.cards
      .filter((c) => owned(c) && (tunedSet === "all" || c.set === tunedSet) && matches(c, q))
      // Without a search, only the cards that aren't at the default.
      .filter((c) => (q ? true : isTuned(prefs, c.id)))
      .filter((c) => status === "any" || (status === "banned" ? isBanned(prefs, c.id)
        : isTuned(prefs, c.id) && !isBanned(prefs, c.id) && (status === "less" ? weightOf(prefs, c.id) < DEFAULT_WEIGHT : weightOf(prefs, c.id) > DEFAULT_WEIGHT)))
      .sort((a, b) => a.set.localeCompare(b.set) || byCost(a, b));
    count.textContent = q ? `${cards.length} matching cards` : `${cards.length} tuned cards`;
    list.replaceChildren(...cards.slice(0, 120).map((c) => {
      const img = cardImage(c.id);
      return h("li.pref-row", { class: isBanned(prefs, c.id) ? "banned" : "" },
        h("button.pref-card", { type: "button", onclick: () => app.openCard(c.id), title: "Open the card" },
          img ? h("img", { src: img.src, alt: "", loading: "lazy" }) : null,
          h("span.pref-name", null, h("b", null, c.name), h("span.muted", null, setName(c.set)))),
        prefControl(app, c.id));
    }));
    if (cards.length > 120) list.append(h("li.muted.more", null, "Showing the first 120 — narrow the search to see more."));
    if (!cards.length) {
      list.append(h("li.empty-note", null, q ? "No owned cards match." : total
        ? "No cards match this filter."
        : "Nothing tuned yet. Search above for a card, or open any card and set its weight or ban it."));
    }
  };
  update();

  return h("div.page", null,
    h("div.filters", null,
      title,
      h("div.filter-row", null,
        h("label.search", null, icon("search"), h("input#prefs-search", { type: "search", placeholder: "Find a card to weight or ban", value: tunedQuery, autocomplete: "off",
          oninput: (e) => { tunedQuery = (e.target as HTMLInputElement).value; update(); } })),
        h("select", { "aria-label": "Expansion", onchange: (e) => { tunedSet = (e.target as HTMLSelectElement).value; update(); } },
          h("option", { value: "all" }, "All my expansions"),
          data.sets.filter((s) => s.boxes.some((b) => enabled.has(b))).map((s) => h("option", { value: s.id, selected: tunedSet === s.id }, s.name))),
        h("div.segmented.small", { role: "radiogroup", "aria-label": "Show" }, STATUSES.map((s) => h("button", {
          type: "button", role: "radio", "aria-checked": String(status === s.id), class: status === s.id ? "on" : "",
          onclick: () => { status = s.id; app.render(); } }, s.label))),
        countEl,
        total > 0 && h("button.btn.ghost", { type: "button", onclick: () => { if (confirm("Put every card back to the default weight?")) app.store.dispatch({ type: "resetCardPrefs" }); } }, "Reset all")),
      h("p.hint", null, "Weight 3 is normal; 1 is rare and 5 is much more likely. Banned cards are never dealt or picked at random, but you can still add them by hand. Only cards from sets you own are listed.")),
    listEl);
}
