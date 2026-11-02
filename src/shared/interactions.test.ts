import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import type { CardData, FaqSection } from "./types";
import { createDb } from "./setup";
import { detect, interactionBetween, interactionsAmong } from "./interactions";
import { buildMentions, rulingsBetween, type MentionIndex } from "./mentions";

const data = cardsJson as unknown as CardData;
const db = createDb(data);
const mentions = JSON.parse(readFileSync("public/data/mentions.json", "utf8")) as MentionIndex;
const kinds = (a: string, b: string) => detect(db, a, b).map((d) => d.kind);

describe("interaction detectors", () => {
  it.each([
    ["throne-room", "caravan", "replay-duration"],
    ["throne-room", "mining-village", "replay-mover"],
    ["band-of-misfits", "feast", "leave-in-place"],
    ["way-of-the-mouse", "caravan", "way-mover"],
    ["way-of-the-horse", "horse", "way-mover"],
    ["militia", "tunnel", "discard-trigger"],
    ["remodel", "fortress", "trash-trigger"],
    ["armory", "ghost-town", "gain-location"],
    ["highway", "workshop", "cost-reduction"],
    ["innovation", "sculptor", "play-on-gain"],
    ["haggler", "alms", "events-not-buys"],
    ["witch", "moat", "attack-reaction"],
    ["border-guard", "patron", "patron-reveal"],
    ["throne-room", "ninja", "shadow-play"],
    ["capitalism", "market", "capitalism"],
    ["farmhands", "samurai", "start-of-turn"],
    ["delay", "hireling", "start-of-turn"],
  ])("%s + %s: %s", (a, b, kind) => {
    expect(kinds(a, b)).toContain(kind);
    expect(kinds(b, a)).toContain(kind); // order doesn't matter
  });

  it("stays quiet for unrelated cards", () => {
    expect(kinds("summon", "samurai")).not.toContain("start-of-turn"); // Summon only takes cards costing up to 4
    expect(kinds("village", "smithy")).toEqual([]);
    expect(kinds("procession", "caravan")).not.toContain("replay-duration"); // Procession can't play Durations
    expect(kinds("tiara", "caravan")).not.toContain("replay-duration"); // Tiara plays Treasures
  });

  it("ranks a kingdom's pairs and links to existing topics", () => {
    const list = interactionsAmong(db, mentions, ["throne-room", "caravan", "village", "smithy", "militia", "tunnel"]);
    expect(list[0]!.score).toBeGreaterThanOrEqual(list[list.length - 1]!.score);
    expect(list.some((x) => [x.a, x.b].sort().join() === "caravan,throne-room")).toBe(true);
    const topics = new Set(readdirSync("data/rules/topics").map((f) => f.replace(/\.md$/, "")));
    for (const x of list) for (const d of x.detected) for (const [, t] of d.text.matchAll(/\{rule:([^|}]+)/g)) expect(topics.has(t!)).toBe(true);
  });
});

describe("rulings index", () => {
  it("is up to date with the FAQ and rules files (run npm run mentions)", () => {
    const faq = JSON.parse(readFileSync("public/data/faq.json", "utf8")) as Record<string, FaqSection[]>;
    const own = Object.fromEntries(readdirSync("data/rules/cards").map((f) => [f.slice(0, -3), readFileSync(`data/rules/cards/${f}`, "utf8")]));
    expect(JSON.stringify(buildMentions(data, faq, own))).toBe(JSON.stringify(mentions));
  });

  it("finds rulings naming both cards, and skips a pile's own cards", () => {
    expect(rulingsBetween(mentions, "throne-room", "mining-village").length).toBeGreaterThan(0);
    expect(rulingsBetween(mentions, "knights", "dame-anna")).toEqual([]);
    expect(interactionBetween(db, mentions, "throne-room", "mining-village").score).toBeGreaterThan(interactionBetween(db, null, "throne-room", "mining-village").score);
  });
});
