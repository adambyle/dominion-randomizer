// Game history: kingdoms the user confirmed they played. Stored in the browser and, when signed
// in, synced with the server (src/worker). Shared by both sides.
//
// A kingdom on the table is a draft until the user marks it played; that creates a history entry
// from a snapshot of the table. Editing the table afterwards starts a new draft and never changes
// the played entry.

import type { Choices } from "./setup";

export interface HistoryGame {
  kingdom: string[];
  landscapes: string[];
  players: number;
  platinumColony: boolean;
  shelters: boolean;
  /** The resolved setup choices (Bane, Ally, Druid's Boons ...), so the game can be set up again. */
  choices: Choices;
  /** Set when the kingdom was an unmodified recommended kingdom. */
  recommendedId: string | null;
}

export interface HistoryEntry {
  /** Random id made by the client that created the entry. */
  id: string;
  /** When it was played (ms since epoch). */
  playedAt: number;
  /** Last change (ms since epoch); the newest version of an entry wins when syncing. */
  updated: number;
  /** Deleted entries are kept as tombstones so the deletion syncs to other devices. */
  deleted?: boolean;
  game: HistoryGame;
}

/** Newest version of each entry, by `updated` (ties keep the existing one). */
export function mergeEntries(current: HistoryEntry[], incoming: HistoryEntry[]): HistoryEntry[] {
  const byId = new Map(current.map((e) => [e.id, e]));
  for (const e of incoming) {
    const existing = byId.get(e.id);
    if (!existing || e.updated > existing.updated) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => b.playedAt - a.playedAt || a.id.localeCompare(b.id));
}

/** Live (non-deleted) entries, newest first. */
export const visible = (entries: HistoryEntry[]) => entries.filter((e) => !e.deleted);

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const CARD = /^[a-z0-9-]{1,64}$/;

/** Validates an entry from an untrusted source (the server checks everything clients send). */
export function isHistoryEntry(v: unknown): v is HistoryEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Partial<HistoryEntry>;
  const g = e.game as Partial<HistoryGame> | undefined;
  const ids = (a: unknown, max: number) => Array.isArray(a) && a.length <= max && a.every((x) => typeof x === "string" && CARD.test(x));
  return typeof e.id === "string" && ID.test(e.id)
    && Number.isFinite(e.playedAt) && Number.isFinite(e.updated)
    && (e.deleted === undefined || typeof e.deleted === "boolean")
    && !!g && typeof g === "object"
    && ids(g.kingdom, 20) && ids(g.landscapes, 10)
    && Number.isInteger(g.players) && g.players! >= 1 && g.players! <= 6
    && typeof g.platinumColony === "boolean" && typeof g.shelters === "boolean"
    && !!g.choices && typeof g.choices === "object" && JSON.stringify(g.choices).length <= 4000
    && (g.recommendedId === null || (typeof g.recommendedId === "string" && g.recommendedId.length <= 128));
}

/** Synced per-account preferences. */
export interface AccountSettings {
  /** Boxes the user owns: the default card pool and the "only sets I own" filters. */
  enabledBoxes: string[];
  updated: number;
}

export function isAccountSettings(v: unknown): v is AccountSettings {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<AccountSettings>;
  return Array.isArray(s.enabledBoxes) && s.enabledBoxes.length <= 200
    && s.enabledBoxes.every((b) => typeof b === "string" && b.length <= 64)
    && Number.isFinite(s.updated);
}

export const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 256;

/** POST /api/history/sync */
export interface SyncRequest {
  /** The `cursor` from the last successful sync (0 for the first). */
  since: number;
  changes: HistoryEntry[];
}
export interface SyncResponse {
  cursor: number;
  /** Server versions changed since `since` (including ones just sent, if they won). */
  changes: HistoryEntry[];
}

export interface Me {
  username: string;
  settings: AccountSettings | null;
}
