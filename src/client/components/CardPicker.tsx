import { useMemo, useState } from "react";
import { isStandardLandscape } from "../../shared/randomizer";
import { costSort, db, setName } from "../data";
import { CostIcon } from "../Markup";
import { Modal } from "./Modal";

/** Search Kingdom piles and landscapes to add to the game. */
export function CardPicker({ pool, exclude, onPick, onClose }: {
  pool: ReadonlySet<string>;
  exclude: ReadonlySet<string>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.data.cards
      .filter((c) => c.kind === "kingdom" || isStandardLandscape(c))
      .filter((c) => showAll || pool.has(c.id))
      .filter((c) => !exclude.has(c.id))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.types.some((t) => t.toLowerCase() === q) || setName(c.set).toLowerCase().includes(q))
      .sort((a, b) => Number(a.kind === "landscape") - Number(b.kind === "landscape") || costSort(a, b))
      .slice(0, 80);
  }, [query, showAll, pool, exclude]);

  return (
    <Modal title="Add a card" onClose={onClose}>
      <input autoFocus className="search" placeholder="Search by name, type or expansion" value={query} onChange={(e) => setQuery(e.target.value)} />
      <label className="check small"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Include expansions that aren’t enabled</label>
      <ul className="pick-list">
        {results.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onPick(c.id)}>
              <span className="tile-cost">{c.cost && <CostIcon coin={c.cost.coin} debt={c.cost.debt} potion={c.cost.potion} extra={c.cost.extra} />}</span>
              <span>{c.name}</span>
              <span className="muted small">{c.types.join(" – ")} · {setName(c.set)}</span>
            </button>
          </li>
        ))}
        {!results.length && <li className="muted">No matching cards.</li>}
      </ul>
    </Modal>
  );
}
