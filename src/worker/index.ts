import { Hono } from "hono";

// Static assets (the app, card data, images) are served by Workers Assets; this Worker only
// handles /api/*. Accounts, history and rooms will live here (see docs/ROADMAP.md).

export interface Env {
  ASSETS: Fetcher;
}

const app = new Hono<{ Bindings: Env }>();
app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
