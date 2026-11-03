// The table: Supply column, Kingdom (two rows of five), landscapes, the "off to the side" tray and
// the before-you-start checklist. Hovering anything lights up what it's connected to.

import { h, icon, type Child } from "../dom";
import { cardImage, db, name, recommended, setIcon, setName } from "../data";
import { buildModel, type TableItem } from "../model";
import type { App } from "../main";
import { playedControl } from "./history";
import { interactionSummary } from "./interactions";

const BASICS_PREVIEW = ["copper", "silver", "gold", "estate", "duchy", "province", "curse"];

/** What the pointer is over, kept across re-renders so a click doesn't replay the fade. */
let hovered: { attr: "id" | "roots" | "set"; value: string } | null = null;
let promptCleanup: (() => void) | null = null;

function face(id: string, cls = "face", lazy = false) {
  const img = cardImage(id);
  const card = db.get(id);
  return img
    ? h("img", { class: cls, src: img.src, width: img.w, height: img.h, alt: card.name, loading: lazy ? "lazy" : undefined, decoding: "async", draggable: "false" })
    : h("div", { class: `${cls} face-missing` }, card.name);
}

export function tableView(app: App): Child {
  const { game, settings } = app.store.state;
  const setup = app.store.setup();
  const model = setup ? buildModel(setup, game.kingdom, game.landscapes) : null;
  const size = settings.options.kingdomSize;
  const open = (id: string) => app.openCard(id);
  /** Cards of the table: on a locked table they go straight to their rules. */
  const openOwn = (id: string) => app.tap(id, () => open(id));
  const frozen = game.setupLocked;
  const dispatch = app.store.dispatch;

  // ---- Supply column
  const supplyItems: TableItem[] = model?.supply ?? BASICS_PREVIEW.map((id) => ({ card: id, roots: [] }));
  const supply = h("div.supply", null,
    h("p.label", null, "Supply"),
    h("div.basics", null, supplyItems.map((item) =>
      h("button.mini", { type: "button", "data-roots": item.roots.join(" "), title: item.label ?? name(item.card), onclick: () => open(item.card) },
        face(item.card),
        item.count !== undefined && h("span.count", null, item.count),
        item.label && h("span.mini-label", null, item.label)))));

  // ---- Kingdom
  const bringsSomething = new Set([
    ...(model?.tray ?? []).flatMap((g) => g.roots),
    ...(model?.checklist ?? []).filter((c) => c.key !== "deck").flatMap((c) => c.roots),
    ...(model?.extraKingdom ?? []).flatMap((i) => i.roots),
    ...(model?.landscapes ?? []).filter((l) => !game.landscapes.includes(l.card)).flatMap((l) => l.roots),
  ]);
  const tools = (id: string, locked: boolean) => h("div.tools", null,
    h("button", { type: "button", title: locked ? "Unlock" : "Lock (keep when dealing again)", "aria-label": locked ? "Unlock" : "Lock",
      onclick: () => dispatch({ type: "toggleLock", id }) }, icon(locked ? "unlock" : "lock")),
    h("button", { type: "button", title: "Swap for another card", "aria-label": "Swap", onclick: () => dispatch({ type: "replace", id }) }, icon("swap")),
    h("button", { type: "button", title: "Remove", "aria-label": "Remove", onclick: () => dispatch({ type: "remove", id }) }, icon("close")));
  const pile = (id: string) => {
    const locked = game.locked.includes(id);
    const targets = model?.targetedBy.get(id) ?? [];
    const count = model?.pileCounts.get(id);
    return h("div.pile", { "data-id": id, "data-set": db.get(id).set, class: [locked ? "locked" : "", app.store.fresh.has(id) ? "fresh" : ""] },
      h("button.pile-card", { type: "button", onclick: () => openOwn(id), "aria-label": `${name(id)} — ${frozen ? "rules" : "details"}` }, face(id)),
      locked && !frozen && h("span.lockmark", { title: "Locked: dealing again keeps it" }, icon("lock")),
      bringsSomething.has(id) && h("span.dot", { title: "Needs extra setup — hover to see" }, "+"),
      count !== undefined && h("span.count", { title: `${count} cards in the pile` }, count),
      targets.map((t) => h("span.ribbon", { title: `${name(t)} applies to this pile` }, name(t))),
      !frozen && tools(id, locked));
  };
  const kingdomIds = model?.kingdom ?? [];
  const slots = frozen ? 0 : Math.max(0, size - kingdomIds.length);
  const cols = Math.min(6, Math.max(5, Math.ceil(Math.max(size, kingdomIds.length) / 2)));
  const rec = game.recommendedId ? recommended.find((k) => k.id === game.recommendedId) : null;
  const sets = game.sets ?? [...new Set([...game.kingdom, ...game.landscapes].map((id) => db.get(id).set))];
  const empty = !kingdomIds.length && !game.landscapes.length;

  const kingdom = h("div.kingdom-area", null,
    h("div.area-head", null,
      h("p.label", null, rec ? h("span", null, "Kingdom · ", h("span.rec-name", null, rec.name)) : "Kingdom"),
      // Names when there are a few sets; just the icons when the kingdom spans many.
      h("div.set-icons", null, sets.map((s) => {
        const img = setIcon(s);
        const compact = sets.length > 4;
        return h("span.set-chip", { "data-set-key": s, title: setName(s), class: [game.sets?.includes(s) ? "rolled" : "", compact ? "icon-only" : ""] },
          img && h("img", { src: img.src, alt: compact ? setName(s) : "" }), !compact && setName(s));
      }), h("button.set-edit", { type: "button", title: "Choose expansions", "aria-label": "Choose expansions", onclick: () => app.openTune("expansions") }, icon("tune")))),
    h("div.kingdom", { style: `--cols:${cols}` },
      kingdomIds.map(pile),
      Array.from({ length: slots }, (_, i) => h("button.slot", {
        type: "button", onclick: () => app.openPicker(), "aria-label": "Add a card", title: "Add a card", tabindex: empty && i > 0 ? "-1" : undefined,
      }, icon("plus")))),
    empty && h("div.empty-cta", null,
      h("p", null, "Deal a random kingdom, choose a recommended one, or build your own."),
      h("div.row", null,
        h("button.deal.big", { type: "button", onclick: () => dispatch({ type: "deal" }) }, "Deal"),
        h("button.btn", { type: "button", onclick: () => app.openPicker() }, icon("plus"), "Add cards"),
        h("a.btn", { href: "#/recommended" }, "Recommended kingdoms"))),
    model && model.landscapes.length > 0 && h("div.landscape-area", null,
      h("p.label", null, "Landscapes"),
      h("div.landscapes", null, model.landscapes.map((l) => {
        const own = game.landscapes.includes(l.card);
        const locked = game.locked.includes(l.card);
        return h("div.landscape", {
          "data-id": own ? l.card : undefined, "data-roots": own ? undefined : l.roots.join(" "), "data-set": db.get(l.card).set,
          class: [locked ? "locked" : "", own && app.store.fresh.has(l.card) ? "fresh" : ""],
        },
          h("button.pile-card", { type: "button", onclick: () => (own ? openOwn(l.card) : open(l.card)), "aria-label": `${name(l.card)} — ${frozen && own ? "rules" : "details"}` }, face(l.card)),
          l.note && h("span.caption", null, l.note),
          locked && !frozen && h("span.lockmark", null, icon("lock")),
          own && !frozen && tools(l.card, locked));
      }))));

  // ---- Off to the side
  const trayItem = (item: TableItem) =>
    h("button.tray-card", { type: "button", onclick: () => open(item.card), title: item.label ?? name(item.card) },
      face(item.card, isWide(item.card) ? "face wide" : "face"),
      item.count !== undefined && h("span.count", null, item.count),
      item.note && h("span.caption", null, item.note));
  const tray = model && (model.tray.length > 0 || model.extraKingdom.length > 0) && h("div.tray", null,
    h("p.label", null, "Off to the side"),
    model.extraKingdom.map((x) => h("div.group.extra", { "data-roots": x.roots.join(" ") },
      h("h4", null, h("b", null, x.note ?? "Extra pile"), " · in the Supply"),
      h("div.cards", null, trayItem(x)))),
    model.tray.map((g) => h("div.group", { "data-roots": g.roots.join(" ") },
      h("h4", null, g.by ? h("button.link.plain", { type: "button", onclick: () => open(g.by!) }, h("b", null, name(g.by))) : h("b", null, "Rules"), ` · ${g.what}`),
      h("div.cards", null, g.items.map(trayItem)))));

  const table = h("section.table", { class: [tray ? "has-tray" : "", empty ? "is-empty" : ""] }, supply, kingdom, tray);

  // ---- Before you start
  const checklist = model && h("section#checklist.checklist", { "aria-label": "Setup checklist" },
    h("p.label", null, "Setup checklist"),
    h("div.checks", null, model.checklist.map((c) => h("label.check", { "data-roots": c.roots.join(" ") },
      h("input", { type: "checkbox" }),
      h("span", null, h("b", null, c.title), h("span.detail", null, ...app.markup(c.detail)))))));
  const prompt = checklist && h("button.checklist-prompt", { type: "button", onclick: () => checklist.scrollIntoView({ behavior: "smooth", block: "start" }) },
    "Setup checklist", h("span.prompt-count", null, model!.checklist.length), icon("back", "down"));

  const view = h("div.table-view", null,
    game.warnings.length > 0 && h("div.notice", null, game.warnings.join(" ")),
    setup && setup.warnings.length > 0 && h("div.notice", null, setup.warnings.join(" ")),
    table, checklist, model && interactionSummary(app), model && playedControl(app), prompt);
  wireHover(view, table);

  // The prompt shows only while the checklist is still below the screen: not once it is in view or scrolled past.
  promptCleanup?.();
  promptCleanup = null;
  if (checklist && prompt) {
    prompt.classList.add("hidden");
    const update = () => prompt.classList.toggle("hidden", checklist.getBoundingClientRect().top < window.innerHeight - 24);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    promptCleanup = () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
    requestAnimationFrame(update);
  }
  return view;
}

