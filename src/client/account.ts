// Accounts and history on the client: history is kept in the browser and, when signed in, synced
// with the server (POST /api/history/sync). Owned boxes sync with the account too.
//
// Signing in merges this device's history into the account. Signing out clears it from the device
// (it's safe on the server) so the next person to use the device doesn't see it.

import { mergeEntries, mergeMarks, visible, type AccountSettings, type HistoryEntry, type HistoryGame, type Me, type RecommendedMark, type SyncResponse } from "../shared/history";
import type { Store } from "./state";

const KEY = "dominion-randomizer:history:v1";

interface Saved {
  entries: HistoryEntry[];
  /** Server cursor from the last successful sync. */
  cursor: number;
  /** Ids changed locally since the last successful sync. */
  dirty: string[];
  /** Recommended kingdoms marked played or crossed off. */
  marks: RecommendedMark[];
  /** Mark ids changed locally since the last successful sync. */
  dirtyMarks: string[];
}

const emptySaved = (): Saved => ({ entries: [], cursor: 0, dirty: [], marks: [], dirtyMarks: [] });

export type AccountStatus = "checking" | "unavailable" | "signedOut" | "signedIn";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* not JSON (e.g. the dev server without a Worker) */ }
  if (!res.ok) throw new ApiError((data as { error?: string } | null)?.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

const newId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export class Account {
  status: AccountStatus = "checking";
  username: string | null = null;
  syncing = false;
  syncError: string | null = null;
  lastSynced: number | null = null;
  private saved: Saved = this.load();
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private boxesTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: (() => void)[] = [];
  private wasInRoom = false;

  constructor(private store: Store) {
    // Owned boxes follow the account: push local changes while signed in.
    store.subscribe((state, prev) => {
      const leftRoom = this.wasInRoom && !store.roomMode;
      this.wasInRoom = store.roomMode;
      if (this.status !== "signedIn") return;
      // In a room the boxes are the room's, so nothing is pushed until the player is back to their own settings.
      if (leftRoom || state.settings.prefsUpdated !== prev.settings.prefsUpdated || state.settings.boxesUpdated !== prev.settings.boxesUpdated) this.queueBoxes();
    });
    window.addEventListener("online", () => this.queueSync(0));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") this.queueSync(0); });
    // Pick up changes from other devices while the app is open.
    setInterval(() => { if (document.visibilityState === "visible") this.queueSync(0); }, 60_000);
  }

  subscribe(fn: () => void) { this.listeners.push(fn); }
  private changed() { for (const fn of this.listeners) fn(); }

  /** Live history, newest first. */
  get entries(): HistoryEntry[] { return visible(this.saved.entries); }
  get pending(): number { return this.saved.dirty.length + this.saved.dirtyMarks.length; }
  /** Marks on recommended kingdoms (including cleared ones). */
  get marks(): RecommendedMark[] { return this.saved.marks; }

  async init() {
    try {
      const me = await api<Me>("/me");
      this.signedIn(me, false);
    } catch (err) {
      this.status = err instanceof ApiError && err.status === 401 ? "signedOut" : "unavailable";
      this.changed();
    }
  }

  async register(username: string, password: string) {
    const me = await api<Me>("/auth/register", { body: { username, password, settings: this.localSettings() } });
    this.signedIn(me, true);
  }

  async login(username: string, password: string) {
    const me = await api<Me>("/auth/login", { body: { username, password } });
    this.signedIn(me, true);
  }

  /** Signs out after a last sync; with `force`, even if unsynced changes would be lost. */
  async logout(force = false) {
    if (!force && this.pending) {
      await this.sync();
      if (this.pending) throw new ApiError("Some history hasn't synced yet.", 0);
    }
    try { await api("/auth/logout", { body: {} }); } catch { /* the cookie may already be gone */ }
    this.signedOut();
  }

  async deleteAccount(password: string) {
    await api("/me/delete", { body: { password } });
    this.signedOut();
  }

  private signedIn(me: Me, fresh: boolean) {
    this.status = "signedIn";
    this.username = me.username;
    if (fresh) {
      // Everything on this device joins the account.
      this.saved.dirty = this.saved.entries.map((e) => e.id);
      this.saved.dirtyMarks = this.saved.marks.map((m) => m.id);
      this.saved.cursor = 0;
      this.persist();
    }
    // Owned boxes and card weights: the newer side wins, each on its own.
    const local = this.store.state.settings;
    let push = false;
    if (this.store.roomMode) {
      // In a room the sets belong to the room; personal ones sync after leaving.
    } else if (me.settings && me.settings.updated > local.boxesUpdated) {
      this.store.dispatch({ type: "accountBoxes", enabledBoxes: me.settings.enabledBoxes, updated: me.settings.updated });
    } else if (!me.settings || local.boxesUpdated > me.settings.updated) {
      push = true;
    }
    const remotePrefs = me.settings?.prefsUpdated ?? 0;
    if (me.settings?.cardPrefs && remotePrefs > local.prefsUpdated) {
      this.store.dispatch({ type: "accountPrefs", cardPrefs: me.settings.cardPrefs, updated: remotePrefs });
    } else if (local.prefsUpdated > remotePrefs) {
      push = true;
    }
    if (push) this.queueBoxes();
    this.changed();
    void this.sync();
  }

  private signedOut() {
    this.status = "signedOut";
    this.username = null;
    this.lastSynced = null;
    this.syncError = null;
    this.saved = emptySaved();
    this.persist();
    this.changed();
  }

  // ---- History

  /** Saves the table as a played game and returns the new entry's id. */
  add(game: HistoryGame): string {
    const now = Date.now();
    const entry: HistoryEntry = { id: newId(), playedAt: now, updated: now, game };
    this.write([entry]);
    return entry.id;
  }

  /** Saves a game played in a room under the room's shared id (once). */
  addShared(id: string, playedAt: number, game: HistoryGame) {
    if (this.saved.entries.some((e) => e.id === id)) return;
    this.write([{ id, playedAt, updated: Date.now(), game }]);
  }

  remove(ids: string[]) {
    const now = Date.now();
    const gone = new Set(ids);
    this.write(this.saved.entries.filter((e) => gone.has(e.id) && !e.deleted).map((e) => ({ ...e, deleted: true, updated: now })));
  }

  removeAll() { this.remove(this.entries.map((e) => e.id)); }

  /** Marks a recommended kingdom played or crossed off ("none" clears the mark). */
  mark(id: string, status: RecommendedMark["status"]) {
    const m: RecommendedMark = { id, status, updated: Date.now() };
    this.saved.marks = mergeMarks(this.saved.marks, [m]);
    this.saved.dirtyMarks = [...new Set([...this.saved.dirtyMarks, id])];
    this.persist();
    this.changed();
    this.queueSync();
  }

  private write(changes: HistoryEntry[]) {
    if (!changes.length) return;
    this.saved.entries = mergeEntries(this.saved.entries, changes);
    this.saved.dirty = [...new Set([...this.saved.dirty, ...changes.map((e) => e.id)])];
    this.persist();
    this.changed();
    this.queueSync();
  }

  // ---- Sync

  queueSync(delay = 1500) {
    if (this.status !== "signedIn") return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => { this.syncTimer = null; void this.sync(); }, delay);
  }

  async sync() {
    if (this.status !== "signedIn" || this.syncing) return;
    this.syncing = true;
    this.changed();
    try {
      const dirty = new Set(this.saved.dirty);
      const sent = this.saved.entries.filter((e) => dirty.has(e.id));
      // Batches stay under the server's limit; the loop picks up anything left.
      const batch = sent.slice(0, 400);
      const dirtyMarks = new Set(this.saved.dirtyMarks);
      const marks = this.saved.marks.filter((m) => dirtyMarks.has(m.id)).slice(0, Math.max(0, 450 - batch.length));
      const res = await api<SyncResponse>("/history/sync", { body: { since: this.saved.cursor, changes: batch, marks } });
      const markNow = new Map(this.saved.marks.map((m) => [m.id, m.updated]));
      this.saved.dirtyMarks = this.saved.dirtyMarks.filter((id) => { const sentMark = marks.find((m) => m.id === id); return !sentMark || markNow.get(id) !== sentMark.updated; });
      this.saved.marks = mergeMarks(this.saved.marks, res.marks ?? []);
      const sentIds = new Set(batch.map((e) => e.id));
      // Entries edited again while the request was out stay dirty.
      const current = new Map(this.saved.entries.map((e) => [e.id, e.updated]));
      this.saved.dirty = this.saved.dirty.filter((id) => !sentIds.has(id) || current.get(id) !== batch.find((e) => e.id === id)?.updated);
      this.saved.entries = mergeEntries(this.saved.entries, res.changes);
      this.saved.cursor = res.cursor;
      this.persist();
      this.lastSynced = Date.now();
      this.syncError = null;
      if (this.pending && (batch.length === 400 || marks.length < dirtyMarks.size)) this.queueSync(0);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.status = "signedOut";
        this.username = null;
      }
      this.syncError = err instanceof Error ? err.message : "Sync failed.";
    } finally {
      this.syncing = false;
      this.changed();
    }
  }

  /** This device's owned boxes and card weights, as account settings. */
  private localSettings(): AccountSettings {
    const { options, boxesUpdated, cardPrefs, prefsUpdated } = this.store.state.settings;
    return { enabledBoxes: options.enabledBoxes, updated: boxesUpdated || Date.now(), cardPrefs, prefsUpdated };
  }

  private queueBoxes() {
    if (this.store.roomMode) return;
    if (this.boxesTimer) clearTimeout(this.boxesTimer);
    this.boxesTimer = setTimeout(async () => {
      this.boxesTimer = null;
      if (this.store.roomMode) return;
      try {
        const saved = await api<AccountSettings>("/me/settings", { method: "PUT", body: this.localSettings() });
        // The server keeps the newest; adopt it if another device was newer.
        const now = this.store.state.settings;
        if (saved.updated > now.boxesUpdated) this.store.dispatch({ type: "accountBoxes", enabledBoxes: saved.enabledBoxes, updated: saved.updated });
        if (saved.cardPrefs && (saved.prefsUpdated ?? 0) > now.prefsUpdated) this.store.dispatch({ type: "accountPrefs", cardPrefs: saved.cardPrefs, updated: saved.prefsUpdated ?? 0 });
      } catch { /* retried on the next change */ }
    }, 800);
  }

  private load(): Saved {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
      if (v && Array.isArray(v.entries)) return { ...emptySaved(), ...v };
    } catch { /* storage unavailable */ }
    return emptySaved();
  }

  private persist() {
    try { localStorage.setItem(KEY, JSON.stringify(this.saved)); } catch { /* storage unavailable */ }
  }
}
