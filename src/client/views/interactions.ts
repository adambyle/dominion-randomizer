// Card interactions: the two-card explorer (#/interactions/<a>/<b>), the "notable interactions"
// summary for the table, and the per-card list in the card sheet.

import { h, icon, type Child } from "../dom";
import { artImage, cardImage, data, db, mentions, name, wikiUrl } from "../data";
import { interactionBetween, interactionsAmong, interactionsWith, type Interaction } from "../../shared/interactions";
import type { App } from "../main";

/** Cards worth comparing: everything except basic cards and pile members' own pile cards. */
const comparable = () => data.cards.filter((c) => c.kind !== "basic");

/** The cards in the current game: Kingdom, landscapes, and extras the setup brings in. */
export function gameCards(app: App): string[] {
  const { game } = app.store.state;
  const setup = app.store.setup();
  if (!setup) return [];
  const members = (id: string) => db.get(id).pile?.members ?? [];
  return [...new Set([
    ...game.kingdom, ...game.kingdom.flatMap(members), ...game.landscapes,
    ...setup.extraKingdom.map((p) => p.id), ...setup.nonSupply.map((p) => p.id), ...setup.landscapes.map((l) => l.id),
  ])].filter((id) => db.byId.has(id) && db.get(id).kind !== "basic");
}

const explorerHref = (a: string, b?: string) => `#/interactions/${a}${b ? `/${b}` : ""}`;

/** One interaction: what kind it is and why, plus rulings that name both cards. */
function interactionBody(app: App, x: Interaction, opts: { rulings: boolean; open?: (id: string) => void }): Child[] {
  return [
    x.detected.length > 0 && h("ul.faq.interaction-list", null, x.detected.map((d) => h("li", null,
      h("span.ix-kind", null, d.label), " ", ...app.markup(d.text, opts.open)))),
    opts.rulings && x.rulings.length > 0 && h("div.ix-rulings", null,
      h("h4", null, "Rulings that name both cards"),
      h("ul.faq", null, x.rulings.map(([from, source, text]) => h("li", null, ...app.markup(text, opts.open),
        h("span.ix-source", null, ` — ${name(from)}${source === "wiki" ? ", wiki FAQ" : ""}`))))),
  ];
}

const pairTitle = (app: App, x: Interaction, open?: (id: string) => void) => h("span.ix-pair", null,
  ...app.markup(`{card:${db.get(x.a).name}}`, open), " + ", ...app.markup(`{card:${db.get(x.b).name}}`, open));

const notable = (app: App) => {
  const ids = gameCards(app);
  return ids.length < 2 ? [] : interactionsAmong(db, mentions(() => app.render()), ids).filter((x) => x.score >= 3);
};

/** How many notable pairs the current table has. */
export const notableCount = (app: App) => notable(app).length;

/** Table summary: the most notable pairs in this game. */
export function interactionSummary(app: App, limit = 6): Child {
  const list = notable(app);
  if (!list.length) return null;
  return h("section.ix-summary", { "aria-label": "Notable interactions" },
    h("p.label", null, "Notable interactions"),
    h("div.ix-cards", null, list.slice(0, limit).map((x) => h("article.ix-card", null,
      h("header", null, pairTitle(app, x), h("a.ix-more", { href: explorerHref(x.a, x.b), title: "Details" }, "Details")),
      x.detected[0] ? h("p", null, h("span.ix-kind", null, x.detected[0].label), " ", ...app.markup(x.detected[0].text))
        : h("p", null, h("span.ix-kind", null, "Ruling"), " ", ...app.markup(x.rulings[0]![2]))))),
    list.length > limit && h("p.muted.small", null, `${list.length - limit} more — open a card to see what it interacts with.`));
}

/** Card sheet: this card's interactions with the rest of the game, and a link to the explorer. */
export function sheetInteractions(app: App, id: string, open: (id: string) => void): Child {
  const others = gameCards(app).filter((x) => x !== id);
  if (!others.length) return null;
  const list = interactionsWith(db, mentions(() => app.render()), id, others);
  return h("section.ix-sheet", null,
    h("h3", null, "Interactions"),
    !list.length && h("p.muted", null, "No notable interactions between this card and the others on the current table."),
    list.map((x) => h("div.ix-block", null,
      h("h4", null, ...app.markup(`{card:${db.get(x.b).name}}`, open), x.rulings.length > 0 && h("span.muted", null, ` · ${x.rulings.length} ${x.rulings.length === 1 ? "ruling" : "rulings"}`)),
      interactionBody(app, x, { rulings: true, open }))),
    h("p", null, h("a.btn.ghost.ix-compare", { href: explorerHref(id) }, icon("search"), "Check against any card")));
}

