// The Room Durable Object: one per room code. Holds the shared table state and the room's played
// games, and relays changes between connected clients over WebSockets (hibernation API, so idle
// rooms cost nothing). Rooms are deleted after two weeks without activity.

import { DurableObject } from "cloudflare:workers";
import { isHistoryEntry } from "../shared/history";
import {
  MAX_NAME, MAX_STATE_BYTES, ROOM_HISTORY_LIMIT,
  type ClientMessage, type RoomMember, type RoomPlayed, type RoomState, type ServerMessage,
} from "../shared/room";
import { randomId } from "./auth";

const IDLE_MS = 14 * 86_400_000;

interface Attachment { id: string; name: string; boxes: string[]; joined: boolean }

export class Room extends DurableObject {
  /** POST /init (from the Worker when a room is created) and GET /ws (WebSocket upgrade). */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/init") {
      await this.ctx.storage.put("code", url.searchParams.get("code") ?? "");
      await this.touch();
      return new Response("ok");
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: randomId(9), name: "", boxes: [], joined: false } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > MAX_STATE_BYTES + 1000) return this.send(ws, { t: "error", message: "Message too large." });
    let msg: ClientMessage;
    try { msg = JSON.parse(raw) as ClientMessage; } catch { return; }
    const me = ws.deserializeAttachment() as Attachment;
    await this.touch();

    switch (msg.t) {
      case "hello": {
        if (!(await this.ctx.storage.get<string>("code"))) {
          // Never created (or expired): tell the client, then close.
          this.send(ws, { t: "error", message: "There's no room with that code.", code: "no-room" });
          ws.close(4404, "No such room");
          return;
        }
        me.name = cleanName(msg.name);
        me.boxes = Array.isArray(msg.boxes) ? msg.boxes.filter((b) => typeof b === "string" && b.length <= 64).slice(0, 200) : [];
        me.joined = true;
        ws.serializeAttachment(me);
        const [state, version, history, code] = await Promise.all([
          this.ctx.storage.get<RoomState>("state"), this.ctx.storage.get<number>("version"),
          this.ctx.storage.get<RoomPlayed[]>("history"), this.ctx.storage.get<string>("code"),
        ]);
        this.send(ws, { t: "welcome", code: code ?? "", you: me.id, members: this.members(), state: state ?? null, version: version ?? 0, history: history ?? [] });
        this.broadcast({ t: "members", members: this.members() }, ws);
        return;
      }
      case "rename": {
        me.name = cleanName(msg.name);
        ws.serializeAttachment(me);
        this.broadcast({ t: "members", members: this.members() });
        return;
      }
      case "state": {
        if (!me.joined || !msg.state || typeof msg.state !== "object") return;
        const state: RoomState = { settings: msg.state.settings, game: msg.state.game };
        if (JSON.stringify(state).length > MAX_STATE_BYTES) return this.send(ws, { t: "error", message: "Table state too large." });
        const version = ((await this.ctx.storage.get<number>("version")) ?? 0) + 1;
        await this.ctx.storage.put({ state, version });
        // Everyone else adopts it; the sender already has it.
        this.broadcast({ t: "state", state, version, by: me.id }, ws);
        return;
      }
      case "played": {
        if (!me.joined) return;
        const played: RoomPlayed = { id: randomId(12), playedAt: Date.now(), game: msg.game, by: me.name };
        if (!isHistoryEntry({ id: played.id, playedAt: played.playedAt, updated: played.playedAt, game: played.game })) {
          return this.send(ws, { t: "error", message: "Bad game." });
        }
        const history = [played, ...((await this.ctx.storage.get<RoomPlayed[]>("history")) ?? [])].slice(0, ROOM_HISTORY_LIMIT);
        await this.ctx.storage.put("history", history);
        this.broadcast({ t: "played", played });
        return;
      }
    }
  }

  override async webSocketClose(ws: WebSocket) {
    ws.close();
    this.broadcast({ t: "members", members: this.members(ws) }, ws);
  }

  override async webSocketError(ws: WebSocket) {
    this.broadcast({ t: "members", members: this.members(ws) }, ws);
  }

  override async alarm() {
    // Idle for two weeks: forget the room.
    const sockets = this.ctx.getWebSockets();
    if (sockets.length) return this.touch();
    await this.ctx.storage.deleteAll();
  }

  private async touch() {
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
  }

  private members(except?: WebSocket): RoomMember[] {
    return this.ctx.getWebSockets()
      .filter((s) => s !== except && s.readyState === WebSocket.OPEN)
      .map((s) => s.deserializeAttachment() as Attachment)
      .filter((a) => a.joined)
      .map(({ id, name, boxes }) => ({ id, name, boxes }));
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try { ws.send(JSON.stringify(msg)); } catch { /* closed */ }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket) {
    const text = JSON.stringify(msg);
    for (const s of this.ctx.getWebSockets()) {
      if (s === except) continue;
      const a = s.deserializeAttachment() as Attachment | null;
      if (!a?.joined) continue;
      try { s.send(text); } catch { /* closed */ }
    }
  }
}

function cleanName(name: unknown): string {
  const s = typeof name === "string" ? name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_NAME) : "";
  return s || "Player";
}
