import { useMemo, useState } from "react";
import type { CardKind } from "../../shared/types";
import { costSort, data, setName } from "../data";
import { CostIcon } from "../Markup";

const KINDS: { id: CardKind | "all"; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "kingdom", label: "Kingdom piles" },
  { id: "landscape", label: "Landscapes" },
  { id: "nonSupply", label: "Non-Supply" },
  { id: "status", label: "Boons, Hexes, States, Artifacts" },
  { id: "basic", label: "Basic cards" },
  { id: "pileMember", label: "Split-pile cards" },
];

/** Card reference: search any card and open its FAQ. */
export function CardsView({ enabledBoxes, onCard }: { enabledBoxes: string[]; onCard: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<CardKind | "all">("kingdom");
  const [set, setSet] = useState("all");
  const [owned, setOwned] = useState(false);
  const enabled = useMemo(() => new Set(enabledBoxes), [enabledBoxes]);

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.cards
      .filter((c) => kind === "all" || c.kind === kind)
      .filter((c) => set === "all" || c.set === set)
      .filter((c) => !owned || c.boxes.some((b) => enabled.has(b)))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.text.toLowerCase().includes(q) || c.types.some((t) => t.toLowerCase() === q))
      .sort(costSort);
  }, [query, kind, set, owned, enabled]);

  return (
    <div className="cards-view">
      <div className="toolbar wrap">
        <input className="search" placeholder="Search names, text or types" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value as CardKind | "all")}>
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <select value={set} onChange={(e) => setSet(e.target.value)}>
          <option value="all">All expansions</option>
          {data.sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={owned} onChange={(e) => setOwned(e.target.checked)} /> Enabled boxes only</label>
      </div>
      <p className="muted small">{cards.length} cards</p>
      <ul className="pick-list">
        {cards.slice(0, 300).map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onCard(c.id)}>
              <span className="tile-cost">{c.cost && <CostIcon coin={c.cost.coin} debt={c.cost.debt} potion={c.cost.potion} extra={c.cost.extra} />}</span>
              <span>{c.name}</span>
              <span className="muted small">{c.types.join(" – ")} · {setName(c.set)}</span>
            </button>
          </li>
        ))}
      </ul>
      {cards.length > 300 && <p className="muted small">Showing the first 300 — narrow the search to see more.</p>}
    </div>
  );
}
