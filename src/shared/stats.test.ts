import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import kingdomsJson from "../data/kingdoms.json";
import type { CardData, RecommendedKingdom } from "./types";
import { createDb } from "./setup";
import { buildPool } from "./randomizer";
import type { HistoryEntry, RecommendedMark } from "./history";
import { computeStats, kingdomStatuses, playedCards } from "./stats";

const db = createDb(cardsJson as unknown as CardData);
const recommended = kingdomsJson as unknown as RecommendedKingdom[];
const first = recommended.find((k) => k.id === "first-game")!;
const second = recommended.find((k) => k.id === "size-distortion")!;

const entry = (id: string, kingdom: string[], recommendedId: string | null = null, deleted?: boolean): HistoryEntry => ({
  id, playedAt: 1, updated: 1, deleted,
  game: { kingdom, landscapes: [], players: 2, platinumColony: false, shelters: false, choices: {}, recommendedId },
});
const mark = (id: string, status: RecommendedMark["status"]): RecommendedMark => ({ id, status, updated: 1 });

describe("history stats", () => {
  it("works out recommended kingdom statuses", () => {
    const s = kingdomStatuses([entry("aaaaaaaa", first.kingdom, first.id), entry("bbbbbbbb", second.kingdom, second.id, true)],
      [mark(first.id, "skipped"), mark(second.id, "skipped"), mark("deck-top", "played"), mark("improvements", "none")]);
    expect(s.get(first.id)).toBe("played"); // history beats crossing off
    expect(s.get(second.id)).toBe("skipped"); // its game was deleted
    expect(s.get("deck-top")).toBe("played");
    expect(s.has("improvements")).toBe(false);
  });

  it("counts played cards from history and from kingdoms marked played", () => {
    const counts = playedCards([entry("aaaaaaaa", ["village", "smithy"]), entry("bbbbbbbb", ["village"])], [mark(first.id, "played"), mark(second.id, "skipped")], recommended);
    expect(counts.get("village")).toBe(first.kingdom.includes("village") ? 3 : 2);
    expect(counts.get("smithy")).toBe(first.kingdom.includes("smithy") ? 2 : 1);
    for (const id of second.kingdom.filter((x) => !first.kingdom.includes(x) && x !== "village" && x !== "smithy")) expect(counts.has(id)).toBe(false);
  });

  it("summarises games, sets and unplayed cards", () => {
    const pool = buildPool(db, ["dominion-2"]);
    const st = computeStats(db, [entry("aaaaaaaa", ["village", "smithy"]), entry("bbbbbbbb", ["village"])], [], recommended, pool);
    expect(st.games).toBe(2);
    expect(st.topCards[0]).toEqual({ id: "village", count: 2 });
    expect(st.sets).toEqual([{ set: "dominion", games: 2, cards: 3 }]);
    expect(st.unplayed).not.toContain("village");
    expect(st.unplayed).toContain("witch");
    expect(st.poolSize).toBe(st.unplayed.length + 2);
    expect(st.recommendedPlayable).toBeGreaterThan(0);
  });
});
