// D1 schema and queries for accounts, sessions and history.
//
// The schema is created on first use (CREATE ... IF NOT EXISTS), so a fresh database needs no
// migration step. Add new columns/tables here with idempotent statements.

import type { AccountSettings, HistoryEntry, RecommendedMark } from "../shared/history";
import type { PasswordHash } from "./auth";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pw_hash TEXT NOT NULL,
    pw_salt TEXT NOT NULL,
    pw_iterations INTEGER NOT NULL,
    settings TEXT,
    created INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  // rev: a per-database counter, bumped on every write, so clients can ask for "changes since".
  `CREATE TABLE IF NOT EXISTS history (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    updated INTEGER NOT NULL,
    rev INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS history_rev ON history(user_id, rev)`,
  // Recommended kingdoms marked played or crossed off; synced like history (shares the counter).
  `CREATE TABLE IF NOT EXISTS marks (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    updated INTEGER NOT NULL,
    rev INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS marks_rev ON marks(user_id, rev)`,
  `CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
  // Failed sign-ins, for throttling password guessing.
  `CREATE TABLE IF NOT EXISTS login_failures (username TEXT NOT NULL COLLATE NOCASE, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS login_failures_user ON login_failures(username, at)`,
];

let ready: Promise<unknown> | null = null;

/** Creates the tables once per Worker instance. */
export function ensureSchema(db: D1Database) {
  ready ??= db.batch(SCHEMA.map((s) => db.prepare(s))).catch((err) => { ready = null; throw err; });
  return ready;
}

export interface UserRow {
  id: string;
  username: string;
  pw_hash: string;
  pw_salt: string;
  pw_iterations: number;
  settings: string | null;
}

export const findUserByName = (db: D1Database, username: string) =>
  db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<UserRow>();

export const findUserBySession = (db: D1Database, tokenHash: string, now: number) =>
  db.prepare(`SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires > ?`).bind(tokenHash, now).first<UserRow>();

export async function createUser(db: D1Database, id: string, username: string, pw: PasswordHash, settings: AccountSettings | null, now: number) {
  await db.prepare(`INSERT INTO users (id, username, pw_hash, pw_salt, pw_iterations, settings, created) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, username, pw.hash, pw.salt, pw.iterations, settings ? JSON.stringify(settings) : null, now).run();
}

export const deleteUser = (db: D1Database, userId: string) => db.batch([
  db.prepare("DELETE FROM history WHERE user_id = ?").bind(userId),
  db.prepare("DELETE FROM marks WHERE user_id = ?").bind(userId),
  db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
  db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
]);

export const updatePassword = (db: D1Database, userId: string, pw: PasswordHash) =>
  db.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iterations = ? WHERE id = ?").bind(pw.hash, pw.salt, pw.iterations, userId).run();

export const saveSettings = (db: D1Database, userId: string, settings: AccountSettings) =>
  db.prepare("UPDATE users SET settings = ? WHERE id = ?").bind(JSON.stringify(settings), userId).run();

export const createSession = (db: D1Database, tokenHash: string, userId: string, now: number, expires: number) =>
  db.prepare("INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)").bind(tokenHash, userId, now, expires).run();

export const deleteSession = (db: D1Database, tokenHash: string) =>
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();

export const pruneSessions = (db: D1Database, userId: string, now: number) =>
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND expires <= ?").bind(userId, now).run();

export async function recentFailures(db: D1Database, username: string, since: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE username = ? AND at > ?").bind(username, since).first<{ n: number }>();
  return row?.n ?? 0;
}

export const recordFailure = (db: D1Database, username: string, now: number, keepAfter: number) => db.batch([
  db.prepare("INSERT INTO login_failures (username, at) VALUES (?, ?)").bind(username, now),
  db.prepare("DELETE FROM login_failures WHERE at <= ?").bind(keepAfter),
]);

export const clearFailures = (db: D1Database, username: string) =>
  db.prepare("DELETE FROM login_failures WHERE username = ?").bind(username).run();

/** Upserts rows into a synced table (history or marks): newest `updated` wins, each write gets a new rev. */
function upserts(db: D1Database, table: "history" | "marks", userId: string, rows: { id: string; updated: number }[]) {
  return rows.flatMap((e) => [
    db.prepare(`INSERT INTO counters (name, value) VALUES ('history', 1)
      ON CONFLICT(name) DO UPDATE SET value = value + 1`),
    db.prepare(`INSERT INTO ${table} (user_id, id, updated, rev, data)
      VALUES (?1, ?2, ?3, (SELECT value FROM counters WHERE name = 'history'), ?4)
      ON CONFLICT(user_id, id) DO UPDATE SET updated = excluded.updated, rev = excluded.rev, data = excluded.data
      WHERE excluded.updated > ${table}.updated`).bind(userId, e.id, e.updated, JSON.stringify(e)),
  ]);
}

/**
 * Applies a client's changes (newest `updated` wins per entry) and returns everything that changed
 * on the server after `since`, with the new cursor.
 */
export async function syncHistory(db: D1Database, userId: string, since: number, changes: HistoryEntry[], marks: RecommendedMark[]) {
  const stmts = [...upserts(db, "history", userId, changes), ...upserts(db, "marks", userId, marks)];
  if (stmts.length) await db.batch(stmts);
  const [h, m] = await db.batch<{ rev: number; data: string }>([
    db.prepare("SELECT rev, data FROM history WHERE user_id = ? AND rev > ? ORDER BY rev").bind(userId, since),
    db.prepare("SELECT rev, data FROM marks WHERE user_id = ? AND rev > ? ORDER BY rev").bind(userId, since),
  ]);
  const hr = h?.results ?? [];
  const mr = m?.results ?? [];
  const cursor = Math.max(since, ...hr.map((r) => r.rev), ...mr.map((r) => r.rev));
  return {
    cursor,
    changes: hr.map((r) => JSON.parse(r.data) as HistoryEntry),
    marks: mr.map((r) => JSON.parse(r.data) as RecommendedMark),
  };
}
