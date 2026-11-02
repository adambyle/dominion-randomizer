// Converts MediaWiki wikitext from the Dominion Strategy wiki into the app's inline markup
// (documented in src/shared/types.ts). Unknown templates are counted so the build can report them.

// Private-use delimiters stand in for markup braces while templates are being expanded,
// so innermost-first matching of {{...}} never sees our own output.
const OPEN = "";
const CLOSE = "";
const tag = (body: string) => `${OPEN}${body}${CLOSE}`;

export const unknownTemplates = new Map<string, number>();

const CARD_LINK_TEMPLATES = new Set([
  "card", "event", "landmark", "project", "way", "trait", "ally", "prophecy",
  "boon", "hex", "state", "artifact", "landscape", "cardpopup", "popup",
]);

const DROP_TEMPLATES = new Set([
  "improve", "stub", "quote", "officialart", "about", "heirloombanner", "startsort", "endsort",
  "clear", "-", "main", "see also", "imagelandscape", "image", "type data", "expansion data",
  "edition data", "errata", "kingdom", "doc", "cardversionimage", "cardlangversionimage",
]);

/** Title of the page being converted, for {{PAGENAME}}. */
export let currentPage = "";
export const setCurrentPage = (title: string) => { currentPage = title; };

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", hellip: "…", mdash: "—",
  ndash: "–", rarr: "→", larr: "←", times: "×", minus: "−", thinsp: " ", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”",
};

