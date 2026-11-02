// History (#/history): kingdoms you marked as played, with multi-select delete. Also the
// "Mark as played" control shown under the table, and the account page (#/account).

import { h, icon, type Child } from "../dom";
import { artImage, byCost, db, name, setName } from "../data";
import { computeStats } from "../../shared/stats";
import { ApiError } from "../account";
import type { HistoryEntry, HistoryGame } from "../../shared/history";
import { MIN_PASSWORD, USERNAME } from "../../shared/history";
import type { App } from "../main";

let selection = new Set<string>();
let confirmAll = false;

const dateFmt = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** Snapshot of the table for history. */
export function currentGame(app: App): HistoryGame | null {
  const { game, settings } = app.store.state;
  const setup = app.store.setup();
  if (!setup || !game.kingdom.length) return null;
  return {
    kingdom: [...game.kingdom], landscapes: [...game.landscapes], players: settings.players,
    platinumColony: setup.platinumColony.used, shelters: setup.shelters.used,
    choices: setup.choices, recommendedId: game.recommendedId,
  };
}

/** "Mark as played" under the table (desktop) and in the Setup sheet (phones). */
export function playedControl(app: App): Child {
  const { game } = app.store.state;
  if (!game.kingdom.length) return null;
  const savedId = game.playedId && app.account.entries.some((e) => e.id === game.playedId) ? game.playedId : null;
  if (savedId) {
    return h("div.played-bar.saved", null,
      icon("check"), h("span", null, "Saved to your ", h("a", { href: "#/history" }, "history"), "."),
      h("button.btn.ghost", { type: "button", onclick: () => { app.account.remove([savedId]); app.store.dispatch({ type: "played", id: null }); } }, "Undo"));
  }
  return h("div.played-bar", null,
    h("span", null, h("b", null, "Played this kingdom?"), " Save it to your history. Changing the table afterwards starts a new draft."),
    h("button.btn", { type: "button", onclick: () => {
      const snapshot = currentGame(app);
      if (!snapshot) return;
      // In a room the room records it, and every member saves it to their history.
      if (app.room.code && app.room.status === "open") app.room.played(snapshot);
      else app.store.dispatch({ type: "played", id: app.account.add(snapshot) });
    } }, icon("check"), "Mark as played"));
}

let tab: "games" | "stats" = "games";

const tabs = (app: App) => h("div.segmented.history-tabs", { role: "tablist", "aria-label": "History views" },
  (["games", "stats"] as const).map((t) => h("button", { type: "button", role: "tab", "aria-selected": String(tab === t), class: tab === t ? "on" : "",
    onclick: () => { tab = t; app.render(); } }, t === "games" ? "Games" : "Stats")));

export function historyView(app: App): Child {
  if (tab === "stats") return statsView(app);
  const { account } = app;
  const entries = account.entries;
  selection = new Set([...selection].filter((id) => entries.some((e) => e.id === id)));
  const rerender = () => app.render();
  const toggle = (id: string, on: boolean) => { if (on) selection.add(id); else selection.delete(id); rerender(); };
  const allSelected = entries.length > 0 && selection.size === entries.length;

  const groups = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const key = dateFmt.format(e.playedAt);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return h("div.page.history-page", null,
    h("div.filters", null,
      h("div.history-title", null, h("h1", null, "History"), tabs(app)),
      h("div.filter-row", null,
        entries.length > 0 && h("label.toggle", null,
          h("input", { type: "checkbox", checked: allSelected, onchange: (e) => {
            selection = (e.target as HTMLInputElement).checked ? new Set(entries.map((x) => x.id)) : new Set(); rerender();
          } }), allSelected ? "All selected" : "Select all"),
        selection.size > 0 && h("button.btn", { type: "button", onclick: () => { account.remove([...selection]); selection.clear(); } },
          icon("trash"), `Delete ${selection.size}`),
        entries.length > 0 && !confirmAll && h("button.btn.ghost", { type: "button", onclick: () => { confirmAll = true; rerender(); } }, "Delete all"),
        confirmAll && h("span.confirm", null, `Delete all ${entries.length} games?`,
          h("button.btn.danger", { type: "button", onclick: () => { confirmAll = false; selection.clear(); account.removeAll(); rerender(); } }, "Delete all"),
          h("button.btn.ghost", { type: "button", onclick: () => { confirmAll = false; rerender(); } }, "Cancel")),
        h("span.muted", null, `${entries.length} ${entries.length === 1 ? "game" : "games"}`),
        syncNote(app))),
    !entries.length && h("div.empty-note", null,
      h("p", null, "No games yet. After you play a kingdom, use ", h("b", null, "Mark as played"), " under the table to save it here."),
      account.status === "signedOut" && h("p", null, h("a", { href: "#/account" }, "Sign in"), " to keep your history on every device.")),
    [...groups].map(([day, list]) => h("section.history-day", null,
      h("h2", null, day),
      h("div.history-list", null, list.map((e) => historyRow(app, e, selection.has(e.id), toggle))))));
}

