// App state: randomizer options and the current game, persisted per browser.

import { useEffect, useReducer } from "react";
import type { RecommendedKingdom } from "../shared/types";
import type { AutoBool, Choices } from "../shared/setup";
import { DEFAULT_OPTIONS, randomize, replaceOne, rollSets, type RandomizerOptions } from "../shared/randomizer";
import { createRng } from "../shared/random";
import { data, db } from "./data";

export interface Game {
  kingdom: string[];
  landscapes: string[];
  /** Cards the user locked or added; rerolls keep them. */
  locked: string[];
  /** Expansions rolled for this game when "expansions per game" is set. */
  sets: string[] | null;
  choices: Choices;
  /** True while the game is an unmodified recommended kingdom (its choices are used as printed). */
  official: boolean;
  recommendedId: string | null;
  /** Per-game overrides of the Colony/Shelters settings (a recommended kingdom fixes them). */
  platinumColony: boolean | null;
  shelters: boolean | null;
  seed: number;
  warnings: string[];
}

export interface Settings {
  options: RandomizerOptions;
  players: number;
  platinumColony: AutoBool;
  shelters: AutoBool;
  blackMarketSize: number;
}

export interface State {
  settings: Settings;
  game: Game;
}

const newSeed = () => (Math.random() * 2 ** 32) >>> 0;

const emptyGame = (): Game => ({
  kingdom: [], landscapes: [], locked: [], sets: null, choices: {}, official: false,
  recommendedId: null, platinumColony: null, shelters: null, seed: newSeed(), warnings: [],
});

const defaultSettings = (): Settings => ({
  // Until the user picks, assume the current printing of everything.
  options: { ...DEFAULT_OPTIONS, enabledBoxes: data.boxes.filter((b) => b.edition !== 1).map((b) => b.id) },
  players: 3,
  platinumColony: "auto",
  shelters: "auto",
  blackMarketSize: 15,
});

export type Action =
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "options"; patch: Partial<RandomizerOptions> }
  | { type: "rollSets" }
  | { type: "randomize" }
  | { type: "replace"; id: string }
  | { type: "toggleLock"; id: string }
  | { type: "add"; id: string }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "choices"; choices: Choices }
  | { type: "loadRecommended"; kingdom: RecommendedKingdom };

function edited(game: Game, patch: Partial<Game>): Game {
  return { ...game, ...patch, official: false, recommendedId: patch.recommendedId ?? null };
}

function reducer(state: State, action: Action): State {
  const { settings, game } = state;
  const opts = settings.options;
  switch (action.type) {
    case "settings":
      return { ...state, settings: { ...settings, ...action.patch } };
    case "options":
      return { ...state, settings: { ...settings, options: { ...opts, ...action.patch } } };
    case "rollSets": {
      const sets = rollSets(db, opts, createRng(newSeed()));
      return { ...state, game: { ...game, sets } };
    }
    case "randomize": {
      const seed = newSeed();
      const rng = createRng(seed);
      const sets = opts.setsPerGame ? (game.sets ?? rollSets(db, opts, rng)) : null;
      const lockedKingdom = game.kingdom.filter((id) => game.locked.includes(id));
      const lockedLandscapes = game.landscapes.filter((id) => game.locked.includes(id));
      const draft = randomize(db, opts, { sets: sets ?? undefined, locked: lockedKingdom, lockedLandscapes }, rng);
      return { ...state, game: edited(game, { ...draft, sets, seed, choices: {}, platinumColony: null, shelters: null }) };
    }
    case "replace": {
      const rng = createRng(newSeed());
      const draft = replaceOne(db, opts, { ...game, warnings: [] }, action.id, { sets: game.sets ?? undefined }, rng);
      return { ...state, game: edited(game, { kingdom: draft.kingdom, landscapes: draft.landscapes, warnings: draft.warnings }) };
    }
    case "toggleLock": {
      const locked = game.locked.includes(action.id) ? game.locked.filter((x) => x !== action.id) : [...game.locked, action.id];
      return { ...state, game: { ...game, locked } };
    }
    case "add": {
      const card = db.get(action.id);
      if (game.kingdom.includes(card.id) || game.landscapes.includes(card.id)) return state;
      const patch = card.kind === "landscape"
        ? { landscapes: [...game.landscapes, card.id] }
        : { kingdom: [...game.kingdom, card.id] };
      return { ...state, game: edited(game, { ...patch, locked: [...game.locked, card.id], warnings: [] }) };
    }
    case "remove":
      return { ...state, game: edited(game, {
        kingdom: game.kingdom.filter((x) => x !== action.id),
        landscapes: game.landscapes.filter((x) => x !== action.id),
        locked: game.locked.filter((x) => x !== action.id),
        warnings: [],
      }) };
    case "clear":
      return { ...state, game: { ...emptyGame(), sets: game.sets } };
    case "choices":
      return { ...state, game: { ...game, choices: action.choices } };
    case "loadRecommended": {
      const k = action.kingdom;
      const traits = k.landscapes.filter((l) => db.get(l).types.includes("Trait"));
      const choices: Choices = {
        bane: k.choices.bane as string | undefined,
        ferryman: k.choices.ferryman as string | undefined,
        riverboat: k.choices.riverboat as string | undefined,
        wayOfTheMouse: k.choices.wayOfTheMouse as string | undefined,
        approachingArmy: k.choices.approachingArmy as string | undefined,
        druidBoons: k.choices.druidBoons as string[] | undefined,
        ally: k.landscapes.find((l) => db.get(l).types.includes("Ally")),
        prophecy: k.landscapes.find((l) => db.get(l).types.includes("Prophecy")),
        traits: traits[0] && k.choices.traitFor1 ? { [traits[0]]: k.choices.traitFor1 as string } : undefined,
      };
      const standard = k.landscapes.filter((l) => !/Ally|Prophecy/.test(db.get(l).types.join(" ")));
      return {
        settings,
        game: {
          ...emptyGame(), kingdom: k.kingdom, landscapes: standard, locked: [...k.kingdom, ...standard],
          choices, official: true, recommendedId: k.id, platinumColony: k.colony, shelters: k.shelters,
        },
      };
    }
  }
}

const KEY = "dominion-randomizer:v1";

function load(): State {
  const fresh = { settings: defaultSettings(), game: emptyGame() };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as State | null;
    if (!saved) return fresh;
    // Drop anything that no longer exists after a data refresh.
    const known = (ids: string[]) => ids.filter((id) => db.byId.has(id));
    const boxes = new Set(data.boxes.map((b) => b.id));
    return {
      settings: { ...fresh.settings, ...saved.settings, options: { ...fresh.settings.options, ...saved.settings.options,
        enabledBoxes: saved.settings.options.enabledBoxes.filter((b) => boxes.has(b)) } },
      game: { ...fresh.game, ...saved.game, kingdom: known(saved.game.kingdom), landscapes: known(saved.game.landscapes) },
    };
  } catch {
    return fresh;
  }
}

export function useAppState() {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode etc. */ }
  }, [state]);
  return [state, dispatch] as const;
}
