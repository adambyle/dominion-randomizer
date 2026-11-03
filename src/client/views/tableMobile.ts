// The table on a phone: Kingdom as art tiles (5 × 2), landscapes, a Supply strip, a Setup sheet
// that peeks from the bottom and pulls up, and a thumb bar with Deal. Tapping a pile selects it
// (lighting up what it brings, with a quick card of actions); a long press opens the full card.

import { h, icon, type Child } from "../dom";
import { artImage, cardImage, db, name, recommended, setIcon, setName } from "../data";
import { BASICS_PREVIEW, buildModel, type TableItem, type TableModel } from "../model";
import { costSymbols } from "../markup";
import type { App } from "../main";
import { tableSets } from "../state";
import { playedControl } from "./history";
import { rerollsFor, swapButton } from "./rerolls";
import { interactionSummary, interactsWithNames } from "./interactions";

let selected: string | null = null;
let sheetOpen = false;
/** What was showing at the last render, so the quick card and sheet only animate when they appear. */
let shownQuick: string | null = null;
let shownSheetOpen = false;
let playersOpen = false;
/** Where a pull on the setup sheet started (kept here so a render mid-gesture doesn't lose it). */
let sheetDragY: number | null = null;

export function tableMobileView(app: App): Child {
  const { game, settings } = app.store.state;
  const setup = app.store.setup();
  const model = setup ? buildModel(setup, game.kingdom, game.landscapes) : null;
  const dispatch = app.store.dispatch;
  const empty = !game.kingdom.length && !game.landscapes.length;
  const frozen = game.setupLocked;
  if (frozen) selected = null;
  if (selected && !game.kingdom.includes(selected) && !game.landscapes.includes(selected)) selected = null;
  document.body.classList.toggle("sheet-up", sheetOpen && !!model);

  const select = (id: string) => { selected = selected === id ? null : id; app.render(); };
  // What the selected pile brings: everything whose roots include it.
  const related = new Set<string>(selected ? relatedTo(selected, model) : []);
  const dim = (id: string, roots: string[] = []) => !!selected && id !== selected && !related.has(id) && !roots.includes(selected);

  // ---- Kingdom tiles
  const size = settings.options.kingdomSize;
  const tiles = (model?.kingdom ?? []).map((id) => {
    const c = db.get(id);
    const art = artImage(id) ?? cardImage(id);
    const brings = model ? bringsAnything(id, model) : false;
    return h("button", {
      type: "button", class: ["m-tile", dim(id) ? "dim" : "", selected === id ? "selected" : "", game.locked.includes(id) && !frozen ? "locked" : "", app.store.fresh.has(id) ? "fresh" : ""],
      "aria-label": `${c.name}${selected === id ? ", selected" : ""}`, ...pressHandlers(() => (frozen ? app.openReference(id) : select(id)), () => (frozen ? app.openReference(id) : app.openCard(id))),
    },
      art && h("img", { src: art.src, alt: "", draggable: "false" }),
      h("span.m-cost", null, costSymbols(c.cost, "s")),
      brings && h("span.m-dot", null, "+"),
      game.locked.includes(id) && !frozen && h("span.m-lock", null, icon("lock")),
      (model?.targetedBy.get(id) ?? []).map((t) => h("span.m-ribbon", null, name(t))),
      // Split piles ("Settlers/Bustling Village") may break after the slash.
      h("span.m-name", null, c.name.replace(/\//g, "/​")));
  });
  const slots = Array.from({ length: frozen ? 0 : Math.max(0, size - tiles.length) }, () =>
    h("button.m-tile.m-slot", { type: "button", onclick: () => app.openPicker(), "aria-label": "Add a card" }, icon("plus")));

  // ---- Landscapes (own first, then Allies/Prophecies with their caption)
  const landscapes = (model?.landscapes ?? []).map((l) => {
    const img = cardImage(l.card);
    const own = game.landscapes.includes(l.card);
    return h("div.m-landscape-wrap", null, h("button", {
      type: "button", class: ["m-landscape", dim(l.card, l.roots) ? "dim" : "", selected === l.card ? "selected" : "", app.store.fresh.has(l.card) ? "fresh" : ""],
      ...pressHandlers(() => (own ? (frozen ? app.openReference(l.card) : select(l.card)) : app.openCard(l.card)), () => (frozen && own ? app.openReference(l.card) : app.openCard(l.card))),
    }, img && h("img", { src: img.src, alt: name(l.card), draggable: "false" }), l.note && h("span.m-caption", null, l.note)),
      !own && !frozen && l.reroll && swapButton(app, l.reroll));
  });

  // ---- Supply strip
  const supplyItems: TableItem[] = model?.supply ?? BASICS_PREVIEW.map((id) => ({ card: id, roots: [] }));
  const supply = h("div.m-supply", { "aria-label": "Supply" }, supplyItems.map((s) => {
    const art = artImage(s.card) ?? cardImage(s.card);
    return h("button", { type: "button", class: ["m-chip", dim(s.card, s.roots) ? "dim" : ""], onclick: () => app.openCard(s.card), title: s.label ?? name(s.card) },
      art && h("img", { src: art.src, alt: "" }), s.count ?? name(s.card));
  }));

  const rec = game.recommendedId ? recommended.find((k) => k.id === game.recommendedId) : null;
  const felt = h("section.m-felt", null,
    h("div.m-felt-head", null,
      h("p.label", null, rec ? `Kingdom · ${rec.name}` : "Kingdom"),
      h("div.m-felt-tools", null,
        // Right-aligned: the join code appears at the left edge without moving the lock or the expansions.
        (frozen || app.room.code) && h("button.m-tool", { type: "button", onclick: () => app.openQr(), "aria-label": "Show the join code", title: "Join code" }, icon("qr")),
        h("button.m-tool", { type: "button", class: frozen ? "on" : "", disabled: empty && !frozen, onclick: () => app.lockSetup(!frozen),
          "aria-pressed": String(frozen), "aria-label": frozen ? "Unlock the table" : "Lock the table",
          title: frozen ? "Unlock the table to change it" : "Lock the table: tapping a card then goes straight to its rules" }, icon(frozen ? "lock" : "unlock")),
        sets(app, tableSets(game), frozen))),
    h("div.m-kingdom", null, tiles, slots),
    empty && h("p.m-empty", null, "Deal a random kingdom, pick a recommended one from the menu, or tap a slot to add cards yourself."),
    landscapes.length > 0 && h("div.m-landscapes", null, landscapes),
    supply);

  // ---- Quick card for the selected pile
  const quick = selected && model && quickCard(app, selected, model);
  if (!quick) shownQuick = null;

  // ---- Setup sheet
  // The quick card takes the sheet's place while a pile is selected.
  const sheet = model && !quick && setupSheet(app, model, empty);

  // ---- Thumb bar
  const hasGame = !empty;
  const bar = frozen ? h("nav.m-bar", { "aria-label": "Table actions" },
    h("button.m-round", { type: "button", "aria-label": "Unlock the table", title: "Unlock the table", onclick: () => app.lockSetup(false) }, icon("unlock")),
    h("button.deal.m-deal", { type: "button", onclick: () => app.openReference() }, "Card rules"),
    h("button.m-round", { type: "button", "aria-label": "Show the join code", title: "Join code", onclick: () => app.openQr() }, icon("qr")))
  : h("nav.m-bar", { "aria-label": "Table actions" },
    h("button.m-round", { type: "button", "aria-label": "Tune", onclick: () => app.openTune() }, icon("tune")),
    h("button.m-round", { type: "button", "aria-label": "Expansions to deal from", onclick: () => app.openExpansions() }, icon("layers")),
    h("button.m-round", { type: "button", "aria-label": "Add a card", onclick: () => app.openPicker() }, icon("plus")),
    h("button.deal.m-deal", { type: "button", onclick: () => { selected = null; dispatch({ type: "deal" }); } }, hasGame ? "Deal again" : "Deal"),
    h("div.m-players", null,
      h("button", { type: "button", "aria-haspopup": "true", "aria-expanded": String(playersOpen), onclick: () => { playersOpen = !playersOpen; app.render(); } },
        h("b", null, settings.players), "players"),
      playersOpen && h("div.m-players-pop", { role: "radiogroup", "aria-label": "Players" }, [2, 3, 4, 5, 6].map((n) =>
        h("button", { type: "button", role: "radio", "aria-checked": String(n === settings.players), class: n === settings.players ? "on" : "",
          onclick: () => { playersOpen = false; dispatch({ type: "settings", patch: { players: n } }); } }, n)))));

  document.fonts?.ready.then(fitNames);
  return h("div.m-table", { class: selected ? "has-selection" : "", onclick: (e: MouseEvent) => {
    // Tapping empty felt clears the selection.
    if (selected && !(e.target as Element).closest("button, .m-quick, .m-sheet")) { selected = null; app.render(); }
  } },
    game.warnings.length > 0 && h("div.notice", null, game.warnings.join(" ")),
    setup && setup.warnings.length > 0 && h("div.notice", null, setup.warnings.join(" ")),
    felt, quick, sheet, bar);
}

/** The table's expansions as a short overlapping stack of icons ("+3" for the rest), so many of them never run off the screen. */
const STACK_MAX = 4;
function sets(app: App, list: string[], frozen: boolean) {
  if (!list.length) return null;
  const shown = list.length > STACK_MAX ? list.slice(0, STACK_MAX - 1) : list;
  const rest = list.length - shown.length;
  return h("button.m-sets", { type: "button", disabled: frozen, title: list.map(setName).join(", "), "aria-label": `Expansions: ${list.map(setName).join(", ")}. Choose expansions to deal from`,
    onclick: () => app.openExpansions() },
    shown.map((s) => { const img = setIcon(s); return img ? h("span.m-set-dot", null, h("img", { src: img.src, alt: "" })) : null; }),
    rest > 0 && h("span.m-set-dot.more", null, `+${rest}`));
}

function relatedTo(id: string, model: TableModel | null): string[] {
  if (!model) return [];
  const out = new Set<string>();
  const items = [...model.tray.flatMap((g) => g.items), ...model.extraKingdom, ...model.supply, ...model.landscapes];
  for (const i of items) if (i.roots.includes(id)) out.add(i.card);
  return [...out];
}

function bringsAnything(id: string, model: TableModel) {
  return model.tray.some((g) => g.roots.includes(id)) || model.extraKingdom.some((i) => i.roots.includes(id))
    || model.landscapes.some((l) => l.card !== id && l.roots.includes(id)) || model.checklist.some((c) => c.key !== "deck" && c.roots.includes(id));
}

function quickCard(app: App, id: string, model: TableModel) {
  const c = db.get(id);
  const img = cardImage(id);
  const locked = app.store.state.game.locked.includes(id);
  const brings = relatedTo(id, model).filter((x) => x !== id);
  const groups = model.tray.filter((g) => g.by === id).map((g) => g.what);
  const count = model.pileCounts.get(id);
  const interacts = interactsWithNames(app, id);
  const rerolls = rerollsFor(app, id);
  const dispatch = app.store.dispatch;
  const done = () => { selected = null; };
  const entering = shownQuick !== id;
  shownQuick = id;
  return h("div.m-quick", { role: "dialog", "aria-label": c.name, class: entering ? "enter" : "" },
    img && h("img.m-quick-face", { src: img.src, alt: "" }),
    h("div", null,
      h("h3", null, c.name),
      h("p", null, [c.types.join(" – "), setName(c.set), count ? `${count} cards` : null].filter(Boolean).join(" · ")),
      groups.length > 0 && h("p.m-quick-brings", null, `Brings: ${groups.join("; ")}`),
      interacts.length > 0 && h("p.m-quick-brings", null, "Interacts with ", interacts.slice(0, 4).map((x, i) => [i > 0 && ", ",
        h("button.link", { type: "button", onclick: () => app.openCard(x) }, name(x))]), interacts.length > 4 ? ` +${interacts.length - 4}` : ""),
      rerolls.length > 0 && h("div.m-quick-rerolls", null, rerolls.map((r) =>
        h("button", { type: "button", onclick: () => dispatch({ type: "reroll", key: r.key }) }, icon("swap"), r.label))),
      brings.length > 0 && h("div.m-quick-thumbs", null, brings.slice(0, 6).map((b) => {
        const bi = cardImage(b);
        return h("button", { type: "button", onclick: () => app.openCard(b), "aria-label": name(b) }, bi && h("img", { src: bi.src, alt: "" }));
      }))),
    h("div.m-quick-actions", null,
      h("button", { type: "button", onclick: () => dispatch({ type: "toggleLock", id }) }, icon(locked ? "unlock" : "lock"), locked ? "Unlock" : "Lock"),
      h("button", { type: "button", onclick: () => { done(); dispatch({ type: "replace", id }); } }, icon("swap"), "Swap"),
      h("button", { type: "button", onclick: () => { done(); dispatch({ type: "remove", id }); } }, icon("close"), "Remove"),
      h("button.strong", { type: "button", onclick: () => app.openCard(id) }, icon("info"), "Rules")));
}

function setupSheet(app: App, model: TableModel, empty: boolean) {
  const aside = [...model.extraKingdom.map((x) => ({ key: x.card, title: x.note ?? "Extra pile", what: "in the Supply", items: [x] })),
    ...model.tray.map((g) => ({ key: g.key, title: g.by ? name(g.by) : "Rules", what: g.what, items: g.items }))];
  const peekCards = aside.flatMap((g) => g.items).slice(0, 7);
  const toggle = (open: boolean) => { sheetOpen = open; app.render(); };
  const handle = h("div.m-sheet-head", {
    role: "button", tabindex: "0", "aria-expanded": String(sheetOpen), "aria-label": sheetOpen ? "Collapse setup" : "Expand setup",
    onclick: () => toggle(!sheetOpen),
    onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(!sheetOpen); } },
    onpointerdown: (e: PointerEvent) => { sheetDragY = e.clientY; },
    onpointerup: (e: PointerEvent) => {
      if (sheetDragY === null) return;
      const dy = e.clientY - sheetDragY;
      sheetDragY = null;
      if (Math.abs(dy) > 30) { e.preventDefault(); toggle(dy < 0); }
    },
  },
    h("span.m-handle"),
    h("div.m-sheet-title", null,
      h("b", null, "Setup"),
      h("span", null, empty ? "" : [aside.length && `${aside.length} off to the side`, `${model.checklist.length} to hand out`].filter(Boolean).join(" · "))),
    !sheetOpen && peekCards.length > 0 && h("div.m-peek", null, peekCards.map((i) => {
      const img = cardImage(i.card);
      return img ? h("img", { src: img.src, alt: "", class: img.w > img.h ? "wide" : "" }) : null;
    })));

  const body = sheetOpen && h("div.m-sheet-body", { "data-scroll": "m-sheet" },
    aside.length > 0 && h("p.label", null, "Off to the side"),
    aside.map((g) => h("div.m-group", null,
      h("h4", null, h("b", null, g.title), ` · ${g.what}`),
      h("div.m-group-cards", null, g.items.map((i) => {
        const img = cardImage(i.card);
        return h("div.m-group-item", { class: [img && img.w > img.h ? "wide" : "", app.store.fresh.has(i.card) ? "fresh" : ""] },
          h("button", { type: "button", onclick: () => app.openCard(i.card), class: img && img.w > img.h ? "wide" : "" },
            img && h("img", { src: img.src, alt: name(i.card) }),
            i.count !== undefined && h("span.count", null, i.count)),
          !app.store.state.game.setupLocked && i.reroll && swapButton(app, i.reroll));
      })))),
    h("p.label", null, "To hand out"),
    h("div.m-checks", null, model.checklist.map((c) => h("label.check", null,
      h("input", { type: "checkbox" }),
      h("span", null, h("b", null, c.title), h("span.detail", null, ...app.markup(c.detail)))))),
    interactionSummary(app, 4),
    playedControl(app));

  const entering = sheetOpen && !shownSheetOpen;
  shownSheetOpen = sheetOpen;
  return h("section", { class: ["m-sheet", sheetOpen ? "open" : "", entering ? "enter" : ""], "aria-label": "Setup" }, handle, body);
}

/** Names wrap between words; a word too long for the tile ("Philosopher's") shrinks the name until it fits. */
export function fitNames() {
  for (const el of document.querySelectorAll<HTMLElement>(".m-name")) {
    el.style.fontSize = "";
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth && size > 6.5) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  }
}

/**
 * Tap selects; holding for half a second opens the full card instead. The press is tracked per
 * element rather than in the closure, because a render in the middle of a press (the long press
 * itself causes one) hands the element new handlers.
 */
const presses = new WeakMap<EventTarget, { timer?: number; long: boolean }>();
function pressHandlers(onTap: () => void, onLongPress: () => void) {
  const state = (e: Event) => { let p = presses.get(e.currentTarget!); if (!p) presses.set(e.currentTarget!, (p = { long: false })); return p; };
  return {
    onpointerdown: (e: Event) => { const p = state(e); p.long = false; window.clearTimeout(p.timer); p.timer = window.setTimeout(() => { p.long = true; onLongPress(); }, 500); },
    onpointerup: (e: Event) => window.clearTimeout(state(e).timer),
    onpointerleave: (e: Event) => window.clearTimeout(state(e).timer),
    onpointercancel: (e: Event) => window.clearTimeout(state(e).timer),
    oncontextmenu: (e: Event) => e.preventDefault(),
    onclick: (e: Event) => { e.stopPropagation(); if (!state(e).long) onTap(); },
  };
}