/** Splits template parameters on top-level pipes (ignoring pipes inside [[links]]). */
function splitParams(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "[" && inner[i + 1] === "[") { depth++; cur += "[["; i++; continue; }
    if (ch === "]" && inner[i + 1] === "]") { depth--; cur += "]]"; i++; continue; }
    if (ch === "|" && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const stripBold = (s: string) => s.replace(/'''?/g, "").trim();

function costTag(coin: string, debt = "", potion = ""): string {
  const parts: string[] = [];
  if (coin.trim() !== "" || (!debt.trim() && !potion.trim())) parts.push(tag(`cost:${stripBold(coin)}`));
  if (debt.trim()) parts.push(tag(`debt:${stripBold(debt)}`));
  if (potion.trim()) parts.push(tag("potion"));
  return parts.join("");
}

function expandTemplate(inner: string): string {
  const params = splitParams(inner);
  const rawName = (params[0] ?? "").trim();
  // {{:Page}} transcludes another page and {{#fn:...}} is a parser function; neither renders here.
  if (rawName.startsWith(":") || rawName.startsWith("#")) return "";
  if (rawName === "PAGENAME") return currentPage;
  const name = rawName.toLowerCase();
  const args = params.slice(1);
  const pos = args.filter((a) => !/^\s*\w+\s*=/.test(a)).map((a) => a.trim());
  const a0 = pos[0] ?? "";

  if (CARD_LINK_TEMPLATES.has(name)) {
    if (!a0) return "";
    const display = pos[1] && pos[1] !== a0 ? `|${pos[1]}` : "";
    return tag(`card:${a0}${display}`);
  }
  if (DROP_TEMPLATES.has(name) || name.startsWith("navbox") || name.startsWith("infobox")) return "";
  switch (name) {
    case "set":
      return pos[1] || a0;
    case "cost":
      // {{Cost|coin|size|debt|potion}}
      return costTag(args[0] ?? "", args[2] ?? "", args[3] ?? "");
    case "coin":
      return tag(`cost:${stripBold(a0)}`);
    case "costplus":
      return tag(`coin:+${stripBold(a0)}`);
    case "debt":
      return tag(`debt:${stripBold(a0)}`);
    case "debtplus":
      return tag(`debt:+${stripBold(a0)}`);
    case "vp":
    case "vpde":
      return tag(`vp:${stripBold(a0)}`);
    case "p":
      return tag("potion");
    case "sun":
      return tag("sun");
    case "sunplus":
      return tag(`sun:+${stripBold(a0)}`);
    case "divline":
      return "\n---\n";
    case "nowrap":
    case "nobr":
    case "smallcaps":
    case "mat":
      return a0;
    case "split":
      return tag(`card:${pos.join("/")}`);
    case "advtoken":
      return `${a0} token`;
    case "=":
      return "=";
    default:
      unknownTemplates.set(name, (unknownTemplates.get(name) ?? 0) + 1);
      return a0;
  }
}

export function wikiToMarkup(src: string): string {
  let s = src;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<ref[^>]*\/>/g, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");
  s = s.replace(/<gallery[\s\S]*?<\/gallery>/g, "");
  s = s.replace(/<(del|strike)>[\s\S]*?<\/\1>/gi, ""); // struck-out (superseded) text

  // Expand templates innermost-first.
  for (let guard = 0; guard < 20; guard++) {
    const next = s.replace(/\{\{([^{}]*)\}\}/g, (_, inner: string) => expandTemplate(inner));
    if (next === s) break;
    s = next;
  }

  // Links.
  s = s.replace(/\[\[(?:File|Image):[^\]]*(?:\[\[[^\]]*\]\][^\]]*)*\]\]/gi, "");
  s = s.replace(/\[\[(?:Category):[^\]]*\]\]/gi, "");
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2");
  s = s.replace(/\[\[([^\]]*)\]\]/g, (_, t: string) => t.replace(/#.*/, ""));
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1");
  s = s.replace(/\[https?:\/\/\S+\]/g, "");

  // HTML.
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?p\s*>/gi, "\n");
  s = s.replace(/<\/?(?:span|div|small|big|sup|sub|center|u|s|font|i|b|blockquote)[^>]*>/gi, "");
  s = s.replace(/&(\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? m);
  s = s.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

  // Emphasis.
  s = s.replace(/'''''(.+?)'''''/g, "***$1***");
  s = s.replace(/'''(.+?)'''/g, "**$1**");
  s = s.replace(/''(.+?)''/g, "*$1*");

  s = s.replace(new RegExp(OPEN, "g"), "{").replace(new RegExp(CLOSE, "g"), "}");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");
  return s.trim();
}

// ---------------------------------------------------------------------------
// Structure helpers

export interface WikiSection {
  level: number;
  heading: string;
  body: string; // raw wikitext directly under this heading (before any subheading)
}

export function splitSections(wikitext: string): WikiSection[] {
  const sections: WikiSection[] = [{ level: 0, heading: "", body: "" }];
  for (const line of wikitext.split("\n")) {
    const m = /^(={1,6})\s*(.*?)\s*\1\s*$/.exec(line);
    if (m) {
      sections.push({ level: m[1]!.length, heading: wikiToMarkup(m[2]!), body: "" });
    } else {
      sections[sections.length - 1]!.body += line + "\n";
    }
  }
  return sections;
}

/** Reads `|key = value` lines from the first {{Infobox ...}} block. */
export function parseInfobox(wikitext: string): { kind: string; fields: Record<string, string> } | null {
  const start = wikitext.search(/\{\{Infobox /);
  if (start < 0) return null;
  // Find the matching close braces.
  let depth = 0;
  let end = start;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext[i] === "{" && wikitext[i + 1] === "{") { depth++; i++; }
    else if (wikitext[i] === "}" && wikitext[i + 1] === "}") { depth--; i++; if (depth === 0) { end = i + 1; break; } }
  }
  const block = wikitext.slice(start + 2, end - 2);
  const kind = /^Infobox ([^\n|]+)/.exec(block)![1]!.trim();
  const fields: Record<string, string> = {};
  let key: string | null = null;
  for (const line of block.split("\n").slice(1)) {
    const m = /^\s*\|\s*(\w+)\s*=\s?(.*)$/.exec(line);
    if (m) {
      key = m[1]!;
      fields[key] = m[2]!;
    } else if (key) {
      fields[key] += "\n" + line;
    }
  }
  for (const k of Object.keys(fields)) fields[k] = fields[k]!.replace(/<!--[\s\S]*?-->/g, "").trim();
  return { kind, fields };
}

/**
 * Pulls {| ... |} tables out of a section body. Collapsed boxes headed by <h3>Title</h3> hold
 * whole sub-sections (the wiki uses them for deprecated FAQs); other tables become one line per row.
 */
export function extractTables(body: string): {
  rest: string;
  boxes: { heading: string; body: string }[];
} {
  const boxes: { heading: string; body: string }[] = [];
  const rest = body.replace(/^\{\|[^\n]*\n([\s\S]*?)^\|\}\s*$/gm, (_, inner: string) => {
    const boxHeading = /^\|\s*<h\d>(.*?)<\/h\d>/m.exec(inner);
    if (boxHeading) {
      const content = inner.split("\n").filter((l) => !/^\|(-|\s*<h\d>|\s*$)/.test(l)).join("\n");
      boxes.push({ heading: wikiToMarkup(boxHeading[1]!), body: content });
      return "";
    }
    const rows = inner.split(/^\|-.*$/m).map((row) =>
      row.split("\n").filter((l) => /^\|(?!\+)/.test(l)) // data cells only; skip header (!) and caption (|+)
        .flatMap((l) => l.slice(1).split("||"))
        .map((cell) => cell.replace(/^[^|[{]*\|(?!\|)/, "").trim()) // drop cell attributes
        .filter(Boolean));
    return rows.filter((r) => r.length).map((r) => `* ${r.join(" — ")}`).join("\n") + "\n";
  });
  return { rest, boxes };
}

/** Parses bullet lists (and loose paragraphs) into nested items. */
export function parseBullets(body: string): { text: string; children?: { text: string }[] }[] {
  const items: { text: string; children?: { text: string }[] }[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const m = /^([*#:]+)\s*(.*)$/.exec(line);
    const depth = m ? m[1]!.length : 1;
    const text = wikiToMarkup(m ? m[2]! : line);
    if (!text) continue;
    const last = items[items.length - 1];
    if (depth > 1 && last) (last.children ??= []).push({ text });
    else items.push({ text });
  }
  return items;
}
