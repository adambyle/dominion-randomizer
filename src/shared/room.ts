// Multiplayer rooms: the messages exchanged between clients and the Room Durable Object
// (src/worker/room.ts). A room shares the table's *inputs* (Kingdom, landscapes, locks, choices,
// seed) and the room's settings; every client resolves the setup itself with the seeded engine,
// so everyone sees the same thing without the server knowing any game rules.

import type { HistoryGame } from "./history";

/** Room codes: 6 characters, no easily confused letters or digits. */
export const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
export const normalizeCode = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export interface RoomMember {
  /** Random per-connection id. */
  id: string;
  name: string;
  /** Boxes this member owns (for "combine everyone's sets"). */
  boxes: string[];
}

/** The shared part of the client state (kept opaque to the server, apart from size limits). */
export interface RoomState {
  settings: unknown;
  game: unknown;
}

export interface RoomPlayed {
  /** Shared history id: every member saves the game under this id. */
  id: string;
  playedAt: number;
  game: HistoryGame;
  by: string;
}

export type ClientMessage =
  | { t: "hello"; name: string; boxes: string[] }
  | { t: "state"; state: RoomState }
  | { t: "played"; game: HistoryGame }
  | { t: "rename"; name: string };

export type ServerMessage =
  | { t: "welcome"; code: string; you: string; members: RoomMember[]; state: RoomState | null; version: number; history: RoomPlayed[] }
  | { t: "members"; members: RoomMember[] }
  | { t: "state"; state: RoomState; version: number; by: string }
  | { t: "played"; played: RoomPlayed }
  | { t: "error"; message: string; code?: "no-room" };

export const MAX_STATE_BYTES = 64_000;
export const MAX_NAME = 24;
export const ROOM_HISTORY_LIMIT = 100;
