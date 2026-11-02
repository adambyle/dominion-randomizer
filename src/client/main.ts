// App shell: top bar, routing (#/, #/recommended, #/cards, #/sets), overlays and the render loop.

import "./styles.css";
import { h, icon, replace, stepper, type Child } from "./dom";
import { markup } from "./markup";
import { cardImage, recommended } from "./data";
import { Store } from "./state";
import type { RecommendedKingdom } from "../shared/types";
import { tableView } from "./views/table";
import { tableMobileView } from "./views/tableMobile";
import { sheetView } from "./views/sheet";
import { tuneView } from "./views/tune";
import { pickerView } from "./views/picker";
import { welcomeView } from "./views/welcome";
import { recommendedView } from "./views/recommended";
import { cardsView } from "./views/cards";

type Route = "table" | "recommended" | "cards" | "sets";

/** Portrait phones get their own table layout; landscape phones and tablets use the desktop one. */
const PHONE = window.matchMedia("(max-width: 720px)");

export class App {
  store = new Store();
  recommended = recommended;
  private sheet: string[] = [];
  private tune = false;
  private picker: HTMLElement | null = null;
  private root = document.getElementById("app")!;
  /** Overlays opened since the last render; only these play their entrance animation. */
  private entering = new Set<"sheet" | "tune" | "picker">();
  private renderToken = 0;
  private loaded = new Set<string>();
  menuOpen = false;

  constructor() {
    this.store.subscribe((state, prev) => {
      const before = new Set([...prev.game.kingdom, ...prev.game.landscapes]);
      const added = [...state.game.kingdom, ...state.game.landscapes].filter((id) => !before.has(id));
      if (added.length) this.renderAfterImages(added);
      else this.render();
    });
    PHONE.addEventListener("change", () => this.render());
    window.addEventListener("hashchange", () => {
      this.menuOpen = false;
      this.sheet = [];
      this.tune = false;
      this.picker = null;
      this.render();
      window.scrollTo(0, 0);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (this.picker) this.closePicker();
      else if (this.sheet.length) this.closeCard();
      else if (this.tune) this.closeTune();
    });
    this.render();
  }

  get phone() { return PHONE.matches; }

