import { describe, expect, it } from "vitest";
import { isAccountSettings, isHistoryEntry, mergeEntries, visible, type HistoryEntry } from "./history";
import { hashPassword, randomId, sha256, verifyPassword } from "../worker/auth";

const entry = (id: string, updated: number, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id, playedAt: updated, updated,
  game: { kingdom: ["village", "smithy"], landscapes: [], players: 3, platinumColony: false, shelters: false, choices: {}, recommendedId: null },
  ...extra,
});

describe("mergeEntries", () => {
  it("keeps the newest version of each entry", () => {
    const merged = mergeEntries([entry("aaaaaaaa", 1), entry("bbbbbbbb", 5)], [entry("aaaaaaaa", 3, { deleted: true }), entry("bbbbbbbb", 4, { deleted: true })]);
    expect(merged.find((e) => e.id === "aaaaaaaa")!.deleted).toBe(true);
    expect(merged.find((e) => e.id === "bbbbbbbb")!.deleted).toBeUndefined();
    expect(visible(merged).map((e) => e.id)).toEqual(["bbbbbbbb"]);
  });

  it("sorts newest played first", () => {
    const merged = mergeEntries([entry("aaaaaaaa", 1)], [entry("cccccccc", 9), entry("bbbbbbbb", 5)]);
    expect(merged.map((e) => e.id)).toEqual(["cccccccc", "bbbbbbbb", "aaaaaaaa"]);
  });
});

describe("validation", () => {
  it("accepts well-formed entries and rejects bad ones", () => {
    expect(isHistoryEntry(entry("abcdefgh", 1))).toBe(true);
    expect(isHistoryEntry({ ...entry("abcdefgh", 1), id: "short" })).toBe(false);
    expect(isHistoryEntry({ ...entry("abcdefgh", 1), game: { ...entry("x", 1).game, kingdom: ["<script>"] } })).toBe(false);
    expect(isHistoryEntry({ ...entry("abcdefgh", 1), game: { ...entry("x", 1).game, players: 9 } })).toBe(false);
    expect(isHistoryEntry(null)).toBe(false);
    expect(isAccountSettings({ enabledBoxes: ["dominion-2"], updated: 1 })).toBe(true);
    expect(isAccountSettings({ enabledBoxes: "dominion-2", updated: 1 })).toBe(false);
  });
});

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const stored = await hashPassword("correct horse battery", 1000);
    expect(stored.iterations).toBe(1000);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batter", stored)).toBe(false);
    const again = await hashPassword("correct horse battery", 1000);
    expect(again.salt).not.toBe(stored.salt);
    expect(again.hash).not.toBe(stored.hash);
  });

  it("makes url-safe random ids and stable digests", async () => {
    expect(randomId(32)).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(await sha256("abc")).toBe(await sha256("abc"));
    expect(await sha256("abc")).not.toBe(await sha256("abd"));
  });
});
