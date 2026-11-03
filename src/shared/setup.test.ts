import { describe, expect, it } from "vitest";
import cardData from "../data/cards.json";
import kingdoms from "../data/kingdoms.json";
import type { CardData, RecommendedKingdom } from "./types";
import { createDb, resolveSetup, withoutChoice, type SetupInput } from "./setup";
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

  it("re-picks a carried-over choice that no longer fits", () => {
    const r = setup({ kingdom: ["ferryman", ...filler], choices: { ferryman: "farrier" } });
    expect(r.choices.ferryman).not.toBe("farrier");
    expect([3, 4]).toContain(db.get(r.choices.ferryman!).cost!.coin);
    const bane = setup({ kingdom: ["young-witch", "page", ...filler.slice(1)], choices: { bane: "page" } });
    expect(bane.choices.bane).not.toBe("page");
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

describe("random picks follow the expansions in play and the weights", () => {
  const prefer = (sets: string[], weight?: (c: import("./types").Card) => number) => ({ sets, weight });

  it("picks the Bane, Ferryman's pile and the Ally from the expansions in play when it can", () => {
    for (let seed = 0; seed < 40; seed++) {
      const r = setup({ kingdom: ["young-witch", "ferryman", "bustling-village", ...filler], prefer: prefer(["dominion", "intrigue", "seaside"]) }, seed);
      expect(["dominion", "intrigue", "seaside"]).toContain(db.get(r.choices.bane!).set);
      expect(["dominion", "intrigue", "seaside"]).toContain(db.get(r.choices.ferryman!).set);
    }
  });

  it("falls back to other expansions when nothing fits", () => {
    const r = setup({ kingdom: ["young-witch", ...filler], prefer: prefer(["prosperity"]) });
    expect(r.choices.bane).toBeDefined();
    expect(r.warnings).toEqual([]);
  });

  it("leans on card weights, and never on a card weighted zero while others fit", () => {
    for (let seed = 0; seed < 40; seed++) {
      const r = setup({ kingdom: ["young-witch", ...filler], prefer: prefer([], (c) => (c.types.includes("Attack") ? 0 : 1)) }, seed);
      expect(db.get(r.choices.bane!).types).not.toContain("Attack");
    }
  });

  it("fills the Black Market deck from the expansions in play first", () => {
    const r = setup({ kingdom: ["black-market", ...filler], blackMarketSize: 10, prefer: prefer(["seaside"]) });
    expect(r.choices.blackMarket).toHaveLength(10);
    expect(r.choices.blackMarket!.every((id) => db.get(id).set === "seaside")).toBe(true);
  });

  it("keeps an eligible given choice whatever the preference says", () => {
    const r = setup({ kingdom: ["young-witch", ...filler], choices: { bane: "page" }, prefer: prefer(["seaside"]) });
    expect(r.choices.bane).toBe("page");
  });

  it("re-picks a choice without repeating the previous card", () => {
    for (let seed = 0; seed < 30; seed++) {
      const first = setup({ kingdom: ["young-witch", ...filler] }, seed);
      const { choices, previous } = withoutChoice(first.choices, "bane");
      expect(previous).toBe(first.choices.bane);
      expect(choices.bane).toBeUndefined();
      const again = setup({ kingdom: ["young-witch", ...filler], choices, exclude: [previous!] }, seed + 100);
      expect(again.choices.bane).not.toBe(previous);
    }
  });

  it("re-picks the Ally of a Liaison and the trait target", () => {
    const first = setup({ kingdom: ["underling", ...filler] });
    const { choices, previous } = withoutChoice(first.choices, "ally");
    const again = setup({ kingdom: ["underling", ...filler], choices, exclude: [previous!] }, 9);
    expect(again.choices.ally).toBeDefined();
    expect(again.choices.ally).not.toBe(previous);
    expect(again.landscapes.filter((l) => db.get(l.id).types.includes("Ally"))).toHaveLength(1);
  });
});

describe("banned and weighted picks", () => {
  const cheap = db.data.cards
    .filter((c) => c.kind === "kingdom" && !filler.includes(c.id) && c.cost && [2, 3].includes(c.cost.coin) && !c.cost.debt && !c.cost.potion)
    .map((c) => c.id);

  it("doesn't pick a banned Bane, but keeps one that was already chosen", () => {
    const banned = cheap.slice(1);
    for (let seed = 0; seed < 20; seed++) {
      const r = setup({ kingdom: ["young-witch", ...filler], prefer: { banned } }, seed);
      expect(r.choices.bane).toBe(cheap[0]);
    }
    const kept = setup({ kingdom: ["young-witch", ...filler], choices: { bane: cheap[1] }, prefer: { banned: cheap } });
    expect(kept.choices.bane).toBe(cheap[1]);
  });

  it("falls back to a banned card with a warning when nothing else fits", () => {
    const r = setup({ kingdom: ["young-witch", ...filler], prefer: { banned: cheap } });
    expect(cheap).toContain(r.choices.bane);
    expect(r.warnings.some((w) => w.includes("banned"))).toBe(true);
  });

  it("leaves banned cards out of the Black Market deck and Druid's Boons", () => {
    const candidates = [...pool].filter((id) => db.get(id).kind === "kingdom" && !db.get(id).pile && !filler.includes(id) && id !== "black-market");
    const banned = candidates.slice(0, candidates.length - 20);
    const bm = setup({ kingdom: ["black-market", ...filler], blackMarketSize: 15, prefer: { banned } });
    expect(bm.choices.blackMarket).toHaveLength(15);
    for (const id of bm.choices.blackMarket!) expect(banned).not.toContain(id);

    const boons = db.data.cards.filter((c) => c.types.includes("Boon")).map((c) => c.id);
    for (let seed = 0; seed < 20; seed++) {
      const r = setup({ kingdom: ["druid", ...filler.slice(1)], prefer: { banned: boons.slice(0, 9) } }, seed);
      expect([...r.choices.druidBoons!].sort()).toEqual(boons.slice(9).sort());
    }
  });

  it("follows card weights for Allies", () => {
    const allies = db.data.cards.filter((c) => c.types.includes("Ally")).map((c) => c.id);
    const favorite = allies[0]!;
    let hits = 0;
    for (let seed = 0; seed < 100; seed++) {
      hits += setup({ kingdom: ["underling", ...filler.slice(1)], prefer: { weight: (c) => (c.id === favorite ? 20 : 1) } }, seed).choices.ally === favorite ? 1 : 0;
    }
    expect(hits).toBeGreaterThan((100 / allies.length) * 2);
  });
});
