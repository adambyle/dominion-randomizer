import { useEffect, useMemo, useState, type Dispatch } from "react";
import { resolveSetup } from "../../shared/setup";
import { buildPool } from "../../shared/randomizer";
import { createRng } from "../../shared/random";
import { costSort, db, recommended, setName } from "../data";
import type { Action, State } from "../store";
import { CardTile } from "./CardTile";
import { CardPicker } from "./CardPicker";
import { SetupDetails } from "./SetupDetails";

export function KingdomView({ state, dispatch, onCard }: { state: State; dispatch: Dispatch<Action>; onCard: (id: string) => void }) {
  const { settings, game } = state;
  const opts = settings.options;
  const [picking, setPicking] = useState(false);

  const pool = useMemo(() => buildPool(db, opts.enabledBoxes), [opts.enabledBoxes]);
  // Setup choices (Bane, Ally, Trait targets ...) may come from cards outside the enabled boxes
  // when the user added them, so the setup pool also includes the game's own cards.
  const setupPool = useMemo(() => new Set([...pool, ...game.kingdom, ...game.landscapes]), [pool, game.kingdom, game.landscapes]);

  const setup = useMemo(() => game.kingdom.length || game.landscapes.length
    ? resolveSetup({
        kingdom: game.kingdom, landscapes: game.landscapes, players: settings.players,
        platinumColony: game.platinumColony ?? settings.platinumColony, shelters: game.shelters ?? settings.shelters,
        choices: game.choices, acceptChoices: game.official, blackMarketSize: settings.blackMarketSize,
      }, db, setupPool, createRng(game.seed))
    : null,
  [game.kingdom, game.landscapes, game.choices, game.official, game.seed, game.platinumColony, game.shelters,
    settings.players, settings.platinumColony, settings.shelters, settings.blackMarketSize, setupPool]);

  // Keep the resolved choices so later edits don't reshuffle unrelated picks (Druid's Boons etc.).
  useEffect(() => {
    if (setup && JSON.stringify(setup.choices) !== JSON.stringify(game.choices)) {
      dispatch({ type: "choices", choices: setup.choices });
    }
  }, [setup, game.choices, dispatch]);

  const kingdomCards = game.kingdom.map((id) => db.get(id)).sort(costSort);
  const landscapeCards = game.landscapes.map((id) => db.get(id));
  const inGame = new Set([...game.kingdom, ...game.landscapes]);
  const rec = game.recommendedId ? recommended.find((k) => k.id === game.recommendedId) : null;
  const emptySlots = Math.max(0, opts.kingdomSize - game.kingdom.length);
  /** Traits and Obelisk pointing at a pile. */
  const targetBadges = (id: string) => {
    const by = Object.entries(setup?.targets ?? {}).filter(([, pile]) => pile === id).map(([t]) => t);
    return by.length ? by.map((t) => <span key={t} className="badge">{db.get(t).name}</span>) : null;
  };

  const tileActions = (id: string) => {
    const locked = game.locked.includes(id);
    return (
      <>
        <button type="button" className={`icon-btn ${locked ? "on" : ""}`} onClick={() => dispatch({ type: "toggleLock", id })}
          title={locked ? "Unlock (rerolls will replace it)" : "Lock (rerolls keep it)"} aria-pressed={locked}>{locked ? "🔒" : "🔓"}</button>
        <button type="button" className="icon-btn" onClick={() => dispatch({ type: "replace", id })} title="Replace with another random card">↻</button>
        <button type="button" className="icon-btn" onClick={() => dispatch({ type: "remove", id })} title="Remove">✕</button>
      </>
    );
  };

  return (
    <div className="kingdom-view">
      <div className="toolbar">
        <button type="button" className="btn primary" onClick={() => dispatch({ type: "randomize" })}>
          {game.kingdom.length ? (game.locked.length ? "Reroll unlocked" : "Reroll") : "Randomize"}
        </button>
        {opts.setsPerGame > 0 && <button type="button" className="btn" onClick={() => dispatch({ type: "rollSets" })}>Roll expansions</button>}
        <button type="button" className="btn" onClick={() => setPicking(true)}>Add card</button>
        {(game.kingdom.length > 0 || game.landscapes.length > 0) && (
          <button type="button" className="btn ghost" onClick={() => dispatch({ type: "clear" })}>Clear</button>
        )}
      </div>

      {game.sets && game.sets.length > 0 && (
        <p className="sets-line">Expansions this game: {game.sets.map((s) => <span key={s} className="pill rolled">{setName(s)}</span>)}</p>
      )}
      {rec && <p className="sets-line">Recommended kingdom: <strong>{rec.name}</strong> <span className="muted">({rec.group})</span></p>}
      {game.warnings.map((w, i) => <p key={i} className="warning">{w}</p>)}

      {!game.kingdom.length && !game.landscapes.length ? (
        <div className="empty">
          <p>Roll a random kingdom, pick a recommended one, or add the cards you want and randomize the rest.</p>
        </div>
      ) : (
        <>
          <h2 className="section-title">Kingdom <span className="muted">{game.kingdom.length}/{opts.kingdomSize}</span></h2>
          <div className="grid">
            {kingdomCards.map((c) => (
              <CardTile key={c.id} card={c} onOpen={() => onCard(c.id)} actions={tileActions(c.id)}
                badges={targetBadges(c.id)} />
            ))}
            {Array.from({ length: emptySlots }, (_, i) => (
              <button key={i} type="button" className="tile empty-slot" onClick={() => dispatch({ type: "randomize" })}>Empty — randomize to fill</button>
            ))}
          </div>

          {setup && setup.extraKingdom.length > 0 && (
            <div className="grid extra">
              {setup.extraKingdom.map((p) => (
                <CardTile key={p.id} card={db.get(p.id)} onOpen={() => onCard(p.id)}
                  badges={<span className="badge">{p.reasons[0]?.by ? `${db.get(p.reasons[0].by).name}` : "Extra"}</span>} />
              ))}
            </div>
          )}

          {(landscapeCards.length > 0 || (setup && setup.landscapes.length > game.landscapes.length)) && (
            <>
              <h2 className="section-title">Landscapes</h2>
              <div className="grid landscapes">
                {landscapeCards.map((c) => (
                  <CardTile key={c.id} card={c} onOpen={() => onCard(c.id)} actions={tileActions(c.id)}
                    badges={setup?.targets[c.id] ? <span className="badge">→ {db.get(setup.targets[c.id]!).name}</span> : null} />
                ))}
                {setup?.landscapes.filter((l) => !game.landscapes.includes(l.id)).map((l) => (
                  <CardTile key={l.id} card={db.get(l.id)} onOpen={() => onCard(l.id)}
                    badges={<span className="badge">{l.reasons[0]?.by ? `for ${db.get(l.reasons[0].by).name}` : ""}</span>} />
                ))}
              </div>
            </>
          )}

          {setup && (
            <>
              <h2 className="section-title">Setup</h2>
              <SetupDetails setup={setup} onCard={onCard} />
            </>
          )}
        </>
      )}

      {picking && (
        <CardPicker pool={pool} exclude={inGame} onClose={() => setPicking(false)}
          onPick={(id) => { dispatch({ type: "add", id }); setPicking(false); }} />
      )}
    </div>
  );
}
