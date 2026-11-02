// Loads the app's own rules reference from data/rules/ (see src/shared/guide.ts for the format).
// Topic pages are small and bundled; card files are fetched one at a time when a card is opened.

import { parseGuide, topicFromDoc, type GuideDoc, type GuideTopic } from "../shared/guide";

const topicFiles = import.meta.glob("/data/rules/topics/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const cardFiles = import.meta.glob("/data/rules/cards/*.md", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

const fileId = (path: string) => path.replace(/^.*\/|\.md$/g, "");

export const topics: GuideTopic[] = Object.entries(topicFiles)
  .map(([path, src]) => topicFromDoc(fileId(path), parseGuide(src)))
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

export const topic = (id: string) => topics.find((t) => t.id === id);

const cardLoaders = new Map(Object.entries(cardFiles).map(([path, load]) => [fileId(path), load]));
const cardCache = new Map<string, GuideDoc>();

export const hasCardGuide = (id: string) => cardLoaders.has(id);
export const cachedCardGuide = (id: string) => cardCache.get(id);

export async function loadCardGuide(id: string): Promise<GuideDoc | null> {
  const cached = cardCache.get(id);
  if (cached) return cached;
  const load = cardLoaders.get(id);
  if (!load) return null;
  const doc = parseGuide(await load());
  cardCache.set(id, doc);
  return doc;
}
