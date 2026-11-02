import { describe, expect, it } from "vitest";
import cardData from "../data/cards.json";
import kingdoms from "../data/kingdoms.json";
import type { CardData, RecommendedKingdom } from "./types";
import { createDb, resolveSetup, type SetupInput } from "./setup";
import { createRng } from "./random";

const data = cardData as CardData;
const db = createDb(data);
const pool = new Set(data.cards.filter((c) => c.kind === "kingdom" || c.kind === "landscape").map((c) => c.id));
const filler = ["village", "smithy", "market", "cellar", "moat", "festival", "laboratory", "militia", "remodel"];

function setup(partial: Partial<SetupInput>, seed = 1) {
  return resolveSetup(
    { kingdom: filler, landscapes: [], players: 3, platinumColony: false, shelters: false, ...partial },
    db, pool, createRng(seed),
  );
}

describe("setup engine", () => {
  it("explains Will-o'-Wisp via Druid's Boons only when The Swamp's Gift is set aside", () => {
    const withSwamp = setup({ kingdom: ["druid", ...filler], choices: { druidBoons: ["the-swamps-gift", "the-suns-gift", "the-skys-gift"] } });
    const wisp = withSwamp.nonSupply.find((p) => p.id === "will-o-wisp");
    expect(wisp?.reasons[0]?.by).toBe("the-swamps-gift");
    expect(withSwamp.decks.find((d) => d.id === "boons")).toBeUndefined();
    expect(withSwamp.setAside.find((s) => s.id === "druid")?.cards).toHaveLength(3);

    const without = setup({ kingdom: ["druid", ...filler], choices: { druidBoons: ["the-earths-gift", "the-suns-gift", "the-skys-gift"] } });
    expect(without.nonSupply.find((p) => p.id === "will-o-wisp")).toBeUndefined();
  });

  it("removes Druid's Boons from the Boons deck when another Fate card is present", () => {
    const r = setup({ kingdom: ["druid", "bard", ...filler.slice(1)] });
    const deck = r.decks.find((d) => d.id === "boons")!;
    expect(deck.cards).toHaveLength(9);
    for (const b of r.choices.druidBoons!) expect(deck.cards).not.toContain(b);
  });

  it("adds a Bane costing $2 or $3 and applies the Bane's own setup", () => {
    const r = setup({ kingdom: ["young-witch", ...filler], choices: { bane: "page" } });
    expect(r.extraKingdom.map((p) => p.id)).toEqual(["page"]);
    expect(r.nonSupply.map((p) => p.id)).toContain("treasure-hunter");
    const rolled = setup({ kingdom: ["young-witch", ...filler] });
    const bane = db.get(rolled.choices.bane!);
    expect([2, 3]).toContain(bane.cost!.coin);
    expect(rolled.kingdom.map((p) => p.id)).not.toContain(bane.id);
  });

  it("follows setup chains through the Black Market deck (Liaison -> Ally, Favors)", () => {
    const r = setup({ kingdom: ["black-market", ...filler], choices: { blackMarket: ["bauble"] }, blackMarketSize: 1 });
    expect(r.setAside.find((s) => s.id === "black-market")?.cards).toEqual(["bauble"]);
    expect(r.landscapes.some((l) => db.get(l.id).types.includes("Ally"))).toBe(true);
    expect(r.playerStart.favors).toBe(1);
  });

  it("adds Ruins for Looters and Potion for Potion costs", () => {
    const r = setup({ kingdom: ["marauder", "golem", ...filler.slice(2)], players: 4 });
    expect(r.basic.find((p) => p.id === "ruins")?.count).toBe(30);
    expect(r.basic.find((p) => p.id === "potion")).toBeDefined();
    expect(r.nonSupply.map((p) => p.id)).toContain("spoils");
  });

  it("handles split piles, Heirlooms and 2-player Victory pile sizes", () => {
    const r = setup({ kingdom: ["castles", "gladiator-fortune", "cemetery", ...filler.slice(3)], players: 2 });
    expect(r.kingdom.find((p) => p.id === "castles")?.count).toBe(8);
    expect(r.kingdom.find((p) => p.id === "gladiator-fortune")?.members).toEqual([
      { id: "gladiator", count: 5 }, { id: "fortune", count: 5 },
    ]);
    expect(r.startingDeck.cards).toContainEqual({ id: "haunted-mirror", count: 1 });
    expect(r.startingDeck.cards).toContainEqual({ id: "copper", count: 6 });
    expect(r.nonSupply.map((p) => p.id)).toContain("ghost");
  });

  it("picks Trait targets from Action/Treasure Kingdom piles, including the Bane", () => {
    const r = setup({ kingdom: ["young-witch", ...filler], landscapes: ["cheap", "fated"] });
    const targets = Object.values(r.choices.traits!);
    expect(new Set(targets).size).toBe(2);
    for (const t of targets) expect([...filler, "young-witch", r.choices.bane]).toContain(t);
  });

  it("applies the suggested Colony and Shelters rules from the kingdom order", () => {
    const r = setup({ kingdom: ["bank", ...filler.slice(0, 8), "hermit"], platinumColony: "auto", shelters: "auto" });
    expect(r.platinumColony.used).toBe(true);
    expect(r.shelters.used).toBe(true);
    expect(r.startingDeck.cards.map((c) => c.id)).toContain("necropolis");
  });

  it("reproduces a setup from its resolved choices", () => {
    const input = { kingdom: ["young-witch", "black-market", "druid", ...filler.slice(3)], landscapes: ["cheap"] };
    const a = setup(input, 7);
    const b = setup({ ...input, choices: a.choices }, 99);
    expect(b.choices).toEqual(a.choices);
  });

  it("keeps a given choice that breaks the rule, with a warning", () => {
    const r = setup({ kingdom: ["ferryman", ...filler], choices: { ferryman: "farrier" } });
    expect(r.choices.ferryman).toBe("farrier");
    expect(r.warnings).toHaveLength(1);
  });

  it("accepts official choices as printed", () => {
    const r = setup({ kingdom: ["ferryman", ...filler], choices: { ferryman: "farrier" }, acceptChoices: true });
    expect(r.choices.ferryman).toBe("farrier");
    expect(r.warnings).toEqual([]);
  });

  it("resolves every recommended kingdom without warnings", () => {
    for (const k of kingdoms as RecommendedKingdom[]) {
      const choices = { ...k.choices, traits: k.choices.traitFor1 && k.landscapes.find((l) => db.get(l).types.includes("Trait"))
        ? { [k.landscapes.find((l) => db.get(l).types.includes("Trait"))!]: k.choices.traitFor1 as string } : undefined };
      const r = setup({ kingdom: k.kingdom, landscapes: k.landscapes.filter((l) => !/Ally|Prophecy/.test(db.get(l).types.join())),
        choices: { ...choices, ally: k.landscapes.find((l) => db.get(l).types.includes("Ally")),
          prophecy: k.landscapes.find((l) => db.get(l).types.includes("Prophecy")) } as never, acceptChoices: true });
      expect(r.warnings, k.name).toEqual([]);
    }
  });
});
