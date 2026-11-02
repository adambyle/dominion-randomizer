// Downloads card, set and symbol images from the wiki and writes the image index the app uses.
//
//   npm run images
//
// Input:  data/raw/wiki-images.json (image URLs, from scripts/wiki-images.browser.js)
//         src/data/cards.json
// Output: public/img/**            (git-ignored; re-run this script before building/deploying)
//         src/data/images.json      { cards, sets, symbols } -> paths under /img
//
// Wiki image files aren't behind the bot check, so this runs anywhere. Existing files are kept.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { dirname } from "node:path";
import type { CardData } from "../src/shared/types";

interface WikiImage { file: string; url: string; thumb?: string; w: number; h: number }
interface Manifest { files: Record<string, WikiImage>; categories: Record<string, WikiImage[]> }

const manifest: Manifest = JSON.parse(readFileSync("data/raw/wiki-images.json", "utf8"));
const cards: CardData = JSON.parse(readFileSync("src/data/cards.json", "utf8"));

const byFile = new Map<string, WikiImage>(Object.entries(manifest.files));
for (const list of Object.values(manifest.categories)) for (const img of list) if (!byFile.has(img.file)) byFile.set(img.file, img);

/** URL of the image scaled to `width` (or the original when it's already smaller). */
function sized(img: WikiImage, width: number): string {
  const url = img.url.replace(/^http:/, "https:");
  if (img.w <= width) return url;
  const name = url.split("/").pop()!;
  return `${url.replace("/images/", "/images/thumb/")}/${width}px-${name}`;
}

export interface ImageRef { src: string; w: number; h: number }
const index: { cards: Record<string, { face?: ImageRef; art?: ImageRef }>; sets: Record<string, { icon?: ImageRef; box?: ImageRef }>; symbols: Record<string, ImageRef> } =
  { cards: {}, sets: {}, symbols: {} };

// The wiki only serves thumbnails at widths it has already rendered, so each job lists fallbacks:
// the width we want, the 320px thumbnail the API lookup generated, then the original.
const jobs: { urls: string[]; path: string }[] = [];
function plan(img: WikiImage | undefined, width: number, path: string): ImageRef | undefined {
  if (!img) return undefined;
  // Photos are stored as WebP (~40% smaller than the wiki's JPEGs); small PNG icons stay PNG.
  const ext = img.url.toLowerCase().endsWith(".png") ? "png" : "webp";
  const file = `${path}.${ext}`;
  const urls = [sized(img, width), img.thumb?.replace(/^http:/, "https:"), img.url.replace(/^http:/, "https:")];
  jobs.push({ urls: [...new Set(urls.filter((u): u is string => !!u))], path: `public/img/${file}` });
  const w = Math.min(width, img.w);
  return { src: `/img/${file}`, w, h: Math.round((img.h * w) / img.w) };
}

const missing: string[] = [];
for (const c of cards.cards) {
  const horizontal = c.kind === "landscape" || c.kind === "status" && !["Boon", "Hex"].includes(c.types[0] ?? "") ;
  let face = byFile.get(`File:${c.image ?? `${c.wikiTitle}.jpg`}`);
  // Synthesized split piles ("Catapult/Rocks") use their top card.
  if (!face && c.pile) {
    const top = cards.cards.find((x) => x.id === c.pile!.members[0])!;
    face = byFile.get(`File:${top.image ?? `${top.wikiTitle}.jpg`}`);
  }
  const art = byFile.get(`File:${c.wikiTitle}Art.jpg`)
    ?? (c.pile ? byFile.get(`File:${cards.cards.find((x) => x.id === c.pile!.members[0])!.wikiTitle}Art.jpg`) : undefined);
  if (!face) missing.push(c.name);
  const isWide = face ? face.w > face.h : horizontal;
  index.cards[c.id] = {
    face: plan(face, isWide ? 440 : 300, `cards/${c.id}`),
    art: plan(art, 400, `art/${c.id}`),
  };
}

const SET_FILES: Record<string, [icon: string, box: string]> = {
  dominion: ["Dominion icon.png", "Dominion2.jpg"],
  intrigue: ["Intrigue icon.png", "Intrigue2.jpg"],
  seaside: ["Seaside icon.png", "Seaside2.jpg"],
  alchemy: ["Alchemy icon.png", "Alchemy.jpg"],
  prosperity: ["Prosperity icon.png", "Prosperity2.jpg"],
  "cornucopia-guilds": ["Cornucopia & Guilds icon.png", "Guilds & Cornucopia.jpg"],
  hinterlands: ["Hinterlands icon.png", "Hinterlands2.jpg"],
  "dark-ages": ["Dark Ages icon.png", "Dark Ages.jpg"],
  adventures: ["Adventures icon.png", "Adventures.jpg"],
  empires: ["Empires icon.png", "Empires.jpg"],
  nocturne: ["Nocturne icon.png", "Nocturne.jpg"],
  renaissance: ["Renaissance icon.png", "Renaissance.jpg"],
  menagerie: ["Menagerie (expansion) icon.png", "Menagerie (expansion).jpg"],
  allies: ["Allies icon.png", "Allies.jpg"],
  plunder: ["Plunder (expansion) icon.png", "Plunder (expansion).jpg"],
  "rising-sun": ["Rising Sun icon.png", "Rising Sun.jpg"],
  promo: ["Promo icon.png", "Promo icon.png"],
};
for (const [set, [icon, box]] of Object.entries(SET_FILES)) {
  index.sets[set] = { icon: plan(byFile.get(`File:${icon}`), 64, `sets/${set}`), box: plan(byFile.get(`File:${box}`), 360, `boxes/${set}`) };
  if (!byFile.has(`File:${icon}`) || !byFile.has(`File:${box}`)) missing.push(`set ${set}`);
}
for (const [name, file] of Object.entries({ coin: "Coin.png", debt: "Debt.png", potion: "Potion.png", vp: "VP.png", sun: "Sun.png" })) {
  const ref = plan(byFile.get(`File:${file}`), 96, `sym/${name}`);
  if (ref) index.symbols[name] = ref; else missing.push(`symbol ${name}`);
}

mkdirSync("src/data", { recursive: true });
writeFileSync("src/data/images.json", JSON.stringify(index));

// Download what isn't on disk yet, a few at a time.
const todo = jobs.filter((j) => !existsSync(j.path));
console.log(`${jobs.length} images, ${todo.length} to download${missing.length ? `; no image for: ${missing.join(", ")}` : ""}`);
let done = 0;
const failed: string[] = [];
async function worker() {
  for (let job = todo.shift(); job; job = todo.shift()) {
    let error = "";
    const save = async (bytes: Buffer) => {
      mkdirSync(dirname(job!.path), { recursive: true });
      writeFileSync(job!.path, job!.path.endsWith(".webp") ? await sharp(bytes).webp({ quality: 78 }).toBuffer() : bytes);
    };
    // A JPEG from an earlier run converts locally instead of downloading again.
    const legacy = job.path.replace(/\.webp$/, ".jpg");
    if (legacy !== job.path && existsSync(legacy)) {
      await save(readFileSync(legacy));
      unlinkSync(legacy);
      continue;
    }
    for (const url of job.urls) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": "dominion-randomizer image sync (personal fan project)" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await save(Buffer.from(await res.arrayBuffer()));
        error = "";
        break;
      } catch (e) {
        error = `${url} (${(e as Error).message})`;
      }
    }
    if (error) failed.push(error);
    if (++done % 100 === 0) console.log(`  ${done} downloaded`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(`Done. ${failed.length} failed${failed.length ? ":\n  " + failed.join("\n  ") : ""}`);
