// Per-card preferences: how often a card is dealt (weight 1-5, default 3) or never (banned).
// Stored sparsely: a card with no entry has the default weight.

import type { Card } from "./types";

/** Card id -> 0 (banned) or a weight from 1 to 5. */
export type CardPrefs = Record<string, number>;

export const BANNED = 0;
export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 5;
export const DEFAULT_WEIGHT = 3;

/** What each weight (1-5) multiplies a card's chance by; the default weight changes nothing. */
const FACTORS = [0.25, 0.5, 1, 2, 4];
export const WEIGHT_LABELS = ["Rarely", "Less often", "Normal", "More often", "Much more often"];

export const isBanned = (prefs: CardPrefs, id: string) => prefs[id] === BANNED;

/** The card's weight, 1-5 (banned cards report the lowest). */
export const weightOf = (prefs: CardPrefs, id: string) => Math.max(MIN_WEIGHT, prefs[id] ?? DEFAULT_WEIGHT);

/** True when the card has a non-default weight or is banned. */
export const isTuned = (prefs: CardPrefs, id: string) => prefs[id] !== undefined && prefs[id] !== DEFAULT_WEIGHT;

/** Multiplier for a card's chance of being picked: 0 if banned. */
export function prefFactor(prefs: CardPrefs, id: string): number {
  const w = prefs[id];
  return w === undefined ? 1 : w === BANNED ? 0 : FACTORS[w - 1] ?? 1;
}

export const bannedIds = (prefs: CardPrefs) => Object.keys(prefs).filter((id) => prefs[id] === BANNED);

/** `prefs` with the card set to a weight (1-5), banned (0) or back to the default (null). */
export function withPref(prefs: CardPrefs, id: string, value: number | null): CardPrefs {
  const next = { ...prefs };
  if (value === null || value === DEFAULT_WEIGHT) delete next[id];
  else next[id] = value;
  return next;
}

/** Cards that can be picked at random somewhere in a deal or its setup. */
export const isWeightable = (c: Card) =>
  c.kind === "kingdom" || c.kind === "landscape" || c.kind === "pileMember" || c.types.includes("Boon");

/** Keeps only valid entries for cards that still exist (tolerant: used on saved data). */
export function cleanPrefs(v: unknown, known?: (id: string) => boolean): CardPrefs {
  const out: CardPrefs = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [id, w] of Object.entries(v)) {
    if (Number.isInteger(w) && (w as number) >= BANNED && (w as number) <= MAX_WEIGHT && w !== DEFAULT_WEIGHT && (!known || known(id))) out[id] = w as number;
  }
  return out;
}

const MAX_ENTRIES = 3000;

/** Strict check for data arriving at the server. */
export function isCardPrefs(v: unknown): v is CardPrefs {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  return entries.length <= MAX_ENTRIES
    && entries.every(([id, w]) => /^[a-z0-9-]{1,128}$/.test(id) && Number.isInteger(w) && (w as number) >= BANNED && (w as number) <= MAX_WEIGHT);
}
