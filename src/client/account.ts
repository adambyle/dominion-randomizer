// Accounts and history on the client: history is kept in the browser and, when signed in, synced
// with the server (POST /api/history/sync). Owned boxes sync with the account too.
//
// Signing in merges this device's history into the account. Signing out clears it from the device
// (it's safe on the server) so the next person to use the device doesn't see it.

import { mergeEntries, visible, type HistoryEntry, type HistoryGame, type Me, type SyncResponse } from "../shared/history";
import type { Store } from "./state";

const KEY = "dominion-randomizer:history:v1";

interface Saved {
  entries: HistoryEntry[];
  /** Server cursor from the last successful sync. */
  cursor: number;
  /** Ids changed locally since the last successful sync. */
  dirty: string[];
}

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

  constructor(private store: Store) {
    // Owned boxes follow the account: push local changes while signed in.
    store.subscribe((state, prev) => {
      if (this.status === "signedIn" && state.settings.boxesUpdated !== prev.settings.boxesUpdated) this.queueBoxes();
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
  get pending(): number { return this.saved.dirty.length; }

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
    const { options, boxesUpdated } = this.store.state.settings;
    const me = await api<Me>("/auth/register", { body: { username, password, settings: { enabledBoxes: options.enabledBoxes, updated: boxesUpdated || Date.now() } } });
    this.signedIn(me, true);
  }

  async login(username: string, password: string) {
    const me = await api<Me>("/auth/login", { body: { username, password } });
    this.signedIn(me, true);
  }

  /** Signs out after a last sync; with `force`, even if unsynced changes would be lost. */
  async logout(force = false) {
    if (!force && this.saved.dirty.length) {
      await this.sync();
      if (this.saved.dirty.length) throw new ApiError("Some history hasn't synced yet.", 0);
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
      this.saved.cursor = 0;
      this.persist();
    }
    // Owned boxes: the newer side wins.
    const local = this.store.state.settings;
    if (me.settings && me.settings.updated > local.boxesUpdated) {
      this.store.dispatch({ type: "accountBoxes", enabledBoxes: me.settings.enabledBoxes, updated: me.settings.updated });
    } else if (!me.settings || local.boxesUpdated > me.settings.updated) {
      this.queueBoxes();
    }
    this.changed();
    void this.sync();
  }

  private signedOut() {
    this.status = "signedOut";
    this.username = null;
    this.lastSynced = null;
    this.syncError = null;
    this.saved = { entries: [], cursor: 0, dirty: [] };
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

  remove(ids: string[]) {
    const now = Date.now();
    const gone = new Set(ids);
    this.write(this.saved.entries.filter((e) => gone.has(e.id) && !e.deleted).map((e) => ({ ...e, deleted: true, updated: now })));
  }

  removeAll() { this.remove(this.entries.map((e) => e.id)); }

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
      const res = await api<SyncResponse>("/history/sync", { body: { since: this.saved.cursor, changes: batch } });
      const sentIds = new Set(batch.map((e) => e.id));
      // Entries edited again while the request was out stay dirty.
      const current = new Map(this.saved.entries.map((e) => [e.id, e.updated]));
      this.saved.dirty = this.saved.dirty.filter((id) => !sentIds.has(id) || current.get(id) !== batch.find((e) => e.id === id)?.updated);
      this.saved.entries = mergeEntries(this.saved.entries, res.changes);
      this.saved.cursor = res.cursor;
      this.persist();
      this.lastSynced = Date.now();
      this.syncError = null;
      if (this.saved.dirty.length && batch.length === 400) this.queueSync(0);
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

  private queueBoxes() {
    if (this.boxesTimer) clearTimeout(this.boxesTimer);
    this.boxesTimer = setTimeout(async () => {
      this.boxesTimer = null;
      const { options, boxesUpdated } = this.store.state.settings;
      try {
        const saved = await api<{ enabledBoxes: string[]; updated: number }>("/me/settings", { method: "PUT", body: { enabledBoxes: options.enabledBoxes, updated: boxesUpdated || Date.now() } });
        // The server keeps the newest; adopt it if another device was newer.
        if (saved.updated > this.store.state.settings.boxesUpdated) this.store.dispatch({ type: "accountBoxes", enabledBoxes: saved.enabledBoxes, updated: saved.updated });
      } catch { /* retried on the next change */ }
    }, 800);
  }

  private load(): Saved {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
      if (v && Array.isArray(v.entries)) return { entries: v.entries, cursor: v.cursor ?? 0, dirty: v.dirty ?? [] };
    } catch { /* storage unavailable */ }
    return { entries: [], cursor: 0, dirty: [] };
  }

  private persist() {
    try { localStorage.setItem(KEY, JSON.stringify(this.saved)); } catch { /* storage unavailable */ }
  }
}
