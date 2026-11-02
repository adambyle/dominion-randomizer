// Card reference: every card, searchable, opening the card sheet.

import { h, icon, type Child } from "../dom";
import { byCost, cardImage, data } from "../data";
import type { CardKind } from "../../shared/types";
import type { App } from "../main";

const KINDS: { id: CardKind | "all"; label: string }[] = [
  { id: "kingdom", label: "Kingdom" }, { id: "landscape", label: "Landscapes" }, { id: "nonSupply", label: "Non-Supply" },
  { id: "status", label: "Boons, Hexes, States" }, { id: "basic", label: "Basic" }, { id: "pileMember", label: "In split piles" },
  { id: "all", label: "Everything" },
];

let query = "";
let kind: CardKind | "all" = "kingdom";
let set = "all";
let mine = false;

export function cardsView(app: App): Child {
  const enabled = new Set(app.store.state.settings.options.enabledBoxes);
  const grid = h("div.card-grid");
  const count = h("span.muted");

  const update = () => {
    const q = query.trim().toLowerCase();
    const cards = data.cards
      .filter((c) => (kind === "all" || c.kind === kind) && (set === "all" || c.set === set) && (!mine || c.boxes.some((b) => enabled.has(b))))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.types.some((t) => t.toLowerCase().startsWith(q)) || c.text.toLowerCase().includes(q))
      .sort(byCost);
    count.textContent = `${cards.length} cards`;
    grid.replaceChildren(...cards.slice(0, 240).map((c) => {
      const img = cardImage(c.id);
      return h("button.grid-card", { type: "button", class: img && img.w > img.h ? "wide" : "", onclick: () => app.openCard(c.id) },
        img ? h("img", { src: img.src, alt: c.name, loading: "lazy", width: img.w, height: img.h }) : h("span.face-missing", null, c.name));
    }));
    if (cards.length > 240) grid.append(h("p.muted.more", null, "Showing the first 240 — narrow the search to see more."));
  };
  update();

  return h("div.page", null,
    h("div.filters", null,
      h("h1", null, "Cards"),
      h("div.filter-row", null,
        h("label.search", null, icon("search"), h("input#cards-search", { type: "search", placeholder: "Search names, types or text", value: query, autocomplete: "off",
          oninput: (e) => { query = (e.target as HTMLInputElement).value; update(); } })),
        h("select", { "aria-label": "Kind", onchange: (e) => { kind = (e.target as HTMLSelectElement).value as CardKind | "all"; update(); } },
          KINDS.map((k) => h("option", { value: k.id, selected: kind === k.id }, k.label))),
        h("select", { "aria-label": "Expansion", onchange: (e) => { set = (e.target as HTMLSelectElement).value; update(); } },
          h("option", { value: "all" }, "All expansions"), data.sets.map((s) => h("option", { value: s.id, selected: set === s.id }, s.name))),
        h("label.toggle", null, h("input", { type: "checkbox", checked: mine, onchange: (e) => { mine = (e.target as HTMLInputElement).checked; update(); } }), "Only sets I own"),
        count)),
    grid);
}
