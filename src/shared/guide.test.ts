import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import type { CardData } from "./types";
import { guideTexts, parseGuide, topicFromDoc, topicsForCard } from "./guide";

describe("parseGuide", () => {
  it("reads front matter, paragraphs, sections and nested lists", () => {
    const doc = parseGuide([
      "---",
      "title: Durations",
      "applies: type:Duration, pile",
      "---",
      "Intro line one",
      "continues here.",
      "",
      "## Rules",
      "",
      "- First. [official]",
      "  - Nested,",
      "    continued.",
      "- Second",
      "",
      "- Third, after a blank line",
      "Para after list.",
    ].join("\n"));
    expect(doc.meta).toEqual({ title: "Durations", applies: "type:Duration, pile" });
    expect(doc.sections).toEqual([
      { heading: null, blocks: [{ kind: "p", text: "Intro line one continues here." }] },
      { heading: "Rules", blocks: [
        { kind: "list", items: [
          { text: "First.", official: true, children: [{ text: "Nested, continued." }] },
          { text: "Second" },
          { text: "Third, after a blank line" },
        ] },
        { kind: "p", text: "Para after list." },
      ] },
    ]);
    const topic = topicFromDoc("durations", doc);
    expect(topicsForCard([topic], { types: ["Action", "Duration"] })).toHaveLength(1);
    expect(topicsForCard([topic], { types: ["Action"], pileId: "augurs" })).toHaveLength(1);
    expect(topicsForCard([topic], { types: ["Action"] })).toHaveLength(0);
  });

  it("rejects badly indented lists", () => {
    expect(() => parseGuide("  - starts indented")).toThrow();
    expect(() => parseGuide("- a\n    - too deep")).toThrow();
  });
});

// Every rules file must parse, name a real card or topic, and only link to things that exist.
describe("data/rules content", () => {
  const data = cardsJson as unknown as CardData;
  const ids = new Set(data.cards.map((c) => c.id));
  const names = new Set(data.cards.flatMap((c) => [c.name.toLowerCase(), c.wikiTitle.toLowerCase()]));
  const root = "data/rules"; // vitest runs from the repository root, like the scripts
  const read = (dir: string) => readdirSync(join(root, dir)).filter((f) => f.endsWith(".md"))
    .map((f) => ({ id: f.slice(0, -3), doc: parseGuide(readFileSync(join(root, dir, f), "utf8")) }));
  const topics = read("topics");
  const cards = read("cards");
  const topicIds = new Set(topics.map((t) => t.id));

  const checkRefs = (where: string, texts: string[]) => {
    for (const text of texts) {
      for (const [, cardName] of text.matchAll(/\{card:([^|}]+)/g)) expect(names.has(cardName!.toLowerCase()), `${where}: unknown card "${cardName}"`).toBe(true);
      for (const [, topicId] of text.matchAll(/\{rule:([^|}]+)/g)) expect(topicIds.has(topicId!), `${where}: unknown topic "${topicId}"`).toBe(true);
      expect(text, `${where}: stray [official] marker`).not.toMatch(/\[official\]/i);
    }
  };

  it("names real cards and links to existing cards and topics", () => {
    expect(cards.length).toBeGreaterThan(0);
    for (const { id, doc } of cards) {
      expect(ids.has(id), `data/rules/cards/${id}.md: no card with that id`).toBe(true);
      checkRefs(`cards/${id}`, guideTexts(doc));
    }
  });

  it("gives every topic a title, a plain summary and valid links", () => {
    expect(topics.length).toBeGreaterThan(0);
    for (const { id, doc } of topics) {
      expect(doc.meta.title, `topics/${id}: missing title`).toBeTruthy();
      expect(doc.meta.summary, `topics/${id}: missing summary`).toBeTruthy();
      // The summary sits inside a link on the index page, so it can't contain links itself.
      expect(doc.meta.summary, `topics/${id}: summary can't link`).not.toMatch(/\{(card|rule):/);
      for (const r of (doc.meta.related ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
        expect(topicIds.has(r), `topics/${id}: unknown related topic "${r}"`).toBe(true);
      }
      for (const a of topicFromDoc(id, doc).applies) expect(a, `topics/${id}: bad applies`).toMatch(/^(pile|type:.+)$/);
      checkRefs(`topics/${id}`, guideTexts(doc));
    }
  });
});
