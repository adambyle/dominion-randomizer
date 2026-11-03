// The expansions pane: which owned expansions a deal draws from. Opens from the table (desktop bar,
// phone thumb bar, the icons above the kingdom), separate from Tune and from the sets you own.

import { h, icon, stepper } from "../dom";
import { data, db, setIcon, setName } from "../data";
import { buildPool, implicitSet, poolSets, selectedSets } from "../../shared/randomizer";
import type { App } from "../main";

/** The owned expansions that have Kingdom cards, in set-list order. */
export function ownedSets(app: App): string[] {
  const owned = new Set(poolSets(db, buildPool(db, app.store.state.settings.options.enabledBoxes)));
  return data.sets.map((s) => s.id).filter((id) => owned.has(id));
}

/**
 * Builds the pane. `register` receives a function that brings the pane up to date in place, so
 * selecting expansions animates the tiles instead of rebuilding the page.
 */
export function expansionsView(app: App, register: (sync: () => void) => void): HTMLElement {
  const dispatch = app.store.dispatch;
  const owned = ownedSets(app);

  const tiles = new Map(owned.map((id) => {
    const img = setIcon(id);
    const tile = h("button.exp-tile", { type: "button", onclick: () => dispatch({ type: "toggleSet", id }) },
      h("span.exp-icon", null, img && h("img", { src: img.src, alt: "" })),
      h("span.exp-name", null, setName(id)),
      h("span.exp-tick", null, icon("check")));
    return [id, tile] as const;
  }));

  const status = h("p.exp-status");
  const selectAll = h("button.btn", { type: "button", onclick: () => dispatch({ type: "drawSets", sets: owned }) }, "Select all");
  const deselectAll = h("button.btn", { type: "button", onclick: () => dispatch({ type: "drawSets", sets: [] }) }, "Deselect all");
  const count = h("div.exp-count");
  const roll = h("button.btn.exp-roll", { type: "button", onclick: () => dispatch({ type: "rollSets" }) });
  const deal = h("button.deal", { type: "button", onclick: () => { dispatch({ type: "deal" }); app.closeExpansions(); } }, "Deal");

  const pane = h("aside.drawer.exp-pane", { role: "dialog", "aria-modal": "true", "aria-label": "Expansions" },
    h("header.sheet-head", null,
      h("h2", null, "Expansions"),
      h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => app.closeExpansions() }, icon("close"))),
    h("div.sheet-body", { "data-scroll": "expansions" },
      status,
      h("div.exp-actions", null, selectAll, deselectAll),
      h("div.exp-rollbar", null, count, roll),
      h("div.exp-grid", null, [...tiles.values()]),
      h("a.link.exp-owned", { href: "#/sets" }, "Change which sets you own")),
    h("footer.exp-foot", null, deal));

  let previous = new Set<string>();
  let shownRoll = 0;
  const sync = () => {
    const { settings, game } = app.store.state;
    const opts = settings.options;
    const chosen = new Set(selectedSets(db, opts));
    const implicit = chosen.size ? undefined : implicitSet(db, opts.enabledBoxes);
    for (const [id, tile] of tiles) {
      const on = chosen.has(id);
      tile.classList.toggle("on", on);
      tile.classList.toggle("implicit", id === implicit);
      tile.setAttribute("aria-pressed", String(on));
      tile.title = id === implicit ? "Used while nothing is selected" : "";
      if (on && !previous.has(id)) {
        tile.classList.remove("pop");
        void tile.offsetWidth;
        tile.classList.add("pop");
      }
    }
    previous = chosen;
    status.textContent = chosen.size
      ? `Dealing from ${chosen.size} of ${owned.length} expansions.`
      : implicit ? `Nothing selected, so cards come from ${setName(implicit)}.` : "You don't own any expansions yet.";
    selectAll.toggleAttribute("disabled", chosen.size === owned.length);
    deselectAll.toggleAttribute("disabled", chosen.size === 0);
    // Rebuilt only when the number changes, so a focused control keeps its focus.
    if (shownRoll !== opts.rollCount) {
      shownRoll = opts.rollCount;
      count.replaceChildren(stepper({ value: opts.rollCount, min: 1, max: Math.max(1, owned.length), label: "expansions to roll",
        onChange: (n) => dispatch({ type: "rollCount", count: n }) }));
      roll.replaceChildren(icon("swap"), `Roll ${opts.rollCount} ${opts.rollCount === 1 ? "set" : "sets"}`);
    }
    roll.toggleAttribute("disabled", owned.length === 0);
    deal.toggleAttribute("disabled", game.setupLocked || owned.length === 0);
  };
  sync();
  register(sync);
  return pane;
}
