import { useState } from "react";
import { useAppState } from "./store";
import { OptionsPanel } from "./components/OptionsPanel";
import { KingdomView } from "./components/KingdomView";
import { RecommendedView } from "./components/RecommendedView";
import { CardsView } from "./components/CardsView";
import { CardModal } from "./components/CardModal";

type Tab = "randomizer" | "recommended" | "cards";

export function App() {
  const [state, dispatch] = useAppState();
  const [tab, setTab] = useState<Tab>("randomizer");
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Dominion Randomizer</h1>
        <nav className="tabs" aria-label="Sections">
          {(["randomizer", "recommended", "cards"] as Tab[]).map((t) => (
            <button key={t} type="button" className={tab === t ? "active" : ""} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
              {{ randomizer: "Randomizer", recommended: "Recommended", cards: "Cards" }[t]}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {tab === "randomizer" && (
          <div className="layout">
            <aside className={`sidebar ${optionsOpen ? "open" : ""}`}>
              <button type="button" className="btn options-toggle" onClick={() => setOptionsOpen((o) => !o)} aria-expanded={optionsOpen}>
                {optionsOpen ? "Hide options" : "Options"}
              </button>
              <div className="sidebar-body">
                <OptionsPanel settings={state.settings} game={state.game} dispatch={dispatch} />
              </div>
            </aside>
            <section className="content">
              <KingdomView state={state} dispatch={dispatch} onCard={setOpenCard} />
            </section>
          </div>
        )}
        {tab === "recommended" && (
          <RecommendedView enabledBoxes={state.settings.options.enabledBoxes} onCard={setOpenCard}
            onUse={(k) => { dispatch({ type: "loadRecommended", kingdom: k }); setTab("randomizer"); }} />
        )}
        {tab === "cards" && <CardsView enabledBoxes={state.settings.options.enabledBoxes} onCard={setOpenCard} />}
      </main>

      <footer className="footer muted small">
        Card data from the <a href="https://wiki.dominionstrategy.com" target="_blank" rel="noreferrer">Dominion Strategy Wiki</a> (CC BY-NC-SA 3.0).
        Dominion is © Donald X. Vaccarino and Rio Grande Games; this is an unofficial fan tool.
      </footer>

      {openCard && <CardModal key={openCard} id={openCard} onClose={() => setOpenCard(null)} />}
    </div>
  );
}
