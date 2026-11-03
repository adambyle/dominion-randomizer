import { beforeEach, describe, expect, it } from "vitest";
import { Store, tableSets } from "./state";
import { db } from "./data";

const OWNED = ["dominion-2", "intrigue-2", "seaside-2", "alchemy", "prosperity-2", "cornucopia-guilds-2", "dark-ages", "allies"];

function store(patch: Record<string, unknown> = {}) {
  const s = new Store();
  s.dispatch({ type: "options", patch: { enabledBoxes: OWNED, ...patch } });
  s.dispatch({ type: "settings", patch: { onboarded: true } });
  return s;
}
const opts = (s: Store) => s.state.settings.options;
const setOf = (id: string) => db.get(id).set;

describe("expansion selection", () => {
  let s: Store;
  beforeEach(() => { s = store(); });

  it("starts with nothing selected and deals from the base set", () => {
    expect(opts(s).drawSets).toEqual([]);
    s.dispatch({ type: "deal" });
    for (const id of s.state.game.kingdom) expect(setOf(id)).toBe("dominion");
    expect(tableSets(s.state.game)).toEqual(["dominion"]);
  });

  it("toggling selects, and selecting another drops the implicit base set", () => {
    s.dispatch({ type: "toggleSet", id: "seaside" });
    expect(opts(s).drawSets).toEqual(["seaside"]);
    s.dispatch({ type: "toggleSet", id: "dominion" });
    expect(opts(s).drawSets).toEqual(["dominion", "seaside"]);
    s.dispatch({ type: "toggleSet", id: "dominion" });
    s.dispatch({ type: "toggleSet", id: "seaside" });
    expect(opts(s).drawSets).toEqual([]);
  });

  it("follows the selection with the roll count, but not the other way round", () => {
    s.dispatch({ type: "drawSets", sets: ["seaside", "intrigue", "alchemy"] });
    expect(opts(s).rollCount).toBe(3);
    s.dispatch({ type: "rollCount", count: 5 });
    expect(opts(s).drawSets).toHaveLength(3);
    expect(opts(s).rollCount).toBe(5);
    s.dispatch({ type: "rollCount", count: 0 });
    expect(opts(s).rollCount).toBe(1);
    s.dispatch({ type: "drawSets", sets: [] });
    expect(opts(s).rollCount).toBe(1);
  });

  it("rolls the chosen number of expansions into the selection", () => {
    s.dispatch({ type: "rollCount", count: 4 });
    s.dispatch({ type: "rollSets" });
    expect(opts(s).drawSets).toHaveLength(4);
    expect(opts(s).rollCount).toBe(4);
  });

  it("keeps the table's icons when the selection changes afterwards", () => {
    s.dispatch({ type: "drawSets", sets: ["seaside", "intrigue"] });
    s.dispatch({ type: "deal" });
    const dealt = tableSets(s.state.game);
    expect(dealt).toEqual(["intrigue", "seaside"]);
    s.dispatch({ type: "drawSets", sets: ["alchemy"] });
    expect(tableSets(s.state.game)).toEqual(dealt);
  });

  it("draws swaps from the current selection and adds their expansion to the icons", () => {
    s.dispatch({ type: "drawSets", sets: ["seaside"] });
    s.dispatch({ type: "deal" });
    s.dispatch({ type: "drawSets", sets: ["alchemy"] });
    const target = s.state.game.kingdom[0]!;
    s.dispatch({ type: "replace", id: target });
    expect(s.state.game.kingdom.filter((id) => setOf(id) === "alchemy")).toHaveLength(1);
    expect(tableSets(s.state.game)).toEqual(["seaside", "alchemy"]);
  });

  it("drops expansions that are no longer owned from the selection", () => {
    s.dispatch({ type: "drawSets", sets: ["seaside", "allies"] });
    s.dispatch({ type: "options", patch: { enabledBoxes: OWNED.filter((b) => b !== "allies") } });
    expect(opts(s).drawSets).toEqual(["seaside"]);
  });
});

