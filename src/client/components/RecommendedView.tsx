import { useMemo, useState } from "react";
import type { RecommendedKingdom } from "../../shared/types";
import { costSort, data, db, recommended, setName } from "../data";

/** Each card needs at least one enabled box that prints it. */
function playable(k: RecommendedKingdom, enabled: ReadonlySet<string>) {
  return [...k.kingdom, ...k.landscapes].every((id) => db.get(id).boxes.some((b) => enabled.has(b)));
}

export function RecommendedView({ enabledBoxes, onUse, onCard }: {
  enabledBoxes: string[];
  onUse: (k: RecommendedKingdom) => void;
  onCard: (id: string) => void;
}) {
  const enabled = useMemo(() => new Set(enabledBoxes), [enabledBoxes]);
  const [set, setSet] = useState<string>("all");
  const [onlyPlayable, setOnlyPlayable] = useState(true);
  const [source, setSource] = useState<"rulebook" | "donald-x">("rulebook");
  const [showOld, setShowOld] = useState(false);

  const list = recommended.filter((k) =>
    k.source === source
    && (set === "all" || k.sets.includes(set))
    && (showOld || source !== "rulebook" || !Object.values(k.editions).includes(1))
    && (!onlyPlayable || playable(k, enabled)));

  // Group by wiki section heading ("Seaside & Dominion", "Dominion 1E only" ...).
  const groups = new Map<string, RecommendedKingdom[]>();
  for (const k of list) groups.set(k.group, [...(groups.get(k.group) ?? []), k]);

  return (
    <div className="recommended">
      <div className="toolbar wrap">
        <select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
          <option value="rulebook">Rulebook kingdoms</option>
          <option value="donald-x">Designed by Donald X.</option>
        </select>
        <select value={set} onChange={(e) => setSet(e.target.value)}>
          <option value="all">All expansions</option>
          {data.sets.filter((s) => s.id !== "promo").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={onlyPlayable} onChange={(e) => setOnlyPlayable(e.target.checked)} /> Only with enabled boxes</label>
        {source === "rulebook" && <label className="check"><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Include 1st-edition rulebooks</label>}
      </div>
      <p className="muted small">{list.length} kingdoms</p>
      {[...groups].map(([group, ks]) => (
        <section key={group}>
          <h3>{group}</h3>
          <ul className="rk-list">
            {ks.map((k) => (
              <li key={k.id} className="rk">
                <div className="rk-head">
                  <strong>{k.name}</strong>
                  <span className="muted small">{k.sets.map(setName).join(" + ")}{k.colony ? " · Colony" : ""}{k.shelters ? " · Shelters" : ""}</span>
                  <button type="button" className="btn small primary" onClick={() => onUse(k)}>Use</button>
                </div>
                <div className="rk-cards">
                  {k.kingdom.map((id) => db.get(id)).sort(costSort).map((c) => (
                    <button key={c.id} type="button" className="chip" onClick={() => onCard(c.id)}>{c.name}</button>
                  ))}
                  {k.landscapes.map((id) => (
                    <button key={id} type="button" className="chip landscape" onClick={() => onCard(id)}>{db.get(id).name}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
