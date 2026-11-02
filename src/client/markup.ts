// Renders the inline markup produced by scripts/wikitext.ts (see src/shared/types.ts) as DOM.

import { h, type Child } from "./dom";
import { cardByName, symbol } from "./data";

const TOKEN = /(\{[^{}\n]+\}|\*\*\*[^*]+\*\*\*|\*\*(?:[^*]|\*(?!\*))+\*\*|\*[^*\n]+\*|\n---\n|\n)/g;

/** Coin, debt and potion symbols drawn with the card art's own icons. */
export function costSymbols(cost: { coin?: number | string; debt?: number | string; potion?: boolean; extra?: string } | null, size: "s" | "m" | "l" = "m") {
  if (!cost) return null;
  const parts: Child[] = [];
  const coin = cost.coin;
  if (coin !== undefined && (coin !== 0 || (!cost.debt && !cost.potion))) parts.push(sym("coin", `${coin}${cost.extra ?? ""}`, size));
  if (cost.debt) parts.push(sym("debt", cost.debt, size));
  if (cost.potion) parts.push(sym("potion", "", size));
  return h("span.cost", null, parts);
}

export function sym(kind: "coin" | "debt" | "potion" | "vp" | "sun", text: string | number, size: "s" | "m" | "l" = "m") {
  const img = symbol(kind);
  return h("span", { class: ["sym", `sym-${kind}`, `sym-${size}`], style: img ? `background-image:url("${img.src}")` : undefined,
    "aria-label": kind === "potion" ? "Potion" : kind === "vp" ? `${text} VP` : `${text} ${kind}` }, kind === "potion" ? "" : String(text));
}

export function markup(text: string, onCard?: (id: string) => void): Child[] {
  return text.split(TOKEN).filter((p) => p !== "").map((part) => {
    if (part === "\n") return h("br");
    if (part === "\n---\n") return h("hr.divline");
    if (part.startsWith("***") && part.endsWith("***")) return h("strong", null, h("em", null, markup(part.slice(3, -3), onCard)));
    if (part.startsWith("**") && part.endsWith("**")) return h("strong", null, markup(part.slice(2, -2), onCard));
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return h("em", null, markup(part.slice(1, -1), onCard));
    const m = /^\{(\w+)(?::(.*))?\}$/.exec(part);
    if (!m) return part;
    const [, kind, arg = ""] = m;
    switch (kind) {
      case "card": {
        const [cardName, display] = arg.split("|");
        const card = cardByName(cardName!);
        if (!card || !onCard) return h("span.card-ref", null, display ?? cardName);
        return h("button.card-ref.link", { type: "button", onclick: () => onCard(card.id) }, display ?? cardName);
      }
      case "cost": case "coin": return sym("coin", arg, "s");
      case "debt": return sym("debt", arg, "s");
      case "potion": return sym("potion", "", "s");
      case "vp": return sym("vp", arg, "s");
      case "sun": return sym("sun", arg, "s");
      default: return part;
    }
  });
}
