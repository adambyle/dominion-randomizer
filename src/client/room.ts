// The client side of a multiplayer room: a WebSocket to the Room Durable Object. While connected,
// the store is in room mode: the table and shared settings come from the room, and local changes
// are sent to it. Leaving (or failing to rejoin) restores the player's own table.

import type { HistoryGame } from "../shared/history";
import { normalizeCode, ROOM_CODE, type RoomMember, type RoomPlayed, type ServerMessage } from "../shared/room";
import type { Account } from "./account";
import type { SharedState, Store } from "./state";

const ROOM_KEY = "dominion-randomizer:room";
const NAME_KEY = "dominion-randomizer:name";

export type RoomStatus = "idle" | "connecting" | "open" | "reconnecting";

const sameKingdom = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export class RoomClient {
  status: RoomStatus = "idle";
  code: string | null = null;
  you: string | null = null;
  members: RoomMember[] = [];
  history: RoomPlayed[] = [];
  error: string | null = null;
  /** Boxes the player owns (their own setting, captured when joining). */
  myBoxes: string[] = [];
  private ws: WebSocket | null = null;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: (() => void)[] = [];

  constructor(private store: Store, private account: Account) {}

  subscribe(fn: () => void) { this.listeners.push(fn); }
  private changed() { for (const fn of this.listeners) fn(); }

  get name(): string {
    try { return localStorage.getItem(NAME_KEY) || this.account.username || "Player"; } catch { return "Player"; }
  }
  set name(v: string) {
    try { localStorage.setItem(NAME_KEY, v); } catch { /* storage unavailable */ }
    this.send({ t: "rename", name: v });
    this.changed();
  }

  /** The room to rejoin after a reload. */
  get saved(): string | null {
    try { return localStorage.getItem(ROOM_KEY); } catch { return null; }
  }

  async create() {
    this.error = null;
    const res = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (!res.ok) throw new Error("Couldn't create a room. Try again.");
    const { code } = await res.json() as { code: string };
    this.join(code);
    return code;
  }

  join(raw: string) {
    const code = normalizeCode(raw);
    if (!ROOM_CODE.test(code)) { this.error = "Room codes are 3 letters."; this.changed(); return; }
    if (this.code === code && this.status !== "idle") return;
    // Switching rooms: back to your own table first, so a new room starts from it.
    if (this.code) this.close(true);
    this.code = code;
    this.error = null;
    this.retries = 0;
    if (!this.store.roomMode) this.myBoxes = [...this.store.state.settings.options.enabledBoxes];
    try { localStorage.setItem(ROOM_KEY, code); } catch { /* storage unavailable */ }
    this.connect();
  }

  leave() {
    this.close(true);
    this.changed();
  }

  /** Records the table as played for everyone in the room. */
  played(game: HistoryGame) { this.send({ t: "played", game }); }

  private connect() {
    if (!this.code) return;
    this.status = this.retries ? "reconnecting" : "connecting";
    this.changed();
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/rooms/${this.code}/ws`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", name: this.name, boxes: this.myBoxes }));
    ws.onmessage = (e) => { try { this.handle(JSON.parse(String(e.data)) as ServerMessage); } catch { /* ignore bad messages */ } };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (e.code === 4404) { this.close(true); this.error = "There's no room with that code (rooms expire after two weeks unused)."; this.changed(); return; }
      if (!this.code) return;
      // Keep the room's table while reconnecting.
      this.retries++;
      this.status = "reconnecting";
      this.changed();
      this.retryTimer = setTimeout(() => this.connect(), Math.min(15_000, 500 * 2 ** this.retries));
    };
  }

  private handle(msg: ServerMessage) {
    switch (msg.t) {
      case "welcome": {
        this.status = "open";
        this.retries = 0;
        this.you = msg.you;
        this.members = msg.members;
        this.history = msg.history;
        this.store.roomMode = true;
        this.store.onShared = (s: SharedState) => this.send({ t: "state", state: s });
        // A new room starts from this player's table and settings.
        if (msg.state) this.store.adopt(msg.state as SharedState);
        else this.send({ t: "state", state: this.store.shared() });
        for (const p of msg.history) this.account.addShared(p.id, p.playedAt, p.game);
        break;
      }
      case "members": this.members = msg.members; break;
      case "state": this.store.adopt(msg.state as SharedState); break;
      case "played": {
        this.history = [msg.played, ...this.history.filter((p) => p.id !== msg.played.id)];
        this.account.addShared(msg.played.id, msg.played.playedAt, msg.played.game);
        if (sameKingdom(this.store.state.game.kingdom, msg.played.game.kingdom)) this.store.dispatch({ type: "played", id: msg.played.id });
        break;
      }
      case "error":
        this.error = msg.message;
        break;
    }
    this.changed();
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private close(forget: boolean) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    if (forget) {
      this.code = null;
      this.status = "idle";
      this.members = [];
      this.history = [];
      try { localStorage.removeItem(ROOM_KEY); } catch { /* storage unavailable */ }
      if (this.store.roomMode) this.store.leaveRoom();
    }
  }
}
