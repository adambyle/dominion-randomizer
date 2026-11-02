import { useMemo, type Dispatch } from "react";
import type { AutoBool } from "../../shared/setup";
import { buildPool } from "../../shared/randomizer";
import { TRAITS } from "../../shared/traits";
import { data, db } from "../data";
import type { Action, Game, Settings } from "../store";

const WEIGHTS: { label: string; value: number }[] = [
  { label: "Exclude", value: 0 },
  { label: "Fewer", value: 0.4 },
  { label: "Normal", value: 1 },
  { label: "More", value: 2.5 },
  { label: "Many more", value: 6 },
];

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" inputMode="numeric" min={min} max={max} value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))} />
    </label>
  );
}

function AutoSelect({ label, value, onChange }: { label: string; value: AutoBool; onChange: (v: AutoBool) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={String(value)} onChange={(e) => onChange(e.target.value === "auto" ? "auto" : e.target.value === "true")}>
        <option value="auto">Suggested rule</option>
        <option value="true">Always</option>
        <option value="false">Never</option>
      </select>
    </label>
  );
}

export function OptionsPanel({ settings, game, dispatch }: { settings: Settings; game: Game; dispatch: Dispatch<Action> }) {
  const opts = settings.options;
  const enabled = new Set(opts.enabledBoxes);
  const setOpts = (patch: Partial<typeof opts>) => dispatch({ type: "options", patch });
  const toggleBox = (id: string) =>
    setOpts({ enabledBoxes: enabled.has(id) ? opts.enabledBoxes.filter((b) => b !== id) : [...opts.enabledBoxes, id] });

  const pool = useMemo(() => buildPool(db, opts.enabledBoxes), [opts.enabledBoxes]);
  // Only offer trait rules that some enabled card can satisfy.
  const relevantTraits = useMemo(() => {
    const kingdom = [...pool].map((id) => db.get(id)).filter((c) => c.kind === "kingdom");
    return TRAITS.filter((t) => kingdom.some((c) => t.test(c, db)));
  }, [pool]);

  const promos = data.boxes.filter((b) => b.set === "promo");
  const sets = data.sets.filter((s) => s.id !== "promo");
  const rolled = new Set(game.sets ?? []);

  return (
    <div className="options">
      <section>
        <h3>Expansions</h3>
        <div className="row gap">
          <button type="button" className="btn small" onClick={() => setOpts({ enabledBoxes: data.boxes.map((b) => b.id) })}>All</button>
          <button type="button" className="btn small" onClick={() => setOpts({ enabledBoxes: [] })}>None</button>
        </div>
        <ul className="set-list">
          {sets.map((s) => {
            const on = s.boxes.some((b) => enabled.has(b));
            return (
              <li key={s.id} className={`${on ? "on" : ""} ${rolled.has(s.id) ? "rolled" : ""}`}>
                <div className="set-name">
                  {s.name}
                  {rolled.has(s.id) && <span className="pill">In this game</span>}
                </div>
                <div className="set-boxes">
                  {s.boxes.map((b) => {
                    const box = data.boxes.find((x) => x.id === b)!;
                    const label = box.edition ? (s.id === "cornucopia-guilds" && box.edition === 1 ? box.name.replace(" (1st Edition)", " 1E") : `${box.edition === 1 ? "1st" : "2nd"} ed.`) : "Owned";
                    return (
                      <label key={b} className="check">
                        <input type="checkbox" checked={enabled.has(b)} onChange={() => toggleBox(b)} /> {label}
                      </label>
                    );
                  })}
                </div>
                {on && (
                  <label className="weight" title="Weight for rolling this expansion and its cards">
                    <span>Weight</span>
                    <input type="range" min={0} max={4} step={0.5} value={opts.setWeights[s.id] ?? 1}
                      onChange={(e) => setOpts({ setWeights: { ...opts.setWeights, [s.id]: Number(e.target.value) } })} />
                    <output>{(opts.setWeights[s.id] ?? 1).toFixed(1)}×</output>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
        <details>
          <summary>Promos ({promos.filter((b) => enabled.has(b.id)).length}/{promos.length})</summary>
          <div className="promo-grid">
            {promos.map((b) => (
              <label key={b.id} className="check">
                <input type="checkbox" checked={enabled.has(b.id)} onChange={() => toggleBox(b.id)} /> {b.name.replace(" (Promo)", "")}
              </label>
            ))}
          </div>
        </details>
      </section>

      <section>
        <h3>Game</h3>
        <div className="fields">
          <NumberField label="Players" value={settings.players} min={2} max={6} onChange={(n) => dispatch({ type: "settings", patch: { players: n } })} />
          <NumberField label="Expansions per game (0 = all)" value={opts.setsPerGame} min={0} max={20} onChange={(n) => setOpts({ setsPerGame: n })} />
          <NumberField label="Kingdom piles" value={opts.kingdomSize} min={1} max={20} onChange={(n) => setOpts({ kingdomSize: n })} />
          <NumberField label="Landscapes" value={opts.landscapeCount} min={0} max={6} onChange={(n) => setOpts({ landscapeCount: n })} />
          <NumberField label="…of which Ways, at most" value={opts.maxWays} min={0} max={6} onChange={(n) => setOpts({ maxWays: n })} />
          <AutoSelect label="Platinum & Colony" value={settings.platinumColony} onChange={(v) => dispatch({ type: "settings", patch: { platinumColony: v } })} />
          <AutoSelect label="Shelters" value={settings.shelters} onChange={(v) => dispatch({ type: "settings", patch: { shelters: v } })} />
          {pool.has("black-market") && (
            <NumberField label="Black Market deck size" value={settings.blackMarketSize} min={5} max={60}
              onChange={(n) => dispatch({ type: "settings", patch: { blackMarketSize: n } })} />
          )}
        </div>
      </section>

      <section>
        <h3>Card preferences</h3>
        <p className="muted small">Weights change how likely cards are; minimums and maximums are hard limits. “Village”, “Trashing” and similar are detected from card text.</p>
        <table className="traits">
          <thead><tr><th></th><th>Weight</th><th>Min</th><th>Max</th></tr></thead>
          <tbody>
            {relevantTraits.map((t) => {
              const rule = opts.traitRules[t.id] ?? {};
              const set = (patch: typeof rule) => {
                const next = { ...rule, ...patch };
                for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
                setOpts({ traitRules: { ...opts.traitRules, [t.id]: next } });
              };
              const active = rule.weight !== undefined && rule.weight !== 1 || rule.min || rule.max !== undefined;
              return (
                <tr key={t.id} className={active ? "active" : ""}>
                  <td>{t.label}</td>
                  <td>
                    <select value={rule.weight ?? 1} onChange={(e) => set({ weight: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })}>
                      {WEIGHTS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                    </select>
                  </td>
                  <td><input type="number" min={0} max={10} value={rule.min ?? ""} placeholder="–"
                    onChange={(e) => set({ min: e.target.value === "" ? undefined : Number(e.target.value) })} /></td>
                  <td><input type="number" min={0} max={10} value={rule.max ?? ""} placeholder="–"
                    onChange={(e) => set({ max: e.target.value === "" ? undefined : Number(e.target.value) })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {Object.keys(opts.traitRules).length > 0 && (
          <button type="button" className="btn small" onClick={() => setOpts({ traitRules: {} })}>Reset preferences</button>
        )}
      </section>
    </div>
  );
}