function historyRow(app: App, e: HistoryEntry, selected: boolean, toggle: (id: string, on: boolean) => void): HTMLElement {
  const g = e.game;
  const cards = g.kingdom.filter((id) => db.byId.has(id)).map((id) => db.get(id)).sort(byCost);
  const rec = g.recommendedId ? app.recommended.find((k) => k.id === g.recommendedId) : null;
  return h("article", { class: ["history-row", selected ? "selected" : ""] },
    h("label.pick", { title: "Select" }, h("input", { type: "checkbox", checked: selected, onchange: (ev) => toggle(e.id, (ev.target as HTMLInputElement).checked) })),
    h("div.history-main", null,
      h("p.history-meta", null,
        h("b", null, rec ? rec.name : timeFmt.format(e.playedAt)),
        h("span.muted", null, [rec && timeFmt.format(e.playedAt), `${g.players} players`, g.platinumColony && "Colony", g.shelters && "Shelters"].filter(Boolean).join(" · "))),
      h("div.history-tiles", null, cards.map((c) => {
        const art = artImage(c.id);
        return h("button.rk-tile", { type: "button", title: c.name, onclick: () => app.openCard(c.id) }, art ? h("img", { src: art.src, alt: c.name, loading: "lazy" }) : c.name);
      })),
      g.landscapes.length > 0 && h("div.rk-landscapes", null, g.landscapes.filter((id) => db.byId.has(id)).map((id) => h("span.chip", null, name(id))))),
    h("button.btn", { type: "button", onclick: () => { app.store.dispatch({ type: "loadHistory", game: g }); location.hash = "#/"; } }, "Set up again"));
}

function statsView(app: App): Child {
  const pool = app.store.pool();
  const st = computeStats(db, app.account.entries, app.account.marks, app.recommended, pool);
  const top = st.topCards.slice(0, 12);
  const max = top[0]?.count ?? 1;
  const unplayedKingdom = st.unplayed.filter((id) => db.get(id).kind === "kingdom").map((id) => db.get(id)).sort(byCost);
  const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
  const played = st.poolSize - st.unplayed.length;
  return h("div.page.history-page", null,
    h("div.filters", null, h("div.history-title", null, h("h1", null, "History"), tabs(app))),
    h("div.stat-tiles", null,
      statTile(String(st.games), st.games === 1 ? "game played" : "games played"),
      statTile(`${pct(played, st.poolSize)}%`, `of your cards played (${played} of ${st.poolSize})`),
      statTile(`${st.recommendedDone} / ${st.recommendedPlayable}`, "recommended kingdoms done", "#/recommended")),
    !st.games && !played && h("p.empty-note", null, "Stats fill in as you mark games as played."),
    top.length > 0 && h("section.stat-section", null,
      h("h2", null, "Most played cards"),
      h("ol.bars", null, top.map((c) => h("li", null,
        h("button.link.plain", { type: "button", onclick: () => app.openCard(c.id) }, name(c.id)),
        h("span.bar", { style: `--w:${(100 * c.count) / max}%` }),
        h("span.muted", null, String(c.count)))))),
    st.sets.length > 0 && h("section.stat-section", null,
      h("h2", null, "Expansions"),
      h("table.stat-table", null,
        h("thead", null, h("tr", null, h("th", null, "Expansion"), h("th", null, "Games"), h("th", null, "Cards played"))),
        h("tbody", null, st.sets.map((x) => h("tr", null, h("td", null, setName(x.set)), h("td", null, x.games), h("td", null, x.cards)))))),
    unplayedKingdom.length > 0 && played > 0 && h("section.stat-section", null,
      h("h2", null, `Kingdom cards you haven't played (${unplayedKingdom.length})`),
      h("p.muted", null, "From the sets you own. To see more of them, set Tune → Cards you've played to “Less often” or “Skip”."),
      h("p.unplayed", null, unplayedKingdom.map((c, i) => [i > 0 && ", ", h("button.link", { type: "button", onclick: () => app.openCard(c.id) }, c.name)]))));
}

function statTile(value: string, label: string, href?: string): HTMLElement {
  const body = [h("b", null, value), h("span", null, label)];
  return href ? h("a.stat-tile", { href }, body) : h("div.stat-tile", null, body);
}

function syncNote(app: App): Child {
  const a = app.account;
  if (a.status === "signedIn") {
    const text = a.syncing ? "Syncing…" : a.syncError ? `Not synced: ${a.syncError}` : a.pending ? `${a.pending} waiting to sync` : `Synced to ${a.username}`;
    return h("span", { class: ["sync-note", a.syncError ? "error" : ""] }, text);
  }
  if (a.status === "signedOut") return h("a.sync-note", { href: "#/account" }, "Saved on this device only — sign in to sync");
  if (a.status === "unavailable") return h("span.sync-note", null, "Saved on this device");
  return null;
}

// ---- Account page

let mode: "signin" | "register" = "signin";
let formError: string | null = null;
let busy = false;
let confirmDelete = false;
let signOutWarning = false;
/** Field values survive re-renders (the page is rebuilt on every state change). */
const fields = { username: "", password: "", confirm: "" };
const keep = (k: keyof typeof fields) => (e: Event) => { fields[k] = (e.target as HTMLInputElement).value; };

