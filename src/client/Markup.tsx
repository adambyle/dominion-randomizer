// Renders the inline markup produced by scripts/wikitext.ts (see src/shared/types.ts).

import { Fragment, type ReactNode } from "react";
import { cardByName } from "./data";

const TOKEN = /(\{[^{}\n]+\}|\*\*\*[^*]+\*\*\*|\*\*(?:[^*]|\*(?!\*))+\*\*|\*[^*\n]+\*|\n---\n|\n)/g;

export function CostIcon({ coin, debt, potion, extra }: { coin?: string | number; debt?: string | number; potion?: boolean; extra?: string }) {
  const parts: ReactNode[] = [];
  const showCoin = coin !== undefined && (coin !== 0 || (!debt && !potion));
  if (showCoin) parts.push(<span key="c" className="coin">{coin}{extra}</span>);
  if (debt) parts.push(<span key="d" className="debt">{debt}</span>);
  if (potion) parts.push(<span key="p" className="potion" title="Potion">P</span>);
  return <span className="cost">{parts}</span>;
}

function token(t: string, onCard: ((id: string) => void) | undefined, key: number): ReactNode {
  const m = /^\{(\w+)(?::(.*))?\}$/.exec(t);
  if (!m) return t;
  const [, kind, arg = ""] = m;
  switch (kind) {
    case "card": {
      const [name, display] = arg.split("|");
      const card = cardByName(name!);
      if (!card || !onCard) return <span key={key} className="card-ref">{display ?? name}</span>;
      return <button key={key} type="button" className="card-ref link" onClick={() => onCard(card.id)}>{display ?? name}</button>;
    }
    case "cost": return <span key={key} className="coin">{arg}</span>;
    case "coin": return <span key={key} className="coin">{arg}</span>;
    case "debt": return <span key={key} className="debt">{arg}</span>;
    case "potion": return <span key={key} className="potion" title="Potion">P</span>;
    case "vp": return <span key={key} className="vp">{arg}<small>VP</small></span>;
    case "sun": return <span key={key} className="sun" title="Sun">☀{arg}</span>;
    default: return t;
  }
}

export function Markup({ text, onCard }: { text: string; onCard?: (id: string) => void }) {
  return <>{render(text, onCard)}</>;
}

function render(text: string, onCard?: (id: string) => void): ReactNode[] {
  return text.split(TOKEN).filter((p) => p !== "").map((part, i) => {
    if (part === "\n") return <br key={i} />;
    if (part === "\n---\n") return <hr key={i} className="divline" />;
    if (part.startsWith("***") && part.endsWith("***")) return <strong key={i}><em>{render(part.slice(3, -3), onCard)}</em></strong>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{render(part.slice(2, -2), onCard)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{render(part.slice(1, -1), onCard)}</em>;
    if (part.startsWith("{")) return <Fragment key={i}>{token(part, onCard, i)}</Fragment>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
