// App shell: top bar, routing (#/, #/recommended, #/cards, #/rules[/topic], #/history, #/account,
// #/sets), overlays and the render loop.

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
import { rulesView } from "./views/rules";
import { accountView, historyView } from "./views/history";
import { interactionsView } from "./views/interactions";
import { roomView } from "./views/room";
import { referenceCards, referenceView } from "./views/reference";
import { qrView } from "./views/qr";
import { RoomClient } from "./room";
import { Account } from "./account";
import { playedCards } from "../shared/stats";

type Route = "table" | "recommended" | "cards" | "rules" | "interactions" | "history" | "account" | "room" | "sets";

/** Portrait phones get their own table layout; landscape phones and tablets use the desktop one. */
const PHONE = window.matchMedia("(max-width: 720px)");

export class App {
  store = new Store();
  account = new Account(this.store);
  room = new RoomClient(this.store, this.account);
  recommended = recommended;
  private sheet: string[] = [];
  private tune = false;
  private picker: HTMLElement | null = null;
  /** The card showing in the rules reference of a locked table. */
  private reference: string | null = null;
  private qr = false;
  /** Open the rules reference once the next navigation lands (it resets overlays). */
  private pendingReference = false;
  private root = document.getElementById("app")!;
  /** Overlays opened since the last render; only these play their entrance animation. */
  private entering = new Set<"sheet" | "tune" | "picker" | "qr">();
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
    this.store.played = () => new Set(playedCards(this.account.entries, this.account.marks, recommended).keys());
    this.account.subscribe(() => this.render());
    this.room.subscribe(() => this.render());
    // Back into the room you were in before a reload.
    const roomLink = /^#\/?room\/([A-Za-z]{3})(?![A-Za-z0-9])/.exec(location.hash)?.[1];
    if (!roomLink && this.room.saved) this.room.join(this.room.saved);
    void this.account.init();
    PHONE.addEventListener("change", () => this.render());
    window.addEventListener("resize", () => this.measureTopBar());
    window.addEventListener("hashchange", () => {
      if (this.route === "history" || this.route === "account") this.account.queueSync(0);
      this.menuOpen = false;
      this.sheet = [];
      this.tune = false;
      this.picker = null;
      this.qr = false;
      this.reference = null;
      if (this.pendingReference) { this.pendingReference = false; this.reference = this.firstReference(); }
      this.render();
      window.scrollTo(0, 0);
    });
    window.addEventListener("keydown", (e) => {
      const covered = this.picker || this.sheet.length || this.qr || this.tune;
      if (this.reference && !covered && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const cards = referenceCards(this);
        const next = cards[cards.indexOf(this.reference) + (e.key === "ArrowRight" ? 1 : -1)];
        if (next) this.showReference(next);
      }
      if (e.key !== "Escape") return;
      if (this.picker) this.closePicker();
      else if (this.sheet.length) this.closeCard();
      else if (this.qr) this.closeQr();
      else if (this.tune) this.closeTune();
      else if (this.reference) this.closeReference();
    });
    this.render();
  }

  get phone() { return PHONE.matches; }

  get route(): Route {
    const r = location.hash.replace(/^#\/?/, "");
    if (r === "recommended" || r === "cards" || r === "sets" || r === "history" || r === "account") return r;
    if (r === "rules" || r.startsWith("rules/")) return "rules";
    if (r === "interactions" || r.startsWith("interactions/")) return "interactions";
    if (r === "room" || r.startsWith("room/")) return "room";
    // Joining a room from a link skips the first-visit set picker: the room has its sets.
    return this.store.state.settings.onboarded || this.store.roomMode ? "table" : "sets";
  }

  markup = (text: string, onCard?: (id: string) => void) => markup(text, onCard ?? ((id) => this.openCard(id)));

  openCard(id: string, push = false) {
    if (!this.sheet.length) this.entering.add("sheet");
    this.sheet = push ? [...this.sheet, id] : [id];
    this.render();
  }
  backCard() { this.sheet = this.sheet.slice(0, -1); this.render(); }
  closeCard() { this.sheet = []; this.render(); }
  openTune(section?: "expansions") {
    this.entering.add("tune");
    this.tune = true;
    this.render();
    if (section) requestAnimationFrame(() => document.querySelector(`[data-section="${section}"]`)?.scrollIntoView({ block: "start" }));
  }
  closeTune() { this.tune = false; this.render(); }
  openPicker() { this.entering.add("picker"); this.picker = pickerView(this); this.render(); }
  closePicker() { this.picker = null; this.render(); }
  openQr() { this.entering.add("qr"); this.qr = true; this.render(); }
  closeQr() { this.qr = false; this.render(); }

  private firstReference() {
    return this.store.state.game.setupLocked ? referenceCards(this)[0] ?? null : null;
  }
  /** Opens the rules reference on a card of the locked table. */
  openReference(id?: string) { this.reference = id ?? this.firstReference(); this.render(); }
  showReference(id: string) { this.reference = id; this.render(); }
  closeReference() { this.reference = null; this.render(); }
  /** Goes to the table and opens the rules reference there (used when joining a locked room from its QR code). */
  goToReference() {
    if (this.pendingReference) return;
    if (location.hash === "#/" || location.hash === "") { this.openReference(); return; }
    this.pendingReference = true;
    location.hash = "#/";
  }
  lockSetup(on: boolean) { this.store.dispatch({ type: "lockSetup", on }); }

  /** Tapping a card: on a locked table straight to its rules, otherwise `otherwise`. */
  tap(id: string, otherwise: () => void) {
    if (this.store.state.game.setupLocked && referenceCards(this).includes(id)) this.openReference(id);
    else otherwise();
  }

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
    // The reference only stays up while the table is locked and still has the card.
    const { game } = this.store.state;
    if (this.reference && !(game.setupLocked && referenceCards(this).includes(this.reference))) this.reference = null;
    if (this.qr && (!this.room.code || !game.setupLocked)) this.qr = false;
    const overlay = this.picker ? "picker" : this.sheet.length ? "sheet" : this.qr ? "qr" : this.tune ? "tune" : null;
    document.body.classList.toggle("overlay-open", !!overlay || !!this.reference);
    document.body.classList.toggle("phone-table", this.phone && route === "table");

    replace(this.root,
      topBar(this, route),
      h("main", { class: `route-${route}` }, this.view(route)),
      h("footer.footer", null,
        "Card images and rulings from the ", h("a", { href: "https://wiki.dominionstrategy.com", target: "_blank", rel: "noreferrer" }, "Dominion Strategy Wiki"),
        ". Dominion is © Donald X. Vaccarino and Rio Grande Games; this is an unofficial fan tool."),
      overlay && h("div.scrim", { class: this.entering.size ? "enter" : "", onclick: () => (this.picker ? this.closePicker() : this.sheet.length ? this.closeCard() : this.qr ? this.closeQr() : this.closeTune()) }),
      this.reference && referenceView(this, this.reference),
      this.tune && withEnter(tuneView(this), this.entering.has("tune")),
      this.sheet.length > 0 && withEnter(sheetView(this, this.sheet), this.entering.has("sheet")),
      this.qr && withEnter(qrView(this), this.entering.has("qr")),
      this.picker && withEnter(this.picker, this.entering.has("picker")));
    this.entering.clear();
    this.measureTopBar();

    if (focusId) {
      const el = document.getElementById(focusId) as HTMLInputElement | null;
      if (el) { el.focus(); if (caret !== null) try { el.setSelectionRange(caret, caret); } catch { /* not a text field */ } }
    }
  }

  /** Sticky page headers sit right under the top bar, whose height varies with the layout (and is fractional). They tuck 1px under it so no gap shows. */
  private measureTopBar() {
    const bar = this.root.querySelector<HTMLElement>(".topbar");
    if (bar) document.documentElement.style.setProperty("--topbar-h", `${Math.floor(bar.getBoundingClientRect().height) - 1}px`);
  }

  private view(route: Route): Child {
    switch (route) {
      case "sets": return welcomeView(this);
      case "recommended": return recommendedView(this);
      case "cards": return cardsView(this);
      case "history": return historyView(this);
      case "room": return roomView(this, location.hash.replace(/^#\/?room\/?/, "") || null);
      case "interactions": {
        const [a = null, b = null] = location.hash.replace(/^#\/?interactions\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
        return interactionsView(this, a, b);
      }
      case "account": return accountView(this);
      case "rules": return rulesView(this, decodeURIComponent(location.hash.replace(/^#\/?rules\/?/, "")) || null);
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
      roomChip(app),
      !firstRun && h("div.m-menu-wrap", null,
        h("button.m-menu", { type: "button", "aria-label": "Menu", "aria-expanded": String(app.menuOpen),
          onclick: () => { app.menuOpen = !app.menuOpen; app.render(); } }, icon(app.menuOpen ? "close" : "menu")),
        app.menuOpen && h("nav.m-menu-pop", { "aria-label": "Sections" },
          link("#/", "Table", "table"), link("#/recommended", "Recommended kingdoms", "recommended"),
          link("#/cards", "Cards", "cards"), link("#/rules", "Rules", "rules"), link("#/interactions", "Interactions", "interactions"),
          link("#/history", "History", "history"), link("#/room", app.room.code ? `Room ${app.room.code}` : "Play together", "room"),
          link("#/sets", app.store.roomMode ? "Room's sets" : "Your sets", "sets"), link("#/account", accountLabel(app), "account"),
          route === "table" && hasGame && !game.setupLocked && h("button", { type: "button", onclick: () => { app.menuOpen = false; app.store.dispatch({ type: "clear" }); } }, "Clear the table"))));
  }
  return h("header.topbar", null,
    h("a.mark", { href: "#/" }, "Dominion", h("small", null, "Kingdom randomizer")),
    !firstRun && h("nav.nav", { "aria-label": "Sections" },
      link("#/", "Table", "table"), link("#/recommended", "Recommended", "recommended"), link("#/cards", "Cards", "cards"),
      link("#/rules", "Rules", "rules"), link("#/interactions", "Interactions", "interactions"), link("#/history", "History", "history"),
      !app.room.code && link("#/room", "Play together", "room"), link("#/sets", app.store.roomMode ? "Room's sets" : "Your sets", "sets")),
    h("div.spacer"),
    roomChip(app),
    !firstRun && h("a.account-link", { href: "#/account", class: route === "account" ? "on" : "", title: "Account" }, icon("user"),
      h("span", null, app.account.status === "signedIn" ? app.account.username : "Sign in")),
    route === "table" && game.setupLocked && h("div.bar-actions", null,
      h("span.locked-note", null, icon("lock"), "Table locked"),
      h("button.btn.ghost", { type: "button", onclick: () => app.openReference() }, icon("info"), "Rules"),
      app.room.code && h("button.btn.ghost", { type: "button", onclick: () => app.openQr() }, icon("qr"), "Join code"),
      h("button.btn.ghost", { type: "button", onclick: () => app.lockSetup(false), title: "Unlock the table to change it" }, icon("unlock"), "Unlock")),
    route === "table" && !game.setupLocked && h("div.bar-actions", null,
      h("div.players", null, stepper({ value: settings.players, min: 2, max: 6, label: "players", format: (n) => `${n} players`,
        onChange: (n) => app.store.dispatch({ type: "settings", patch: { players: n } }) })),
      h("button.btn.ghost", { type: "button", onclick: () => app.openPicker(), title: "Choose a card to include" }, icon("plus"), "Add card"),
      hasGame && h("button.btn.ghost", { type: "button", onclick: () => app.store.dispatch({ type: "clear" }), title: "Clear the table" }, "Clear"),
      hasGame && h("button.btn.ghost", { type: "button", onclick: () => app.lockSetup(true), title: "Lock the table: tapping a card then goes straight to its rules" }, icon("lock"), "Lock"),
      h("button.btn.ghost", { type: "button", onclick: () => app.openTune() }, icon("tune"), "Tune"),
      h("button.deal", { type: "button", onclick: () => app.store.dispatch({ type: "deal" }),
        title: game.locked.length ? "Deal again, keeping locked cards" : "Deal a random kingdom" }, hasGame ? "Deal again" : "Deal")));
}

/** "Room ABC123 · 3" while in a room. */
function roomChip(app: App): Child {
  const r = app.room;
  if (!r.code) return null;
  return h("a.room-chip", { href: "#/room", class: r.status === "open" ? "" : "offline", title: r.status === "open" ? "In a room" : "Reconnecting" },
    h("span.dot"), h("b", null, r.code), h("span", null, ` · ${r.members.length || 1}`));
}

function accountLabel(app: App) {
  return app.account.status === "signedIn" ? `Account (${app.account.username})` : "Sign in";
}

new App();
