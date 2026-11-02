import { useState } from "react";
import type { FaqItem } from "../../shared/types";
import { CostIcon, Markup } from "../Markup";
import { boxName, data, db, setName, useFaq, wikiUrl } from "../data";
import { Modal } from "./Modal";
import { typeColors } from "./CardTile";

function FaqList({ items, onCard }: { items: FaqItem[]; onCard: (id: string) => void }) {
  return (
    <ul className="faq">
      {items.map((item, i) => (
        <li key={i}>
          <Markup text={item.text} onCard={onCard} />
          {item.children && <FaqList items={item.children} onCard={onCard} />}
        </li>
      ))}
    </ul>
  );
}

/** A card's face, FAQ and (for split piles) composition. Card links inside navigate within the modal. */
export function CardModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [stack, setStack] = useState([id]);
  const current = stack[stack.length - 1]!;
  const card = db.get(current);
  const faq = useFaq(current);
  const open = (next: string) => setStack((s) => (s[s.length - 1] === next ? s : [...s, next]));
  const pileParent = card.pileId ? db.get(card.pileId) : null;

  return (
    <Modal
      onClose={onClose}
      title={<>
        {stack.length > 1 && <button type="button" className="icon-btn back" onClick={() => setStack((s) => s.slice(0, -1))} aria-label="Back">←</button>}
        {card.name}
      </>}
    >
      <div className={`card-face ${typeColors(card).join(" ")}`}>
        <div className="card-face-head">
          {card.cost && <CostIcon coin={card.cost.coin} debt={card.cost.debt} potion={card.cost.potion} extra={card.cost.extra} />}
          <span className="card-face-types">{card.types.join(" – ")}</span>
        </div>
        <div className="card-face-text"><Markup text={card.text} onCard={open} /></div>
        {card.text2 && <><hr className="divline" /><div className="card-face-text"><Markup text={card.text2} onCard={open} /></div></>}
      </div>

      <p className="muted small">
        {[setName(card.set), ...card.boxes.map(boxName).filter((b) => b !== setName(card.set))].join(" · ")}
        {card.quantity ? ` · ${card.quantity} in the box` : ""}
        {card.illustrator ? ` · Art: ${card.illustrator}` : ""}
      </p>

      {pileParent && (
        <p>Part of the <button type="button" className="link" onClick={() => open(pileParent.id)}>{pileParent.name}</button> pile.</p>
      )}

      {card.pile && (
        <section>
          <h3>Pile composition</h3>
          <p className="muted small">
            {card.pile.shuffled ? "Shuffled face down; only the top card is face up." : "In this order, top card first; only the top card can be bought or gained."}
          </p>
          <ol className="pile-list">
            {card.pile.members.map((m) => {
              const mc = db.get(m);
              return (
                <li key={m}>
                  <button type="button" className="link" onClick={() => open(m)}>{mc.name}</button>
                  {mc.cost && <> <CostIcon coin={mc.cost.coin} debt={mc.cost.debt} potion={mc.cost.potion} /></>}
                  <span className="muted"> × {mc.quantity ?? 1}{card.id === "castles" && (mc.quantity ?? 1) > 1 ? " (1 in 2-player games)" : ""}</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {data.setupNotes[current] && (
        <section>
          <h3>Setup</h3>
          <p><Markup text={data.setupNotes[current]!} onCard={open} /></p>
        </section>
      )}

      <section>
        <h3>FAQ</h3>
        {faq === undefined && <p className="muted">Loading…</p>}
        {faq === null && <p className="muted">No FAQ for this card.</p>}
        {faq?.filter((s) => !s.deprecated).map((s, i) => (
          <div key={i}>
            {(faq.length > 1 || s.heading !== "FAQ") && <h4>{s.heading}</h4>}
            <FaqList items={s.items} onCard={open} />
          </div>
        ))}
        {faq?.filter((s) => s.deprecated).map((s, i) => (
          <details key={i} className="deprecated">
            <summary>{s.heading}</summary>
            <FaqList items={s.items} onCard={open} />
          </details>
        ))}
      </section>

      <p className="attribution small muted">
        Card text and FAQ from the <a href={wikiUrl(card.wikiTitle)} target="_blank" rel="noreferrer">Dominion Strategy Wiki</a> (CC BY-NC-SA 3.0).
      </p>
    </Modal>
  );
}
