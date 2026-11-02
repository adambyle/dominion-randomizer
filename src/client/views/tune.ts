// The Tune drawer: everything beyond "which sets, how many players", kept out of the way.

import { h, icon, segmented, stepper, type Child } from "../dom";
import { data, db, setIcon } from "../data";
import { buildPool } from "../../shared/randomizer";
import { TRAITS, type Trait } from "../../shared/traits";
import type { AutoBool } from "../../shared/setup";
import type { App } from "../main";

const WEIGHTS = [
  { value: 0, label: "None", title: "Never pick" },
  { value: 0.4, label: "Less" },
  { value: 1, label: "Normal" },
  { value: 2.5, label: "More" },
  { value: 6, label: "Lots" },
];
const SET_WEIGHTS = [0.25, 0.5, 1, 2, 4];
const GROUPS: { id: Trait["group"]; label: string }[] = [
  { id: "type", label: "Card types" }, { id: "cost", label: "Costs" }, { id: "role", label: "What cards do" }, { id: "mechanic", label: "Mechanics" },
];

export function tuneView(app: App): Child {
  const { settings, game } = app.store.state;
  const opts = settings.options;
  const enabled = new Set(opts.enabledBoxes);
  const setOpts = (patch: Partial<typeof opts>) => app.store.dispatch({ type: "options", patch });
  const setSettings = (patch: Partial<typeof settings>) => app.store.dispatch({ type: "settings", patch });
  const pool = buildPool(db, opts.enabledBoxes);
  const kingdomPool = [...pool].map((id) => db.get(id)).filter((c) => c.kind === "kingdom");
  const enabledSets = data.sets.filter((s) => s.boxes.some((b) => enabled.has(b)));
  const autoOptions: { value: AutoBool; label: string; title: string }[] = [
    { value: "auto", label: "Suggested", title: "Prosperity first card / Dark Ages last card" },
    { value: true, label: "Always", title: "" }, { value: false, label: "Never", title: "" },
  ];

  return h("aside.drawer", { role: "dialog", "aria-modal": "true", "aria-label": "Tune" },
    h("header.sheet-head", null,
      h("h2", null, "Tune"),
      h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => app.closeTune() }, icon("close"))),
    h("div.sheet-body", { "data-scroll": "tune" },
      h("section", null,
        h("h3", null, "Game"),
        row("Players", stepper({ value: settings.players, min: 2, max: 6, label: "players", onChange: (n) => setSettings({ players: n }) })),
        row("Kingdom piles", stepper({ value: opts.kingdomSize, min: 1, max: 12, label: "Kingdom piles", onChange: (n) => setOpts({ kingdomSize: n }) })),
        row("Landscapes", stepper({ value: opts.landscapeCount, min: 0, max: 4, label: "landscapes", onChange: (n) => setOpts({ landscapeCount: n }) }),
          "Events, Landmarks, Projects, Ways and Traits"),
        row("Ways, at most", stepper({ value: opts.maxWays, min: 0, max: 4, label: "Ways", onChange: (n) => setOpts({ maxWays: n }) })),
        row("Platinum and Colony", segmented({ value: settings.platinumColony, options: autoOptions, label: "Platinum and Colony", small: true, onChange: (v) => setSettings({ platinumColony: v }) })),
        row("Shelters", segmented({ value: settings.shelters, options: autoOptions, label: "Shelters", small: true, onChange: (v) => setSettings({ shelters: v }) })),
        row("Cards you've played", segmented({ value: settings.playedCards, label: "Cards you've played", small: true,
          options: [
            { value: "any", label: "As usual", title: "Ignore your history" },
            { value: "fewer", label: "Less often", title: "Prefer cards you haven't played yet" },
            { value: "none", label: "Skip", title: "Only cards you haven't played (falls back if there aren't enough)" },
          ], onChange: (v) => setSettings({ playedCards: v }) }),
          `From your history: ${app.store.played().size} cards played so far`),
        pool.has("black-market") && row("Black Market deck", stepper({ value: settings.blackMarketSize, min: 5, max: 60, label: "Black Market cards", onChange: (n) => setSettings({ blackMarketSize: n }) }))),

      h("section", { "data-section": "expansions" },
        h("h3", null, "Expansions"),
        row("Expansions per game", stepper({ value: opts.setsPerGame, min: 0, max: enabledSets.length, label: "expansions per game",
          format: (n) => (n === 0 ? "All" : String(n)), onChange: (n) => setOpts({ setsPerGame: n }) }),
          "How many of your sets each game draws from"),
        h("p.hint", null, "Tap expansions to draw from just those. The count follows your selection, and none selected means all."),
        opts.setsPerGame > 0 && h("div.row.gap", null,
          h("button.btn", { type: "button", onclick: () => app.store.dispatch({ type: "rollSets" }) }, icon("swap"), "Roll expansions")),
        h("p.hint", null, "How often each expansion comes up, for rolling expansions and picking cards."),
        h("ul.set-weights", null, enabledSets.map((s) => {
          const w = opts.setWeights[s.id] ?? 1;
          const img = setIcon(s.id);
          const picked = !!game.sets?.includes(s.id);
          return h("li", { class: picked ? "rolled" : "" },
            h("button.set-name", { type: "button", "aria-pressed": String(picked), title: picked ? "Drop from this game" : "Draw from this expansion",
              onclick: () => app.store.dispatch({ type: "toggleSet", id: s.id }) },
              img && h("img", { src: img.src, alt: "" }), s.name),
            h("div.pips", { role: "radiogroup", "aria-label": `${s.name} weight` }, SET_WEIGHTS.map((v, i) => h("button", {
              type: "button", role: "radio", "aria-checked": String(v === w), class: v <= w ? "on" : "",
              title: ["Rarely", "Less often", "Normal", "More often", "Much more often"][i], onclick: () => setOpts({ setWeights: { ...opts.setWeights, [s.id]: v } }),
            }))));
        })),
        h("button.btn.ghost", { type: "button", onclick: () => app.openWelcome() }, "Change which sets you own")),

      h("section", null,
        h("h3", null, "Card preferences"),
        h("p.hint", null, "Weights make cards more or less likely. “At least” and “at most” are firm limits. Roles like villages and trashing are read from card text."),
        GROUPS.map((g) => {
          const traits = TRAITS.filter((t) => t.group === g.id && kingdomPool.some((c) => t.test(c, db)));
          if (!traits.length) return null;
          return h("div.trait-group", null, h("h4", null, g.label), traits.map((t) => {
            const rule = opts.traitRules[t.id] ?? {};
            const set = (patch: typeof rule) => {
              const next: typeof rule = { ...rule, ...patch };
              for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
              const rules = { ...opts.traitRules };
              if (Object.keys(next).length) rules[t.id] = next; else delete rules[t.id];
              setOpts({ traitRules: rules });
            };
            const active = (rule.weight ?? 1) !== 1 || rule.min !== undefined || rule.max !== undefined;
            return h("div.trait", { class: active ? "active" : "" },
              h("span.trait-name", null, t.label),
              segmented({ value: rule.weight ?? 1, options: WEIGHTS, label: `${t.label} weight`, small: true, onChange: (v) => set({ weight: v === 1 ? undefined : v }) }),
              h("div.limits", { class: rule.min !== undefined || rule.max !== undefined ? "set" : "" },
                h("span.muted", null, "at least"),
                stepper({ value: rule.min ?? 0, min: 0, max: 10, label: `minimum ${t.label}`, format: (n) => (n === 0 ? "–" : String(n)), onChange: (n) => set({ min: n || undefined }) }),
                h("span.muted", null, "at most"),
                stepper({ value: rule.max ?? 11, min: 0, max: 11, label: `maximum ${t.label}`, format: (n) => (n === 11 ? "–" : String(n)), onChange: (n) => set({ max: n === 11 ? undefined : n }) })));
          }));
        }),
        Object.keys(opts.traitRules).length > 0 && h("button.btn.ghost", { type: "button", onclick: () => setOpts({ traitRules: {} }) }, "Reset card preferences"))));
}

function row(label: string, control: Child, hint?: string) {
  return h("div.field", null, h("div", null, h("span.field-label", null, label), hint && h("span.hint", null, hint)), control);
}
