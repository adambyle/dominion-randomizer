// What the play history says: which cards and recommended kingdoms have been played, and stats.

import type { HistoryEntry, RecommendedMark } from "./history";
import type { CardDb } from "./setup";
import type { RecommendedKingdom } from "./types";

export type KingdomStatus = "played" | "skipped" | null;

/**
 * Status of each recommended kingdom: played if a history entry came from it or it was marked
 * played; crossed off if marked so (an explicit mark wins over history only when it's "skipped").
 */
export function kingdomStatuses(entries: HistoryEntry[], marks: RecommendedMark[]): Map<string, KingdomStatus> {
  const out = new Map<string, KingdomStatus>();
  for (const e of entries) if (!e.deleted && e.game.recommendedId) out.set(e.game.recommendedId, "played");
  for (const m of marks) {
    if (m.status === "played") out.set(m.id, "played");
    else if (m.status === "skipped" && out.get(m.id) !== "played") out.set(m.id, "skipped");
  }
  return out;
}

/** Cards that have been on the table in a played game (history, or recommended kingdoms marked played). */
export function playedCards(entries: HistoryEntry[], marks: RecommendedMark[], recommended: RecommendedKingdom[]): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (ids: string[]) => { for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1); };
  for (const e of entries) if (!e.deleted) add([...e.game.kingdom, ...e.game.landscapes]);
  const byId = new Map(recommended.map((k) => [k.id, k]));
  for (const m of marks) {
    const k = m.status === "played" ? byId.get(m.id) : undefined;
    if (k) add([...k.kingdom, ...k.landscapes]);
  }
  return counts;
}

export interface Stats {
  games: number;
  /** Kingdom piles and landscapes by how often they were played, most first. */
  topCards: { id: string; count: number }[];
  /** Per expansion: games that used it and card appearances. */
  sets: { set: string; games: number; cards: number }[];
  /** Cards in the pool (Kingdom piles and landscapes) never played. */
  unplayed: string[];
  poolSize: number;
  recommendedDone: number;
  recommendedPlayable: number;
}

export function computeStats(db: CardDb, entries: HistoryEntry[], marks: RecommendedMark[], recommended: RecommendedKingdom[],
  pool: Set<string>): Stats {
  const live = entries.filter((e) => !e.deleted);
  const counts = playedCards(live, marks, recommended);
  const known = [...counts].filter(([id]) => db.byId.has(id));
  const setGames = new Map<string, number>();
  const setCards = new Map<string, number>();
  for (const e of live) {
    const ids = [...e.game.kingdom, ...e.game.landscapes].filter((id) => db.byId.has(id));
    for (const set of new Set(ids.map((id) => db.get(id).set))) setGames.set(set, (setGames.get(set) ?? 0) + 1);
    for (const id of ids) setCards.set(db.get(id).set, (setCards.get(db.get(id).set) ?? 0) + 1);
  }
  const poolCards = [...pool].filter((id) => { const k = db.byId.get(id)?.kind; return k === "kingdom" || k === "landscape"; });
  const statuses = kingdomStatuses(live, marks);
  const playable = recommended.filter((k) => [...k.kingdom, ...k.landscapes].every((id) => pool.has(id)));
  return {
    games: live.length,
    topCards: known.map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    sets: [...setGames].map(([set, games]) => ({ set, games, cards: setCards.get(set) ?? 0 })).sort((a, b) => b.games - a.games || b.cards - a.cards),
    unplayed: poolCards.filter((id) => !counts.has(id)),
    poolSize: poolCards.length,
    recommendedDone: playable.filter((k) => statuses.has(k.id)).length,
    recommendedPlayable: playable.length,
  };
}
