import type { ReactNode } from "react";
import type { Card } from "../../shared/types";
import { CostIcon } from "../Markup";
import { setName } from "../data";

// Card frame colour follows the printed card: Action-Duration is all orange, Action-Reaction all
// blue, and only two coloured types together make a split frame (e.g. Treasure–Victory).
const TYPE_ORDER = ["Night", "Reaction", "Duration", "Reserve", "Ruins", "Shelter", "Victory", "Treasure",
  "Curse", "Event", "Landmark", "Project", "Way", "Trait", "Ally", "Prophecy", "Boon", "Hex", "State", "Artifact"];

export function typeColors(card: Card): string[] {
  const found = TYPE_ORDER.filter((t) => card.types.includes(t));
  return (found.length ? found.slice(0, 2) : ["Action"]).map((t) => `t-${t.toLowerCase()}`);
}

export function CardTile({ card, onOpen, actions, badges, highlight }: {
  card: Card;
  onOpen: () => void;
  actions?: ReactNode;
  badges?: ReactNode;
  highlight?: boolean;
}) {
  const [primary, secondary] = typeColors(card);
  return (
    <div className={`tile ${primary ?? ""} ${secondary ? `split ${secondary}-2` : ""} ${highlight ? "highlight" : ""}`}>
      <button type="button" className="tile-main" onClick={onOpen} aria-label={`${card.name}, ${card.types.join(" ")}`}>
        <span className="tile-cost">{card.cost && <CostIcon coin={card.cost.coin} debt={card.cost.debt} potion={card.cost.potion} extra={card.cost.extra} />}</span>
        <span className="tile-name">{card.name}</span>
        <span className="tile-meta">{card.types.join(" – ")} · {setName(card.set)}</span>
        {badges && <span className="tile-badges">{badges}</span>}
      </button>
      {actions && <div className="tile-actions">{actions}</div>}
    </div>
  );
}
