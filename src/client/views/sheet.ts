// Card details: a sheet that slides in from the right. Card links inside it push onto a stack.

import { h, icon, replace, type Child } from "../dom";
import { cardImage, data, db, loadFaq, name, setIcon, setName, wikiUrl } from "../data";
import { costSymbols } from "../markup";
import { buildModel } from "../model";
import type { FaqItem, FaqSection } from "../../shared/types";
import type { App } from "../main";

let faqCache: Record<string, FaqSection[]> | null = null;

export function sheetView(app: App, stack: string[]): Child {
  const id = stack[stack.length - 1]!;
  const card = db.get(id);
  const { game } = app.store.state;
  const setup = app.store.setup();
  const onTable = game.kingdom.includes(id) || game.landscapes.includes(id);
  const img = cardImage(id);
  const wide = !!img && img.w > img.h;
  const open = (next: string) => app.openCard(next, true);

  // What this card brings to the current game, and why it's here if it's an extra.
  let brings: string[] = [];
  let why: string[] = [];
  if (setup) {
    const model = buildModel(setup, game.kingdom, game.landscapes);
    const items = [...model.tray.flatMap((g) => g.items), ...model.extraKingdom, ...model.supply,
      ...model.landscapes.filter((l) => !game.landscapes.includes(l.card))];
    brings = [...new Set(items.filter((i) => i.card !== id && i.roots.includes(id)).map((i) => i.card))];
    const reasons = [
      ...setup.nonSupply, ...setup.extraKingdom, ...setup.basic, ...setup.statuses, ...setup.landscapes,
    ].filter((p) => p.id === id).flatMap((p) => p.reasons);
    why = reasons.filter((r) => r.by).map((r) => `${name(r.by!)} ${r.text}`);
  }

  const faqSection = h("section.rules", null, h("h3", null, "Rules"), h("p.muted", null, "Loading…"));
  const fillFaq = (all: Record<string, FaqSection[]>) => {
    const secs = all[id] ?? [];
    replace(faqSection, h("h3", null, "Rules"),
      !secs.length && h("p.muted", null, "No rulings for this card yet."),
      secs.filter((s) => !s.deprecated).map((s) => h("div.faq-block", null,
        (secs.length > 1 || s.heading !== "FAQ") && h("h4", null, s.heading),
        faqList(s.items, app, open))),
      secs.filter((s) => s.deprecated).map((s) => h("details.deprecated", null, h("summary", null, s.heading), faqList(s.items, app, open))),
      h("p.attribution", null, "From the ", h("a", { href: wikiUrl(card.wikiTitle), target: "_blank", rel: "noreferrer" }, "Dominion Strategy Wiki"), " (CC BY-NC-SA 3.0)."));
  };
  if (faqCache) fillFaq(faqCache);
  else loadFaq().then((all) => { faqCache = all; fillFaq(all); }).catch(() => faqSection.replaceChildren(h("p.muted", null, "Couldn't load rulings.")));

  const set = setIcon(card.set);
  const parent = card.pileId ? db.get(card.pileId) : null;
  const locked = game.locked.includes(id);

  return h("aside.sheet", { role: "dialog", "aria-modal": "true", "aria-label": card.name },
    h("header.sheet-head", null,
      stack.length > 1 && h("button.icon-btn", { type: "button", "aria-label": "Back", onclick: () => app.backCard() }, icon("back")),
      h("h2", null, card.name),
      h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => app.closeCard() }, icon("close"))),
    h("div.sheet-body", { "data-scroll": "sheet" },
      h("div", { class: ["sheet-card", wide ? "wide" : ""] },
        img ? h("img", { src: img.src, alt: card.name, width: img.w, height: img.h }) : h("div.face-missing", null, card.name)),
      h("p.meta", null,
        costSymbols(card.cost, "s"), " ", card.types.join(" · "), " · ",
        set && h("img.set-glyph", { src: set.src, alt: "" }), setName(card.set),
        card.quantity ? ` · ${card.quantity} in the box` : ""),

      onTable && h("div.sheet-actions", null,
        h("button.btn", { type: "button", onclick: () => app.store.dispatch({ type: "toggleLock", id }) }, icon(locked ? "unlock" : "lock"), locked ? "Unlock" : "Lock"),
        h("button.btn", { type: "button", onclick: () => { app.store.dispatch({ type: "replace", id }); app.closeCard(); } }, icon("swap"), "Swap"),
        h("button.btn", { type: "button", onclick: () => { app.store.dispatch({ type: "remove", id }); app.closeCard(); } }, icon("close"), "Remove")),

      (brings.length > 0 || why.length > 0) && h("section", null,
        h("h3", null, "In this game"),
        why.map((w) => h("p", null, ...app.markup(w, open))),
        brings.length > 0 && h("div.brings", null, h("span.muted", null, "Brings "),
          brings.map((b, i) => [i > 0 && ", ", h("button.link", { type: "button", onclick: () => open(b) }, name(b))]))),

      parent && h("p", null, "Part of the ", h("button.link", { type: "button", onclick: () => open(parent.id) }, parent.name), " pile."),

      card.pile && h("section", null,
        h("h3", null, "In the pile"),
        h("p.muted", null, card.pile.shuffled ? "Shuffled face down; only the top card is face up." : "Top card first. Only the top card can be bought or gained."),
        h("div.pile-members", null, card.pile.members.map((m) => {
          const mi = cardImage(m);
          const qty = db.get(m).quantity ?? 1;
          return h("button.member", { type: "button", onclick: () => open(m) },
            mi && h("img", { src: mi.src, alt: name(m), loading: "lazy" }),
            h("span", null, name(m)), h("span.muted", null, `×${qty}${card.id === "castles" && qty > 1 ? " (1 with 2 players)" : ""}`));
        }))),

      data.setupNotes[id] && h("section", null, h("h3", null, "Setup"), h("p", null, ...app.markup(data.setupNotes[id]!, open))),
      faqSection));
}

function faqList(items: FaqItem[], app: App, open: (id: string) => void): HTMLElement {
  return h("ul.faq", null, items.map((item) => h("li", null, ...app.markup(item.text, open), item.children && faqList(item.children, app, open))));
}
