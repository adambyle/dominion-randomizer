// Recommended kingdoms from the rulebooks, as small table previews.

import { h, type Child } from "../dom";
import { artImage, byCost, data, db, setIcon, setName } from "../data";
import type { RecommendedKingdom } from "../../shared/types";
import type { App } from "../main";

let setFilter = "all";
let onlyMine = true;
let firstEdition = false;

const playable = (k: RecommendedKingdom, enabled: Set<string>) =>
  [...k.kingdom, ...k.landscapes].every((id) => db.get(id).boxes.some((b) => enabled.has(b)));

export function recommendedView(app: App): Child {
  const enabled = new Set(app.store.state.settings.options.enabledBoxes);
  const list = app.recommended.filter((k) => (setFilter === "all" || k.sets.includes(setFilter))
    && (firstEdition || !Object.values(k.editions).includes(1))
    && (!onlyMine || playable(k, enabled)));
  const groups = new Map<string, RecommendedKingdom[]>();
  for (const k of list) groups.set(k.group, [...(groups.get(k.group) ?? []), k]);
  const rerender = () => app.render();

  const tile = (id: string) => {
    const art = artImage(id);
    return h("span.rk-tile", { title: db.get(id).name }, art ? h("img", { src: art.src, alt: db.get(id).name, loading: "lazy" }) : db.get(id).name);
  };

  return h("div.page", null,
    h("div.filters", null,
      h("h1", null, "Recommended kingdoms"),
      h("div.filter-row", null,
        h("select", { "aria-label": "Expansion", onchange: (e) => { setFilter = (e.target as HTMLSelectElement).value; rerender(); } },
          h("option", { value: "all", selected: setFilter === "all" }, "All expansions"),
          data.sets.filter((s) => s.id !== "promo").map((s) => h("option", { value: s.id, selected: setFilter === s.id }, s.name))),
        h("label.toggle", null, h("input", { type: "checkbox", checked: onlyMine, onchange: (e) => { onlyMine = (e.target as HTMLInputElement).checked; rerender(); } }), "Only sets I own"),
        h("label.toggle", null, h("input", { type: "checkbox", checked: firstEdition, onchange: (e) => { firstEdition = (e.target as HTMLInputElement).checked; rerender(); } }), "Include 1st-edition rulebooks"),
        h("span.muted", null, `${list.length} kingdoms`))),
    !list.length && h("p.empty-note", null, "No kingdoms match. Try including sets you don’t own."),
    [...groups].map(([group, ks]) => h("section.rk-group", null,
      h("h2", null, group),
      h("div.rk-grid", null, ks.map((k) => h("article.rk", null,
        h("header", null,
          h("h3", null, k.name),
          h("span.rk-sets", null, k.sets.map((s) => { const i = setIcon(s); return i ? h("img.set-glyph", { src: i.src, alt: setName(s), title: setName(s) }) : null; }),
            k.colony && h("span.tag", null, "Colony"), k.shelters && h("span.tag", null, "Shelters"))),
        h("div.rk-tiles", null, k.kingdom.map((id) => db.get(id)).sort(byCost).map((c) => tile(c.id))),
        k.landscapes.length > 0 && h("div.rk-landscapes", null, k.landscapes.map((id) => h("span.chip", null, db.get(id).name))),
        h("button.btn", { type: "button", onclick: () => app.useRecommended(k) }, "Set up this kingdom")))))));
}
