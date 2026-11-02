import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  isAccountSettings, isHistoryEntry, isRecommendedMark, MAX_PASSWORD, MIN_PASSWORD, USERNAME,
  type AccountSettings, type Me, type SyncResponse,
} from "../shared/history";
import { hashPassword, randomId, SESSION_COOKIE, SESSION_DAYS, sha256, verifyPassword } from "./auth";
import * as q from "./db";
import { Room } from "./room";
import { ROOM_ALPHABET, ROOM_CODE } from "../shared/room";

export { Room };

// Static assets (the app, card data, images) are served by Workers Assets; this Worker only
// handles /api/*: accounts, synced history and settings. Multiplayer rooms will live here too
// (see docs/ROADMAP.md).

export interface Env {
  ASSETS: Fetcher;
  /** Multiplayer rooms (src/worker/room.ts). */
  ROOMS: DurableObjectNamespace<Room>;
  /** Optional: without it the API answers 503 and the app stays local-only. */
  DB?: D1Database;
}

type Vars = { db: D1Database; user: q.UserRow | null; tokenHash: string | null };
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

const DAY = 86_400_000;
const MAX_FAILURES = 10;
const FAILURE_WINDOW = 15 * 60_000;
const MAX_SYNC_CHANGES = 500;

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.get("/api/health", (c) => c.json({ ok: true, accounts: !!c.env.DB }));

// Rooms don't need accounts or D1: a code names a Durable Object.
app.post("/api/rooms", async (c) => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const code = [...bytes].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join("");
  await c.env.ROOMS.get(c.env.ROOMS.idFromName(code)).fetch(`https://room/init?code=${code}`, { method: "POST" });
  return c.json({ code });
});

app.get("/api/rooms/:code/ws", async (c) => {
  const code = c.req.param("code").toUpperCase();
  if (!ROOM_CODE.test(code)) return c.json({ error: "That isn't a room code." }, 400);
  if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "Expected a WebSocket." }, 426);
  return c.env.ROOMS.get(c.env.ROOMS.idFromName(code)).fetch(c.req.raw) as unknown as Promise<Response>;
});

// Everything else needs the database and a JSON body (which also blocks simple cross-site forms).
app.use("/api/*", async (c, next) => {
  const db = c.env.DB;
  if (!db) return c.json({ error: "Accounts aren't set up on this server." }, 503);
  if (c.req.method !== "GET" && !c.req.header("content-type")?.startsWith("application/json")) {
    return c.json({ error: "Expected JSON." }, 415);
  }
  await q.ensureSchema(db);
  c.set("db", db);
  const token = getCookie(c, SESSION_COOKIE);
  const tokenHash = token ? await sha256(token) : null;
  c.set("tokenHash", tokenHash);
  c.set("user", tokenHash ? await q.findUserBySession(db, tokenHash, Date.now()) : null);
  await next();
  c.header("Cache-Control", "no-store");
});

