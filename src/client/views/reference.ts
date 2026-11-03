// Rules reference for a locked table: the rules of each card in the game, one card per page. Swipe
// (or use the arrows) to move between cards; none of the dependency or swap information is shown.

import { h, icon, type Child } from "../dom";
import { artImage, cardImage, db, name, setIcon, setName } from "../data";
import { costSymbols } from "../markup";
import { buildModel } from "../model";
import type { App } from "../main";
import { ruleSections } from "./sheet";
import { sheetInteractions } from "./interactions";

/** The cards a locked table has rules for, in table order. */
export function referenceCards(app: App): string[] {
  const { game } = app.store.state;
  const setup = app.store.setup();
  // The order the piles are laid out in (by cost), as on the table.
  const kingdom = setup ? buildModel(setup, game.kingdom, game.landscapes).kingdom : game.kingdom;
  return [...kingdom, ...game.landscapes];
}

export function referenceView(app: App, id: string): HTMLElement {
  const cards = referenceCards(app);
  const at = cards.indexOf(id);
  const card = db.get(id);
  const img = cardImage(id);
  const wide = !!img && img.w > img.h;
  const go = (to: number) => { const next = cards[to]; if (next) app.showReference(next); };
  const set = setIcon(card.set);
  const [ownSection, wikiSection] = ruleSections(app, id, (next) => app.openCard(next));

  const strip = h("div.ref-strip", { role: "tablist", "aria-label": "Cards in this game" }, cards.map((c, i) => {
    const art = artImage(c) ?? cardImage(c);
    return h("button", { type: "button", role: "tab", class: c === id ? "on" : "", "aria-selected": String(c === id), "aria-label": name(c), title: name(c),
      onclick: () => go(i) }, art && h("img", { src: art.src, alt: "", draggable: "false" }));
  }));
  // Keep the current card in view in the strip (after it is in the page).
  requestAnimationFrame(() => strip.querySelector<HTMLElement>(".on")?.scrollIntoView({ inline: "center", block: "nearest" }));

  // Wide screens get the whole list down the side instead of the strip and the full-width buttons.
  const side = h("nav.ref-side", { "aria-label": "Cards in this game" }, cards.map((c, i) => {
    const art = artImage(c) ?? cardImage(c);
    return h("button", { type: "button", class: c === id ? "on" : "", "aria-current": c === id ? "true" : undefined, onclick: () => go(i) },
      h("span.ref-thumb", null, art && h("img", { src: art.src, alt: "", draggable: "false" })), h("span.ref-side-name", null, name(c)));
  }));
  requestAnimationFrame(() => side.querySelector<HTMLElement>(".on")?.scrollIntoView({ block: "nearest" }));

  let startX = 0, startY = 0;
  const body = h("div.ref-body", {
    // Keyed by card, so each card opens scrolled to the top.
    "data-key": `ref-${id}`, "data-scroll": `ref-${id}`,
    ontouchstart: (e: TouchEvent) => { startX = e.touches[0]!.clientX; startY = e.touches[0]!.clientY; },
    ontouchend: (e: TouchEvent) => {
      const t = e.changedTouches[0]!;
      const dx = t.clientX - startX, dy = t.clientY - startY;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) go(at + (dx < 0 ? 1 : -1));
    },
  },
    h("div.ref-card", null,
      h("div", { class: ["sheet-card", wide ? "wide" : ""] },
        img ? h("img", { src: img.src, alt: card.name, width: img.w, height: img.h }) : h("div.face-missing", null, card.name)),
      h("p.meta", null, costSymbols(card.cost, "s"), " ", card.types.join(" · "), " · ", set && h("img.set-glyph", { src: set.src, alt: "" }), setName(card.set))),
    ownSection, sheetInteractions(app, id, (next) => app.openCard(next), true), wikiSection);

  const neighbour = (to: number, dir: "prev" | "next"): Child => {
    const target = cards[to];
    return h("button", { type: "button", class: `ref-nav ${dir}`, disabled: !target, "aria-label": target ? `${dir === "prev" ? "Previous" : "Next"}: ${name(target)}` : dir,
      onclick: () => go(to) },
      dir === "prev" && icon("back"), h("span", null, target ? name(target) : ""), dir === "next" && icon("back", "flip"));
  };

  return h("aside.reference", { role: "dialog", "aria-modal": "true", "aria-label": `Rules: ${card.name}` },
    h("header.ref-head", null,
      h("button.icon-btn", { type: "button", "aria-label": "Close rules", onclick: () => app.closeReference() }, icon("close")),
      h("h2", null, card.name),
      h("span.ref-count", null, `${at + 1} / ${cards.length}`),
      h("div.ref-arrows", null,
        h("button.icon-btn", { type: "button", "aria-label": "Previous card", title: at > 0 ? name(cards[at - 1]!) : undefined, disabled: at <= 0, onclick: () => go(at - 1) }, icon("back")),
        h("button.icon-btn", { type: "button", "aria-label": "Next card", title: cards[at + 1] ? name(cards[at + 1]!) : undefined, disabled: at >= cards.length - 1, onclick: () => go(at + 1) }, icon("back", "flip")))),
    h("div.ref-main", null, side, body),
    h("footer.ref-foot", null, strip, h("div.ref-navs", null, neighbour(at - 1, "prev"), neighbour(at + 1, "next"))));
}