describe("picks that go with a table", () => {
  it("draws the Bane and Ferryman's pile from the selected expansions", () => {
    for (let i = 0; i < 20; i++) {
      const s = store({ drawSets: ["seaside", "intrigue"] });
      s.dispatch({ type: "add", id: "young-witch" });
      s.dispatch({ type: "add", id: "ferryman" });
      const setup = s.setup()!;
      expect(["seaside", "intrigue"]).toContain(setOf(setup.choices.bane!));
      expect(["seaside", "intrigue"]).toContain(setOf(setup.choices.ferryman!));
    }
  });

  it("re-rolls the Bane to a different card, and a locked table can't", () => {
    const s = store();
    s.dispatch({ type: "add", id: "young-witch" });
    const before = s.setup()!.choices.bane!;
    s.dispatch({ type: "reroll", key: "bane" });
    const after = s.setup()!.choices.bane!;
    expect(after).not.toBe(before);
    s.dispatch({ type: "lockSetup", on: true });
    s.dispatch({ type: "reroll", key: "bane" });
    expect(s.state.game.choices.bane).toBe(after);
  });

  it("drops the Ally when the last Liaison is swapped for a card that isn't one", () => {
    const s = store();
    s.dispatch({ type: "add", id: "underling" });
    expect(s.setup()!.choices.ally).toBeDefined();
    s.dispatch({ type: "remove", id: "underling" });
    s.dispatch({ type: "add", id: "village" });
    expect(s.setup()!.choices.ally).toBeUndefined();
  });

  it("keeps a locked Young Witch's Bane when dealing again, and never deals the Bane into the Kingdom", () => {
    const s = store({ drawSets: ["dominion", "intrigue", "seaside", "prosperity", "alchemy"] });
    s.dispatch({ type: "add", id: "young-witch" });
    const bane = s.setup()!.choices.bane!;
    s.dispatch({ type: "choices", choices: s.setup()!.choices });
    for (let i = 0; i < 10; i++) {
      s.dispatch({ type: "deal" });
      expect(s.state.game.kingdom).toContain("young-witch");
      expect(s.state.game.kingdom).not.toContain(bane);
      expect(s.setup()!.choices.bane).toBe(bane);
    }
  });

  it("doesn't swap another card into the Bane's place", () => {
    for (let i = 0; i < 30; i++) {
      const s = store({ drawSets: ["dominion"] });
      s.dispatch({ type: "add", id: "young-witch" });
      s.dispatch({ type: "fill" });
      const bane = s.setup()!.choices.bane!;
      s.dispatch({ type: "choices", choices: s.setup()!.choices });
      s.dispatch({ type: "replace", id: s.state.game.kingdom.find((id) => id !== "young-witch")! });
      expect(s.state.game.kingdom).not.toContain(bane);
      expect(s.setup()!.choices.bane).toBe(bane);
    }
  });
});

describe("card weights and bans", () => {
  it("never deals, fills, swaps or adds at random a banned card", () => {
    const s = store({ drawSets: ["dominion"] });
    const banned = db.data.cards.filter((c) => c.kind === "kingdom" && c.set === "dominion").slice(0, 12).map((c) => c.id);
    for (const id of banned) s.dispatch({ type: "cardPref", id, value: 0 });
    for (let i = 0; i < 25; i++) {
      s.dispatch({ type: "deal" });
      for (const id of banned) expect(s.state.game.kingdom).not.toContain(id);
      s.dispatch({ type: "replace", id: s.state.game.kingdom[0]! });
      s.dispatch({ type: "addRandom", set: null });
      s.dispatch({ type: "fill" });
      for (const id of banned) expect(s.state.game.kingdom).not.toContain(id);
    }
  });

  it("still lets a banned card be added by hand", () => {
    const s = store();
    s.dispatch({ type: "cardPref", id: "village", value: 0 });
    s.dispatch({ type: "add", id: "village" });
    expect(s.state.game.kingdom).toContain("village");
  });

  it("deals a heavily weighted card far more often than a rare one", () => {
    const tally = (value: number) => {
      const s = store({ drawSets: ["dominion"] });
      s.dispatch({ type: "cardPref", id: "village", value });
      let n = 0;
      for (let i = 0; i < 200; i++) { s.dispatch({ type: "deal" }); n += s.state.game.kingdom.includes("village") ? 1 : 0; }
      return n;
    };
    expect(tally(5)).toBeGreaterThan(tally(1) * 2);
  });

  it("stores only changes, resets to the default and stamps the change", () => {
    const s = store();
    s.dispatch({ type: "cardPref", id: "village", value: 5 });
    s.dispatch({ type: "cardPref", id: "chapel", value: 0 });
    expect(s.state.settings.cardPrefs).toEqual({ village: 5, chapel: 0 });
    expect(s.state.settings.prefsUpdated).toBeGreaterThan(0);
    s.dispatch({ type: "cardPref", id: "village", value: 3 });
    expect(s.state.settings.cardPrefs).toEqual({ chapel: 0 });
    s.dispatch({ type: "resetCardPrefs" });
    expect(s.state.settings.cardPrefs).toEqual({});
  });

  it("keeps a Bane that was already picked, but never picks a banned one", () => {
    const s = store({ drawSets: ["dominion", "intrigue", "seaside"] });
    s.dispatch({ type: "add", id: "young-witch" });
    const bane = s.setup()!.choices.bane!;
    s.dispatch({ type: "choices", choices: s.setup()!.choices });
    s.dispatch({ type: "cardPref", id: bane, value: 0 });
    expect(s.setup()!.choices.bane).toBe(bane);
    s.dispatch({ type: "reroll", key: "bane" });
    expect(s.state.game.choices.bane).not.toBe(bane);
  });
});
