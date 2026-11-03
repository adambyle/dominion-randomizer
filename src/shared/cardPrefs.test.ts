import { describe, expect, it } from "vitest";
import { bannedIds, cleanPrefs, isCardPrefs, prefFactor, weightOf, withPref } from "./cardPrefs";
import { mergeAccountSettings, isAccountSettings } from "./history";

describe("card prefs", () => {
  it("treats a missing card as the default weight and stores only differences", () => {
    expect(weightOf({}, "village")).toBe(3);
    expect(prefFactor({}, "village")).toBe(1);
    expect(withPref({}, "village", 3)).toEqual({});
    expect(withPref({ village: 5 }, "village", null)).toEqual({});
    const p = withPref(withPref({}, "village", 5), "chapel", 0);
    expect(prefFactor(p, "village")).toBeGreaterThan(1);
    expect(prefFactor(p, "chapel")).toBe(0);
    expect(bannedIds(p)).toEqual(["chapel"]);
    expect(prefFactor(withPref({}, "moat", 1), "moat")).toBeLessThan(1);
  });

  it("drops invalid and unknown entries from saved data", () => {
    expect(cleanPrefs({ a: 0, b: 5, c: 3, d: 6, e: 1.5, f: "x" }, (id) => id !== "b")).toEqual({ a: 0 });
    expect(cleanPrefs(null)).toEqual({});
  });

  it("validates what the server receives", () => {
    expect(isCardPrefs({ village: 4, chapel: 0 })).toBe(true);
    expect(isCardPrefs({ village: 9 })).toBe(false);
    expect(isCardPrefs({ "Bad Id": 2 })).toBe(false);
    expect(isCardPrefs([])).toBe(false);
    expect(isAccountSettings({ enabledBoxes: [], updated: 1 })).toBe(true);
    expect(isAccountSettings({ enabledBoxes: [], updated: 1, cardPrefs: { village: 2 }, prefsUpdated: 2 })).toBe(true);
    expect(isAccountSettings({ enabledBoxes: [], updated: 1, cardPrefs: { village: 2 } })).toBe(false);
  });

  it("merges the boxes and the prefs by their own timestamps", () => {
    const a = { enabledBoxes: ["x"], updated: 5, cardPrefs: { village: 1 }, prefsUpdated: 1 };
    const b = { enabledBoxes: ["y"], updated: 2, cardPrefs: { village: 5 }, prefsUpdated: 9 };
    expect(mergeAccountSettings(a, b)).toEqual({ enabledBoxes: ["x"], updated: 5, cardPrefs: { village: 5 }, prefsUpdated: 9 });
    expect(mergeAccountSettings({ enabledBoxes: ["x"], updated: 5 }, { enabledBoxes: ["y"], updated: 2 })).toEqual({ enabledBoxes: ["x"], updated: 5 });
    expect(mergeAccountSettings(null, b)).toBe(b);
  });
});