async function body(c: Ctx): Promise<Record<string, unknown>> {
  try {
    const v = await c.req.json();
    return v && typeof v === "object" ? v as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

const parseSettings = (s: string | null): AccountSettings | null => {
  if (!s) return null;
  try { const v = JSON.parse(s); return isAccountSettings(v) ? v : null; } catch { return null; }
};
const me = (user: q.UserRow): Me => ({ username: user.username, settings: parseSettings(user.settings) });

async function startSession(c: Ctx, userId: string) {
  const token = randomId(32);
  const now = Date.now();
  await q.createSession(c.var.db, await sha256(token), userId, now, now + SESSION_DAYS * DAY);
  await q.pruneSessions(c.var.db, userId, now);
  setCookie(c, SESSION_COOKIE, token, {
    path: "/api", httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", maxAge: SESSION_DAYS * 86_400,
  });
}

function credentials(b: Record<string, unknown>) {
  const username = typeof b.username === "string" ? b.username.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";
  return { username, password };
}

app.post("/api/auth/register", async (c) => {
  const b = await body(c);
  const { username, password } = credentials(b);
  if (!USERNAME.test(username)) return c.json({ error: "Usernames are 3–32 letters, numbers, dots, dashes or underscores." }, 400);
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return c.json({ error: `Passwords need at least ${MIN_PASSWORD} characters.` }, 400);
  if (await q.findUserByName(c.var.db, username)) return c.json({ error: "That username is taken." }, 409);
  // A new account starts with the sets chosen on this device.
  const settings = isAccountSettings(b.settings) ? b.settings : null;
  const id = randomId();
  try {
    await q.createUser(c.var.db, id, username, await hashPassword(password), settings, Date.now());
  } catch {
    return c.json({ error: "That username is taken." }, 409);
  }
  await startSession(c, id);
  return c.json({ username, settings } satisfies Me);
});

app.post("/api/auth/login", async (c) => {
  const { username, password } = credentials(await body(c));
  const now = Date.now();
  if (await q.recentFailures(c.var.db, username, now - FAILURE_WINDOW) >= MAX_FAILURES) {
    return c.json({ error: "Too many attempts. Try again in a few minutes." }, 429);
  }
  const user = username ? await q.findUserByName(c.var.db, username) : null;
  const ok = user && await verifyPassword(password, { hash: user.pw_hash, salt: user.pw_salt, iterations: user.pw_iterations });
  if (!user || !ok) {
    await q.recordFailure(c.var.db, username, now, now - FAILURE_WINDOW);
    return c.json({ error: "Wrong username or password." }, 401);
  }
  await q.clearFailures(c.var.db, username);
  await startSession(c, user.id);
  return c.json(me(user));
});

app.post("/api/auth/logout", async (c) => {
  if (c.var.tokenHash) await q.deleteSession(c.var.db, c.var.tokenHash);
  deleteCookie(c, SESSION_COOKIE, { path: "/api" });
  return c.json({ ok: true });
});

// Routes below need a signed-in user.
app.use("/api/me/*", async (c, next) => { if (!c.var.user) return c.json({ error: "Not signed in." }, 401); await next(); });
app.use("/api/history/*", async (c, next) => { if (!c.var.user) return c.json({ error: "Not signed in." }, 401); await next(); });

app.get("/api/me", (c) => (c.var.user ? c.json(me(c.var.user)) : c.json({ error: "Not signed in." }, 401)));

app.put("/api/me/settings", async (c) => {
  const b = await body(c);
  if (!isAccountSettings(b)) return c.json({ error: "Bad settings." }, 400);
  const current = parseSettings(c.var.user!.settings);
  // Newest wins, so a stale device can't overwrite a newer choice.
  if (current && current.updated >= b.updated) return c.json(current);
  const settings: AccountSettings = { enabledBoxes: b.enabledBoxes, updated: b.updated };
  await q.saveSettings(c.var.db, c.var.user!.id, settings);
  return c.json(settings);
});

app.post("/api/me/delete", async (c) => {
  const { password } = credentials(await body(c));
  const user = c.var.user!;
  if (!await verifyPassword(password, { hash: user.pw_hash, salt: user.pw_salt, iterations: user.pw_iterations })) {
    return c.json({ error: "Wrong password." }, 401);
  }
  await q.deleteUser(c.var.db, user.id);
  deleteCookie(c, SESSION_COOKIE, { path: "/api" });
  return c.json({ ok: true });
});

app.post("/api/history/sync", async (c) => {
  const b = await body(c);
  const since = Number.isInteger(b.since) && (b.since as number) >= 0 ? b.since as number : 0;
  const changes = Array.isArray(b.changes) ? b.changes : [];
  const marks = Array.isArray(b.marks) ? b.marks : [];
  if (changes.length + marks.length > MAX_SYNC_CHANGES) return c.json({ error: `Send at most ${MAX_SYNC_CHANGES} changes at a time.` }, 413);
  if (!changes.every(isHistoryEntry)) return c.json({ error: "Bad history entry." }, 400);
  if (!marks.every(isRecommendedMark)) return c.json({ error: "Bad kingdom mark." }, 400);
  const result: SyncResponse = await q.syncHistory(c.var.db, c.var.user!.id, since, changes, marks);
  return c.json(result);
});

app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));

export default app;
