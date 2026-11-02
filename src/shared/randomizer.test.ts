import { describe, expect, it } from "vitest";
import cardData from "../data/cards.json";
import type { CardData } from "./types";
import { createDb } from "./setup";
import { createRng } from "./random";
import { DEFAULT_OPTIONS, randomize, replaceOne, rollSets, type RandomizerOptions } from "./randomizer";
import { cardTraits } from "./randomizer";

const data = cardData as CardData;
const db = createDb(data);
const allBoxes = data.boxes.map((b) => b.id);
const opts = (o: Partial<RandomizerOptions> = {}): RandomizerOptions => ({ ...DEFAULT_OPTIONS, enabledBoxes: allBoxes, ...o });

describe("randomizer", () => {
  it("picks the requested number of distinct piles and landscapes, with at most one Way", () => {
    for (let seed = 0; seed < 50; seed++) {
      const d = randomize(db, opts(), {}, createRng(seed));
      expect(new Set(d.kingdom).size).toBe(10);
      expect(d.landscapes).toHaveLength(2);
      expect(d.landscapes.filter((l) => db.get(l).types.includes("Way")).length).toBeLessThanOrEqual(1);
      for (const id of d.kingdom) expect(db.get(id).kind).toBe("kingdom");
    }
  });

  it("only uses enabled boxes", () => {
    const d = randomize(db, opts({ enabledBoxes: ["dominion-2"], landscapeCount: 2 }), {}, createRng(3));
    for (const id of d.kingdom) expect(db.get(id).boxes).toContain("dominion-2");
    expect(d.landscapes).toEqual([]);
  });

  it("respects trait minimums, maximums and exclusions", () => {
    for (let seed = 0; seed < 30; seed++) {
      const d = randomize(db, opts({ traitRules: { buy: { min: 2 }, attack: { weight: 0 }, cost2: { max: 1 } } }), {}, createRng(seed));
      const traits = d.kingdom.map((id) => cardTraits(db, db.get(id)));
      expect(traits.filter((t) => t.has("buy")).length).toBeGreaterThanOrEqual(2);
      expect(traits.filter((t) => t.has("attack") && !t.has("buy"))).toHaveLength(0);
      expect(traits.filter((t) => t.has("cost2")).length).toBeLessThanOrEqual(1);
    }
  });

  it("rolls the requested number of expansions and draws only from them", () => {
    const o = opts({ setsPerGame: 2 });
    const sets = rollSets(db, o, createRng(5));
    expect(sets).toHaveLength(2);
    const d = randomize(db, o, { sets }, createRng(5));
    for (const id of [...d.kingdom, ...d.landscapes]) expect(sets).toContain(db.get(id).set);
  });

  it("keeps locked cards and replaces a single card in place", () => {
    const d = randomize(db, opts(), { locked: ["chapel", "village"] }, createRng(1));
    expect(d.kingdom.slice(0, 2)).toEqual(["chapel", "village"]);
    const target = d.kingdom[4]!;
    const r = replaceOne(db, opts(), d, target, {}, createRng(2));
    expect(r.kingdom).toHaveLength(10);
    expect(r.kingdom).not.toContain(target);
    expect(r.kingdom.filter((x, i) => x !== d.kingdom[i])).toHaveLength(1);
  });

  it("is reproducible from a seed", () => {
    expect(randomize(db, opts(), {}, createRng(42))).toEqual(randomize(db, opts(), {}, createRng(42)));
  });
});
