// Re-picking the random choices a setup makes (the Bane, the Ally, Ferryman's pile ...).

import { h, icon } from "../dom";
import { choiceRerolls, type Reroll } from "../model";
import type { App } from "../main";

/** A small round swap button for a picked card; stays out of the way until the card is hovered or focused. */
export function swapButton(app: App, reroll: Reroll): HTMLElement {
  return h("button.swap-mini", { type: "button", title: reroll.label, "aria-label": reroll.label,
    onclick: (e: MouseEvent) => { e.stopPropagation(); app.store.dispatch({ type: "reroll", key: reroll.key }); } }, icon("swap"));
}

/** Every choice that concerns this card, if the table can still be changed. */
export function rerollsFor(app: App, id: string): Reroll[] {
  const setup = app.store.setup();
  return setup && !app.store.state.game.setupLocked ? choiceRerolls(setup, id) : [];
}
