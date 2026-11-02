// Builds public/data/mentions.json: rulings that name two cards (see src/shared/mentions.ts).
// Run after changing data/rules/cards or refreshing the wiki data (npm run data runs it too).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildMentions } from "../src/shared/mentions";
import type { CardData, FaqSection } from "../src/shared/types";

const data: CardData = JSON.parse(readFileSync("src/data/cards.json", "utf8"));
const faq: Record<string, FaqSection[]> = JSON.parse(readFileSync("public/data/faq.json", "utf8"));
const own = Object.fromEntries(readdirSync("data/rules/cards").filter((f) => f.endsWith(".md"))
  .map((f) => [f.slice(0, -3), readFileSync(`data/rules/cards/${f}`, "utf8")]));
const index = buildMentions(data, faq, own);
writeFileSync("public/data/mentions.json", JSON.stringify(index));
console.log(`mentions.json: ${Object.keys(index.byCard).length} cards, ${index.rulings.length} rulings`);
