// Add-card palette: search stays at the top; results update as you type.

import { h, icon } from "../dom";
import { artImage, byCost, cardImage, data, db, setIcon, setName } from "../data";
import { costSymbols } from "../markup";
import { isStandardLandscape, poolSets } from "../../shared/randomizer";
import type { App } from "../main";

let query = "";
let everything = false;

export function pickerView(app: App): HTMLElement {
  const { game } = app.store.state;
  const pool = app.store.pool();
  const inGame = new Set([...game.kingdom, ...game.landscapes]);
  const results = h("ul.results", { "data-scroll": "picker", role: "listbox" });

  // Random card from one expansion: the ones you own, or every expansion when including those you don't.
  const owned = new Set(poolSets(db, pool));
  const sets = () => data.sets.filter((s) => (everything ? db.data.cards.some((c) => c.kind === "kingdom" && c.set === s.id) : owned.has(s.id)));
  const slots = Math.max(0, app.store.state.settings.options.kingdomSize - game.kingdom.length);
  const random = h("div.random-row");
  const fillRandom = () => {
    random.replaceChildren(...[
      h("span.label", null, "Add a random card from"),
      h("div.random-chips", null,
        h("button.chip", { type: "button", onclick: () => { app.store.dispatch({ type: "addRandom", set: null }); app.closePicker(); } }, "Any"),
        sets().map((s) => {
          const img = setIcon(s.id);
          return h("button.chip", { type: "button", title: s.name, onclick: () => { app.store.dispatch({ type: "addRandom", set: s.id }); app.closePicker(); } },
            img && h("img.set-glyph", { src: img.src, alt: "" }), s.name);
        })),
      slots > 0 && game.kingdom.length > 0 && h("button.btn.ghost.fill-rest", { type: "button", onclick: () => { app.store.dispatch({ type: "fill" }); app.closePicker(); } },
        `Fill the other ${slots === 1 ? "slot" : `${slots} slots`} randomly`)].filter((x): x is HTMLElement => !!x));
  };
  fillRandom();

  const update = () => {
    const q = query.trim().toLowerCase();
    const list = db.data.cards
      .filter((c) => (c.kind === "kingdom" || isStandardLandscape(c)) && !inGame.has(c.id) && (everything || pool.has(c.id)))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.types.some((t) => t.toLowerCase().startsWith(q)) || setName(c.set).toLowerCase().includes(q))
      .sort((a, b) => Number(a.kind === "landscape") - Number(b.kind === "landscape") || byCost(a, b))
      .slice(0, 60);
    results.replaceChildren(...list.map((c) => {
      const art = artImage(c.id) ?? cardImage(c.id);
      const set = setIcon(c.set);
      return h("li", null, h("button.result", { type: "button", role: "option", onclick: () => { app.store.dispatch({ type: "add", id: c.id }); app.closePicker(); } },
        h("span.thumb", null, art && h("img", { src: art.src, alt: "", loading: "lazy" })),
        h("span.result-name", null, c.name, h("span.muted", null, c.types.join(" · "))),
        h("span.result-meta", null, costSymbols(c.cost, "s"), set && h("img.set-glyph", { src: set.src, alt: setName(c.set), title: setName(c.set) }))));
    }));
    if (!list.length) results.append(h("li.muted.empty", null, everything ? "No matching cards." : "No matching cards in your sets."));
  };

  const input = h("input#picker-search", {
    type: "search", placeholder: "Search cards, types or expansions", value: query, autocomplete: "off",
    oninput: (e) => { query = (e.target as HTMLInputElement).value; update(); },
    onkeydown: (e) => {
      if (e.key === "Enter") (results.querySelector("button") as HTMLButtonElement | null)?.click();
      if (e.key === "Escape") app.closePicker();
    },
  });
  update();
  queueMicrotask(() => input.focus());

  return h("div.palette", { role: "dialog", "aria-modal": "true", "aria-label": "Add a card" },
    h("div.palette-search", null, icon("search"), input,
      h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => app.closePicker() }, icon("close"))),
    h("label.toggle", null, h("input", { type: "checkbox", checked: everything, onchange: (e) => { everything = (e.target as HTMLInputElement).checked; update(); fillRandom(); } }),
      "Include sets you don’t own"),
    random,
    results);
}