  get route(): Route {
    const r = location.hash.replace(/^#\/?/, "");
    if (r === "recommended" || r === "cards" || r === "sets") return r;
    return this.store.state.settings.onboarded ? "table" : "sets";
  }

  markup = (text: string, onCard?: (id: string) => void) => markup(text, onCard ?? ((id) => this.openCard(id)));

  openCard(id: string, push = false) {
    if (!this.sheet.length) this.entering.add("sheet");
    this.sheet = push ? [...this.sheet, id] : [id];
    this.render();
  }
  backCard() { this.sheet = this.sheet.slice(0, -1); this.render(); }
  closeCard() { this.sheet = []; this.render(); }
  openTune() { this.entering.add("tune"); this.tune = true; this.render(); }
  closeTune() { this.tune = false; this.render(); }
  openPicker() { this.entering.add("picker"); this.picker = pickerView(this); this.render(); }
  closePicker() { this.picker = null; this.render(); }
  openWelcome() { this.tune = false; location.hash = "#/sets"; }

  finishWelcome(deal: boolean) {
    const first = !this.store.state.settings.onboarded;
    this.store.dispatch({ type: "settings", patch: { onboarded: true } });
    if (deal && first && !this.store.state.game.kingdom.length) this.store.dispatch({ type: "deal" });
    location.hash = "#/";
    if (!first) this.render();
  }

  useRecommended(k: RecommendedKingdom) {
    this.store.dispatch({ type: "loadRecommended", kingdom: k });
    location.hash = "#/";
  }

  /**
   * Newly dealt cards: wait (briefly) for their images to download and decode so the table changes
   * in one go instead of popping in card by card.
   */
  private renderAfterImages(ids: string[]) {
    const token = ++this.renderToken;
    const srcs = ids.map((id) => cardImage(id)?.src).filter((s): s is string => !!s && !this.loaded.has(s));
    const loads = srcs.map((src) => {
      const img = new Image();
      img.src = src;
      return img.decode().then(() => this.loaded.add(src), () => undefined);
    });
    const timeout = new Promise((r) => setTimeout(r, 400));
    Promise.race([Promise.all(loads), timeout]).then(() => { if (token === this.renderToken) this.render(); });
  }

  render() {
    this.renderToken++;
    // Keep focus (and caret) in text fields across re-renders.
    const active = document.activeElement as HTMLInputElement | null;
    const focusId = active?.id;
    const caret = active && "selectionStart" in active ? active.selectionStart : null;

    const route = this.route;
    const overlay = this.picker ? "picker" : this.sheet.length ? "sheet" : this.tune ? "tune" : null;
    document.body.classList.toggle("overlay-open", !!overlay);
    document.body.classList.toggle("phone-table", this.phone && route === "table");

    replace(this.root,
      topBar(this, route),
      h("main", { class: `route-${route}` }, this.view(route)),
      h("footer.footer", null,
        "Card images and rulings from the ", h("a", { href: "https://wiki.dominionstrategy.com", target: "_blank", rel: "noreferrer" }, "Dominion Strategy Wiki"),
        ". Dominion is © Donald X. Vaccarino and Rio Grande Games; this is an unofficial fan tool."),
      overlay && h("div.scrim", { class: this.entering.size ? "enter" : "", onclick: () => (this.picker ? this.closePicker() : this.sheet.length ? this.closeCard() : this.closeTune()) }),
      this.tune && withEnter(tuneView(this), this.entering.has("tune")),
      this.sheet.length > 0 && withEnter(sheetView(this, this.sheet), this.entering.has("sheet")),
      this.picker && withEnter(this.picker, this.entering.has("picker")));
    this.entering.clear();

    if (focusId) {
      const el = document.getElementById(focusId) as HTMLInputElement | null;
      if (el) { el.focus(); if (caret !== null) try { el.setSelectionRange(caret, caret); } catch { /* not a text field */ } }
    }
  }

  private view(route: Route): Child {
    switch (route) {
      case "sets": return welcomeView(this);
      case "recommended": return recommendedView(this);
      case "cards": return cardsView(this);
      default: return this.phone ? tableMobileView(this) : tableView(this);
    }
  }
}

function withEnter<T extends Child>(el: T, entering: boolean): T {
  if (el instanceof HTMLElement) el.classList.toggle("enter", entering);
  return el;
}

function topBar(app: App, route: Route): Child {
  const { settings, game } = app.store.state;
  const hasGame = game.kingdom.length > 0 || game.landscapes.length > 0;
  const link = (href: string, label: string, r: Route) =>
    h("a", { href, class: route === r ? "on" : "", "aria-current": route === r ? "page" : undefined }, label);
  const firstRun = !settings.onboarded && route === "sets";
  if (app.phone) {
    return h("header.topbar.m-top", null,
      h("a.mark", { href: "#/" }, "Dominion", h("small", null, "Kingdom randomizer")),
      h("div.spacer"),
      !firstRun && h("div.m-menu-wrap", null,
        h("button.m-menu", { type: "button", "aria-label": "Menu", "aria-expanded": String(app.menuOpen),
          onclick: () => { app.menuOpen = !app.menuOpen; app.render(); } }, icon(app.menuOpen ? "close" : "menu")),
        app.menuOpen && h("nav.m-menu-pop", { "aria-label": "Sections" },
          link("#/", "Table", "table"), link("#/recommended", "Recommended kingdoms", "recommended"),
          link("#/cards", "Cards", "cards"), link("#/sets", "Your sets", "sets"),
          route === "table" && hasGame && h("button", { type: "button", onclick: () => { app.menuOpen = false; app.store.dispatch({ type: "clear" }); } }, "Clear the table"))));
  }
  return h("header.topbar", null,
    h("a.mark", { href: "#/" }, "Dominion", h("small", null, "Kingdom randomizer")),
    !firstRun && h("nav.nav", { "aria-label": "Sections" },
      link("#/", "Table", "table"), link("#/recommended", "Recommended", "recommended"), link("#/cards", "Cards", "cards"),
      link("#/sets", "Your sets", "sets")),
    h("div.spacer"),
    route === "table" && h("div.bar-actions", null,
      h("div.players", null, stepper({ value: settings.players, min: 2, max: 6, label: "players", format: (n) => `${n} players`,
        onChange: (n) => app.store.dispatch({ type: "settings", patch: { players: n } }) })),
      h("button.btn.ghost", { type: "button", onclick: () => app.openPicker(), title: "Choose a card to include" }, icon("plus"), "Add card"),
      hasGame && h("button.btn.ghost", { type: "button", onclick: () => app.store.dispatch({ type: "clear" }), title: "Clear the table" }, "Clear"),
      h("button.btn.ghost", { type: "button", onclick: () => app.openTune() }, icon("tune"), "Tune"),
      h("button.deal", { type: "button", onclick: () => app.store.dispatch({ type: "deal" }),
        title: game.locked.length ? "Deal again, keeping locked cards" : "Deal a random kingdom" }, hasGame ? "Deal again" : "Deal")));
}

new App();
