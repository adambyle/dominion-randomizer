// The app's own rules reference ("guide"): Markdown files in data/rules/, written for this app
// rather than copied from the wiki, so a wiki refresh never touches them.
//
//   data/rules/cards/<card-id>.md   rules explanations for one card (or split pile)
//   data/rules/topics/<topic>.md    general rules pages (Setup, Durations, Stop-moving rule ...)
//
// File format — deliberately small:
//
//   ---
//   title: Stop-moving rule          (topics only)
//   summary: One line for the index  (topics only)
//   group: Rules of play             (topics only; groups the index)
//   order: 10                        (topics only; sort order within the index)
//   applies: type:Duration, pile     (topics only; cards it's linked from — a type, or "pile" for split piles)
//   ---
//   Intro paragraph (optional).
//
//   ## Section heading
//
//   - A statement. [official]
//     - A nested statement (two-space indent).
//   - Another statement.
//
// Text uses the same inline markup as the wiki data (src/shared/types.ts), plus {rule:topic-id} and
// {rule:topic-id|link text} for links to topic pages. A trailing [official] marks a statement that
// restates an official ruling (rulebook or official FAQ); everything else is our own explanation.

export interface GuideItem {
  text: string;
  official?: boolean;
  children?: GuideItem[];
}

export type GuideBlock = { kind: "p"; text: string } | { kind: "list"; items: GuideItem[] };

export interface GuideSection {
  /** null for text before the first heading. */
  heading: string | null;
  blocks: GuideBlock[];
}

export interface GuideDoc {
  meta: Record<string, string>;
  sections: GuideSection[];
}

export interface GuideTopic {
  id: string;
  title: string;
  summary: string;
  group: string;
  order: number;
  /** "type:Duration", "pile" ... */
  applies: string[];
  doc: GuideDoc;
}

const OFFICIAL = /\s*\[official\]\s*$/i;

export function parseGuide(source: string): GuideDoc {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const meta: Record<string, string> = {};
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.indexOf("---", 1);
    if (end < 0) throw new Error("Unclosed front matter");
    for (const line of lines.slice(1, end)) {
      const m = /^([\w-]+):\s*(.*)$/.exec(line.trim());
      if (m) meta[m[1]!] = m[2]!.trim();
      else if (line.trim()) throw new Error(`Bad front matter line: ${line}`);
    }
    i = end + 1;
  }

  const sections: GuideSection[] = [];
  let section: GuideSection = { heading: null, blocks: [] };
  let para: string[] = [];
  /** Open list items by depth while inside a list. */
  let stack: GuideItem[][] | null = null;
  let last: GuideItem | null = null;

  const flushPara = () => {
    if (para.length) section.blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  const endList = () => { stack = null; last = null; };

  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trimEnd();
    // Blank lines end a paragraph; a list carries on across them until a non-item line.
    if (!line.trim()) { flushPara(); continue; }
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      flushPara(); endList();
      if (section.heading !== null || section.blocks.length) sections.push(section);
      section = { heading: heading[1]!.trim(), blocks: [] };
      continue;
    }
    const item = /^( *)[-*]\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const depth = Math.floor(item[1]!.length / 2);
      let text = item[2]!.trim();
      const official = OFFICIAL.test(text);
      if (official) text = text.replace(OFFICIAL, "");
      const node: GuideItem = official ? { text, official } : { text };
      if (!stack) {
        if (depth !== 0) throw new Error(`List starts indented: ${line}`);
        const items: GuideItem[] = [];
        section.blocks.push({ kind: "list", items });
        stack = [items];
      }
      if (depth > stack.length) throw new Error(`List indented too far: ${line}`);
      if (depth === stack.length) {
        const parent: GuideItem = last!;
        parent.children ??= [];
        stack.push(parent.children);
      }
      stack.length = depth + 1;
      stack[depth]!.push(node);
      last = node;
      continue;
    }
    // A continuation line of a list item (indented, not a new item) or a paragraph line.
    if (stack && last && /^ {2,}\S/.test(raw)) {
      const cur: GuideItem = last;
      let text = `${cur.text} ${line.trim()}`;
      if (OFFICIAL.test(text)) { text = text.replace(OFFICIAL, ""); cur.official = true; }
      cur.text = text;
      continue;
    }
    endList();
    para.push(line.trim());
  }
  flushPara();
  if (section.heading !== null || section.blocks.length) sections.push(section);
  return { meta, sections };
}

export function topicFromDoc(id: string, doc: GuideDoc): GuideTopic {
  return {
    id,
    title: doc.meta.title ?? id,
    summary: doc.meta.summary ?? "",
    group: doc.meta.group ?? "Rules",
    order: Number(doc.meta.order ?? 100),
    applies: (doc.meta.applies ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    doc,
  };
}

/** Topic pages that apply to a card: by its types, or because it is a split pile or part of one. */
export function topicsForCard(topics: GuideTopic[], card: { types: string[]; pile?: unknown; pileId?: string }): GuideTopic[] {
  return topics.filter((t) => t.applies.some((a) => {
    if (a === "pile") return !!card.pile || !!card.pileId;
    const m = /^type:(.+)$/.exec(a);
    return !!m && card.types.includes(m[1]!);
  }));
}

/** Every piece of text in a document, for validation. */
export function guideTexts(doc: GuideDoc): string[] {
  const out: string[] = [];
  const walk = (items: GuideItem[]) => items.forEach((it) => { out.push(it.text); if (it.children) walk(it.children); });
  for (const s of doc.sections) {
    if (s.heading) out.push(s.heading);
    for (const b of s.blocks) b.kind === "p" ? out.push(b.text) : walk(b.items);
  }
  return out;
}