/** Quick list of names, for the phone quick card. */
export function interactsWithNames(app: App, id: string): string[] {
  const others = gameCards(app).filter((x) => x !== id);
  return interactionsWith(db, mentions(() => app.render()), id, others).filter((x) => x.score >= 3).map((x) => x.b);
}

// ---- Explorer

export function interactionsView(app: App, a: string | null, b: string | null): Child {
  const ma = a && db.byId.has(a) ? a : null;
  const mb = b && db.byId.has(b) ? b : null;
  const all = comparable();
  const m = mentions(() => app.render());

  const picker = (id: string, value: string | null, onPick: (id: string | null) => void, label: string) => {
    const listId = "ix-cards";
    return h("label.ix-picker", null, h("span.muted", null, label),
      h("input", { id, type: "search", list: listId, placeholder: "Type a card name", autocomplete: "off", value: value ? db.get(value).name : "",
        onchange: (e: Event) => {
          const text = (e.target as HTMLInputElement).value.trim().toLowerCase();
          const card = all.find((c) => c.name.toLowerCase() === text) ?? (text ? all.find((c) => c.name.toLowerCase().startsWith(text)) : undefined);
          onPick(card ? card.id : null);
        } }));
  };
  const go = (x: string | null, y: string | null) => { location.hash = x ? explorerHref(x, y ?? undefined) : "#/interactions"; };

  const cardFace = (id: string) => {
    const img = cardImage(id);
    return h("button.ix-face", { type: "button", onclick: () => app.openCard(id), class: img && img.w > img.h ? "wide" : "" },
      img ? h("img", { src: img.src, alt: name(id) }) : h("span.face-missing", null, name(id)));
  };

  let result: Child = h("p.muted", null, "Pick two cards to see how they interact, or one to see what it interacts with.");
  if (ma && mb) {
    const x = interactionBetween(db, m, ma, mb);
    result = h("section.ix-result", null,
      h("div.ix-faces", null, cardFace(ma), h("span.ix-plus", null, "+"), cardFace(mb)),
      !x.detected.length && !x.rulings.length && h("p", null, m ? "No known interaction between these two cards. They follow their own instructions as usual."
        : "Loading rulings…"),
      interactionBody(app, x, { rulings: true }),
      h("p.attribution", null, "Wiki FAQ quotes are from the ", h("a", { href: wikiUrl(db.get(ma).wikiTitle), target: "_blank", rel: "noreferrer" }, "Dominion Strategy Wiki"), " (CC BY-NC-SA 3.0)."));
  } else if (ma) {
    const enabled = new Set(app.store.pool());
    const list = interactionsWith(db, m, ma, all.map((c) => c.id));
    const mine = list.filter((x) => enabled.has(x.b) || db.get(x.b).kind === "nonSupply" || db.get(x.b).kind === "status");
    result = h("section.ix-result", null,
      h("div.ix-faces", null, cardFace(ma)),
      h("p.muted", null, `${list.length} cards interact with ${name(ma)}${mine.length !== list.length ? `, ${mine.length} of them in your sets` : ""}. Pick one for details.`),
      h("div.ix-grid", null, (mine.length ? mine : list).slice(0, 60).map((x) => {
        const art = artImage(x.b);
        return h("a.ix-tile", { href: explorerHref(ma, x.b), title: x.detected.map((d) => d.label).join(", ") || "Rulings" },
          h("span.rk-tile", null, art ? h("img", { src: art.src, alt: "", loading: "lazy" }) : null),
          h("b", null, name(x.b)),
          h("span.muted", null, [...new Set(x.detected.map((d) => d.label))].slice(0, 2).join(" · ") || `${x.rulings.length} ${x.rulings.length === 1 ? "ruling" : "rulings"}`));
      })));
  }

  return h("div.page.ix-page", null,
    h("h1", null, "Card interactions"),
    h("p.lede", null, "How two cards' rules meet: replays, cards that move themselves, discard and trash triggers, cost changes and more, plus rulings that name both."),
    h("datalist#ix-cards", null, all.map((c) => h("option", { value: c.name }))),
    h("div.ix-pickers", null,
      picker("ix-a", ma, (id) => go(id, mb), "First card"),
      picker("ix-b", mb, (id) => go(ma ?? id, ma ? id : null), "Second card"),
      (ma || mb) && h("button.btn.ghost", { type: "button", onclick: () => go(null, null) }, "Clear")),
    result);
}