export function accountView(app: App): Child {
  const a = app.account;
  const rerender = () => app.render();
  const run = async (fn: () => Promise<void>) => {
    busy = true; formError = null; rerender();
    try { await fn(); } catch (err) { formError = err instanceof Error ? err.message : "Something went wrong."; }
    busy = false; rerender();
  };

  if (a.status === "checking") return h("div.page.account-page", null, h("h1", null, "Account"), h("p.muted", null, "Checking…"));
  if (a.status === "unavailable") {
    return h("div.page.account-page", null, h("h1", null, "Account"),
      h("p", null, "Accounts aren't available right now. Your history and sets are saved on this device."));
  }

  if (a.status === "signedIn") {
    return h("div.page.account-page", null,
      h("h1", null, "Account"),
      h("p.lede", null, "Signed in as ", h("b", null, a.username)),
      h("ul.account-facts", null,
        h("li", null, `${a.entries.length} ${a.entries.length === 1 ? "game" : "games"} in your `, h("a", { href: "#/history" }, "history"), ". ", syncNote(app)),
        h("li", null, "Your ", h("a", { href: "#/sets" }, "sets"), " are saved to your account and used on every device you sign in on.")),
      formError && h("p.form-error", { role: "alert" }, formError),
      h("div.row", null,
        h("button.btn", { type: "button", disabled: busy, onclick: () => run(async () => {
          try { await a.logout(signOutWarning); signOutWarning = false; }
          catch (err) { if (err instanceof ApiError && err.status === 0) { signOutWarning = true; throw new Error("Some history hasn't synced yet. Sign out anyway to lose it, or try again when you're online."); } throw err; }
        }) }, signOutWarning ? "Sign out anyway" : "Sign out"),
        a.status === "signedIn" && h("button.btn.ghost", { type: "button", disabled: busy, onclick: () => void a.sync() }, "Sync now")),
      h("details.danger-zone", { open: confirmDelete, ontoggle: (e: Event) => { confirmDelete = (e.target as HTMLDetailsElement).open; } },
        h("summary", null, "Delete account"),
        h("p", null, "This deletes your account and its history from the server. Enter your password to confirm."),
        h("form.account-form", { onsubmit: (e: Event) => {
          e.preventDefault();
          const pw = (new FormData(e.target as HTMLFormElement).get("password") as string) ?? "";
          void run(() => a.deleteAccount(pw));
        } },
          h("input", { type: "password", name: "password", autocomplete: "current-password", placeholder: "Password", required: true }),
          h("button.btn.danger", { type: "submit", disabled: busy }, "Delete my account"))));
  }

  const register = mode === "register";
  return h("div.page.account-page", null,
    h("h1", null, register ? "Create an account" : "Sign in"),
    h("p.lede", null, "Keep your history and sets on every device. Without an account they're saved on this device only."),
    h("form.account-form", { onsubmit: (e: Event) => {
      e.preventDefault();
      const f = new FormData(e.target as HTMLFormElement);
      const username = String(f.get("username") ?? "").trim();
      const password = String(f.get("password") ?? "");
      if (register) {
        if (!USERNAME.test(username)) { formError = "Usernames are 3–32 letters, numbers, dots, dashes or underscores."; rerender(); return; }
        if (password.length < MIN_PASSWORD) { formError = `Passwords need at least ${MIN_PASSWORD} characters.`; rerender(); return; }
        if (password !== String(f.get("confirm") ?? "")) { formError = "The passwords don't match."; rerender(); return; }
      }
      void run(async () => {
        if (register) await a.register(username, password); else await a.login(username, password);
        fields.password = fields.confirm = "";
        location.hash = "#/history";
      });
    } },
      h("label", null, "Username", h("input#account-username", { name: "username", value: fields.username, oninput: keep("username"), autocomplete: "username", required: true, autocapitalize: "off", spellcheck: "false" })),
      h("label", null, "Password", h("input#account-password", { type: "password", name: "password", value: fields.password, oninput: keep("password"), autocomplete: register ? "new-password" : "current-password", required: true, minlength: register ? MIN_PASSWORD : undefined })),
      register && h("label", null, "Confirm password", h("input#account-confirm", { type: "password", name: "confirm", value: fields.confirm, oninput: keep("confirm"), autocomplete: "new-password", required: true })),
      formError && h("p.form-error", { role: "alert" }, formError),
      h("button.deal", { type: "submit", disabled: busy }, busy ? "…" : register ? "Create account" : "Sign in"),
      a.entries.length > 0 && h("p.muted.small", null, `The ${a.entries.length} ${a.entries.length === 1 ? "game" : "games"} saved on this device will be added to the account.`)),
    h("p", null, register ? "Already have an account? " : "New here? ",
      h("button.link", { type: "button", onclick: () => { mode = register ? "signin" : "register"; formError = null; rerender(); } }, register ? "Sign in" : "Create an account")));
}
