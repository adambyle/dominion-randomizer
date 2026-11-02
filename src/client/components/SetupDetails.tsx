import type { ReactNode } from "react";
import type { Pile, Reason, SetupResult } from "../../shared/setup";
import { db } from "../data";
import { Markup } from "../Markup";

const name = (id: string) => db.byId.get(id)?.name ?? id;

function Reasons({ reasons, onCard }: { reasons: Reason[]; onCard: (id: string) => void }) {
  const shown = reasons.filter((r) => r.text !== "Kingdom pile" && r.text !== "Landscape");
  if (!shown.length) return null;
  return (
    <span className="reasons">
      {shown.map((r, i) => (
        <span key={i} className="reason">
          {r.by && db.byId.has(r.by)
            ? <><button type="button" className="link" onClick={() => onCard(r.by!)}>{name(r.by)}</button>: </>
            : null}
          <Markup text={r.text} />
        </span>
      ))}
    </span>
  );
}

function CardLink({ id, onCard, children }: { id: string; onCard: (id: string) => void; children?: ReactNode }) {
  if (!db.byId.has(id)) return <span>{children ?? name(id)}</span>;
  return <button type="button" className="link" onClick={() => onCard(id)}>{children ?? name(id)}</button>;
}

function PileLine({ pile, onCard }: { pile: Pile; onCard: (id: string) => void }) {
  const label = pile.id === "ruins" ? "Ruins" : pile.id === "loot" ? "Loot" : null;
  return (
    <li>
      <span className="item">
        {label ? <strong>{label}</strong> : <CardLink id={pile.id} onCard={onCard} />}
        <span className="count">×{pile.count}</span>
        {pile.members && (
          <span className="muted small"> ({pile.shuffled ? "shuffled: " : ""}{pile.members.map((m, i) => (
            <span key={m.id}>{i > 0 && ", "}<CardLink id={m.id} onCard={onCard} />{m.count > 1 && pile.id !== "ruins" ? ` ×${m.count}` : ""}</span>
          ))})</span>
        )}
      </span>
      <Reasons reasons={pile.reasons} onCard={onCard} />
    </li>
  );
}

function Section({ title, children, show = true }: { title: string; children: ReactNode; show?: boolean }) {
  if (!show) return null;
  return <section className="setup-section"><h3>{title}</h3><ul className="setup-list">{children}</ul></section>;
}

export function SetupDetails({ setup, onCard }: { setup: SetupResult; onCard: (id: string) => void }) {
  const basicExtras = setup.basic.filter((p) => p.reasons.length);
  const plainBasics = setup.basic.filter((p) => !p.reasons.length);
  const targets = Object.entries(setup.targets);

  return (
    <div className="setup">
      {setup.warnings.length > 0 && (
        <div className="warning">{setup.warnings.map((w, i) => <p key={i}>{w}</p>)}</div>
      )}

      <Section title="Extra Kingdom piles" show={setup.extraKingdom.length > 0}>
        {setup.extraKingdom.map((p) => <PileLine key={p.id} pile={p} onCard={onCard} />)}
      </Section>

      <Section title="Basic Supply">
        {basicExtras.map((p) => <PileLine key={p.id} pile={p} onCard={onCard} />)}
        <li className="muted small">
          {plainBasics.map((p, i) => <span key={p.id}>{i > 0 && " · "}<CardLink id={p.id} onCard={onCard} /> ×{p.count}</span>)}
        </li>
        {!setup.platinumColony.used && setup.platinumColony.reason.by && <li className="muted small">No Platinum or Colony ({setup.platinumColony.reason.text}).</li>}
      </Section>

      <Section title="Not in the Supply" show={setup.nonSupply.length > 0}>
        {setup.nonSupply.map((p) => <PileLine key={p.id} pile={p} onCard={onCard} />)}
      </Section>

      <Section title="Boons & Hexes" show={setup.decks.length > 0}>
        {setup.decks.map((d) => (
          <li key={d.id}>
            <span className="item"><strong>{d.id === "boons" ? "Boons deck" : "Hexes deck"}</strong> <span className="count">{d.cards.length} cards, shuffled</span></span>
            <Reasons reasons={d.reasons} onCard={onCard} />
          </li>
        ))}
      </Section>

      <Section title="Set aside" show={setup.setAside.length > 0}>
        {setup.setAside.map((s) => (
          <li key={s.id}>
            <span className="item">
              {s.id === "black-market"
                ? <details><summary>{s.cards.length} cards</summary>{s.cards.map((c, i) => <span key={c}>{i > 0 && ", "}<CardLink id={c} onCard={onCard} /></span>)}</details>
                : s.cards.map((c, i) => <span key={c}>{i > 0 && ", "}<CardLink id={c} onCard={onCard} /></span>)}
            </span>
            <Reasons reasons={s.reasons} onCard={onCard} />
          </li>
        ))}
      </Section>

      <Section title="Landscape targets" show={targets.length > 0}>
        {targets.map(([by, pile]) => (
          <li key={by}><span className="item"><CardLink id={by} onCard={onCard} /> → <CardLink id={pile} onCard={onCard} /></span></li>
        ))}
      </Section>

      <Section title="States & Artifacts" show={setup.statuses.length > 0}>
        {setup.statuses.map((s) => (
          <li key={s.id}><span className="item"><CardLink id={s.id} onCard={onCard} /></span><Reasons reasons={s.reasons} onCard={onCard} /></li>
        ))}
      </Section>

      <Section title="Tokens & mats" show={setup.tokens.length > 0}>
        {setup.tokens.map((t) => (
          <li key={t.id}><span className="item">{t.label}</span><Reasons reasons={t.reasons} onCard={onCard} /></li>
        ))}
      </Section>

      <Section title="Each player starts with">
        <li>
          <span className="item">
            {setup.startingDeck.cards.map((c, i) => <span key={c.id}>{i > 0 && ", "}{c.count} <CardLink id={c.id} onCard={onCard} /></span>)}
          </span>
          <Reasons reasons={setup.startingDeck.reasons} onCard={onCard} />
        </li>
        {(setup.playerStart.coffers > 0 || setup.playerStart.favors > 0) && (
          <li>
            <span className="item">
              {[setup.playerStart.coffers && `${setup.playerStart.coffers} Coffers`, setup.playerStart.favors && `${setup.playerStart.favors} Favor${setup.playerStart.favors > 1 ? "s" : ""}`].filter(Boolean).join(", ")}
            </span>
            <Reasons reasons={setup.playerStart.reasons} onCard={onCard} />
          </li>
        )}
      </Section>

      <Section title="Trash" show={setup.trash.length > 0}>
        <li><span className="item">{setup.trash.map((c, i) => <span key={c.id}>{i > 0 && ", "}<CardLink id={c.id} onCard={onCard} /></span>)}</span>
          <span className="reasons"><span className="reason">Necromancer puts the Zombies in the trash</span></span></li>
      </Section>

      <Section title="Setup notes" show={setup.notes.length > 0}>
        {setup.notes.map((n, i) => (
          <li key={i}><span className="item"><CardLink id={n.by!} onCard={onCard} /></span> <span className="note"><Markup text={n.text} onCard={onCard} /></span></li>
        ))}
      </Section>
    </div>
  );
}