function isWide(id: string) {
  const img = cardImage(id);
  return !!img && img.w > img.h;
}

/**
 * Hovering a pile lights up everything that exists because of it (and vice versa); hovering an
 * expansion icon lights up that expansion's cards. Everything else steps back — but only when
 * something on the table itself lights up, so a hover never dims the table for no visible reason.
 */
function wireHover(view: HTMLElement, table: HTMLElement) {
  const clear = () => {
    view.classList.remove("focus");
    view.querySelectorAll(".lit").forEach((e) => e.classList.remove("lit"));
  };
  const apply = (attr: "id" | "roots" | "set", value: string) => {
    clear();
    const self = attr === "set" ? view.querySelector(`[data-set-key="${CSS.escape(value)}"]`) : view.querySelector(`[data-${attr}="${CSS.escape(value)}"]`);
    if (!self) return;
    let litOnTable = 0;
    const lite = (el: Element) => { el.classList.add("lit"); if (table.contains(el) && el !== self) litOnTable++; };
    if (attr === "set") {
      view.querySelectorAll(`[data-set="${CSS.escape(value)}"]`).forEach(lite);
    } else {
      const ids = attr === "id" ? [value] : value.split(" ").filter(Boolean);
      for (const el of view.querySelectorAll<HTMLElement>("[data-roots]")) {
        if (el === self) continue;
        const roots = (el.dataset.roots ?? "").split(" ");
        if (ids.some((id) => roots.includes(id))) lite(el);
      }
      if (attr === "roots") for (const id of ids) view.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach(lite);
    }
    if (!litOnTable) return;
    self.classList.add("lit");
    view.classList.add("focus");
  };
  const targetOf = (el: Element | null) => el?.closest<HTMLElement>("[data-id], [data-roots]:not([data-roots='']), [data-set-key]") ?? null;

  view.addEventListener("mouseover", (e) => {
    const target = targetOf(e.target as Element);
    if (!target) { hovered = null; clear(); return; }
    const next = target.dataset.setKey ? { attr: "set" as const, value: target.dataset.setKey }
      : target.dataset.id ? { attr: "id" as const, value: target.dataset.id }
      : { attr: "roots" as const, value: target.dataset.roots! };
    if (hovered && hovered.attr === next.attr && hovered.value === next.value) return;
    hovered = next;
    apply(next.attr, next.value);
  });
  view.addEventListener("mouseleave", () => { hovered = null; clear(); });

  // Re-apply the hover from before this render, synchronously, so nothing animates.
  if (hovered) apply(hovered.attr, hovered.value);
}
