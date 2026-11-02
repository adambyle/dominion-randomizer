import { Hono } from "hono";
import { DurableObject } from "cloudflare:workers";

export interface Env {
  DB: D1Database;
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

const app = new Hono<{ Bindings: Env }>();
app.get("/api/health", (c) => c.json({ ok: true }));

export default app;

/** Multiplayer room (one per room code). Implemented in a later step. */
export class Room extends DurableObject<Env> {}
