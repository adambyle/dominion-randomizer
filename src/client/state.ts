// Persisted app state (settings + current game) and the actions that change it.

import type { RecommendedKingdom } from "../shared/types";
import type { HistoryGame } from "../shared/history";
import { resolveSetup, type AutoBool, type Choices, type SetupResult } from "../shared/setup";
import { buildPool, DEFAULT_OPTIONS, poolSets, randomize, replaceOne, rollSets, type RandomizerOptions } from "../shared/randomizer";
import { createRng } from "../shared/random";
import { data, db } from "./data";

export interface Game {
  kingdom: string[];
  landscapes: string[];
  /** Cards the user locked or added; deals keep them. */
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
  /** The history entry this table was saved as; any edit starts a new draft (null). */
  playedId: string | null;
}

export interface Settings {
  options: RandomizerOptions;
  players: number;
  platinumColony: AutoBool;
  shelters: AutoBool;
  blackMarketSize: number;
  /** Set once the user has picked their sets on the first-visit screen. */
  onboarded: boolean;
  /** When enabledBoxes last changed (ms), so account sync keeps the newest choice. */
  boxesUpdated: number;
  /** Cards from your play history: deal them as usual, less often, or not at all. */
  playedCards: PlayedMode;
}

export type PlayedMode = "any" | "fewer" | "none";
/** Weight of an already-played card when dealing with "fewer". */
const FEWER_WEIGHT = 0.15;

export interface State {
  settings: Settings;
  game: Game;
}

const newSeed = () => (Math.random() * 2 ** 32) >>> 0;

const emptyGame = (): Game => ({
  kingdom: [], landscapes: [], locked: [], sets: null, choices: {}, official: false,
  recommendedId: null, platinumColony: null, shelters: null, seed: newSeed(), warnings: [], playedId: null,
});

const defaultSettings = (): Settings => ({
  options: { ...DEFAULT_OPTIONS, enabledBoxes: ["dominion-2"] },
  players: 3,
  platinumColony: "auto",
  shelters: "auto",
  blackMarketSize: 15,
  onboarded: false,
  boxesUpdated: 0,
  playedCards: "any",
});

export type Action =
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "options"; patch: Partial<RandomizerOptions> }
  | { type: "rollSets" }
  /** Adds or drops one expansion from this game's expansions. */
  | { type: "toggleSet"; id: string }
  | { type: "deal" }
  | { type: "fill" }
  | { type: "replace"; id: string }
  | { type: "toggleLock"; id: string }
  | { type: "add"; id: string }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "choices"; choices: Choices }
  | { type: "loadRecommended"; kingdom: RecommendedKingdom }
  | { type: "loadHistory"; game: HistoryGame }
  | { type: "played"; id: string | null }
  /** Owned boxes from the account (keeps the account's timestamp). */
  | { type: "accountBoxes"; enabledBoxes: string[]; updated: number };

function edited(game: Game, patch: Partial<Game>): Game {
  return { ...game, ...patch, official: false, recommendedId: null, playedId: null };
}

/** What the reducer needs from outside the stored state. */
interface Env {
  /** Cards played in earlier games (from history). */
  played: Set<string>;
}

/**
 * Runs a roll with the "played cards" preference. With "none", if skipping played cards leaves the
 * deal shorter than a normal one would be, rolls again preferring unplayed cards instead.
 */
function withPlayed<T extends { kingdom: string[]; landscapes: string[]; warnings: string[] }>(settings: Settings, env: Env, roll: (cardWeight?: (id: string) => number) => T): T {
  if (settings.playedCards === "any" || !env.played.size) return roll();
  if (settings.playedCards === "none") {
    const strict = roll((id) => (env.played.has(id) ? 0 : 1));
    const normal = roll();
    if (strict.kingdom.length >= normal.kingdom.length && strict.landscapes.length >= normal.landscapes.length) return strict;
  }
  const r = roll((id) => (env.played.has(id) ? FEWER_WEIGHT : 1));
  if (settings.playedCards === "none") r.warnings = [...r.warnings, "Not enough cards you haven't played yet, so some you have are included."];
  return r;
}

function reduce(state: State, action: Action, env: Env): State {
  const { settings, game } = state;
  const opts = settings.options;
  switch (action.type) {
    case "settings":
      return { ...state, settings: { ...settings, ...action.patch } };
    case "options": {
      const options = { ...opts, ...action.patch };
      let next = game;
      if (action.patch.setsPerGame !== undefined) {
        // The expansion count and the selected expansions are one thing: resizing keeps what's selected where it can.
        const sets = options.setsPerGame ? rollSets(db, options, createRng(newSeed()), game.sets ?? []) : null;
        next = { ...game, sets };
      } else if (action.patch.enabledBoxes && game.sets) {
        const available = poolSets(db, buildPool(db, options.enabledBoxes));
        const kept = game.sets.filter((x) => available.includes(x));
        next = { ...game, sets: kept.length ? kept : null };
        options.setsPerGame = kept.length;
      }
      return { ...state, game: next, settings: { ...settings, options,
        boxesUpdated: action.patch.enabledBoxes ? Date.now() : settings.boxesUpdated } };
    }
    case "accountBoxes": {
      const known = new Set(data.boxes.map((b) => b.id));
      return { ...state, settings: { ...settings, options: { ...opts, enabledBoxes: action.enabledBoxes.filter((b) => known.has(b)) },
        boxesUpdated: action.updated } };
    }
    case "played":
      return { ...state, game: { ...game, playedId: action.id } };
    case "loadHistory": {
      const g = action.game;
      const known = (ids: string[]) => ids.filter((id) => db.byId.has(id));
      return { settings: { ...settings, players: g.players }, game: {
        ...emptyGame(), kingdom: known(g.kingdom), landscapes: known(g.landscapes), choices: g.choices,
        // Exactly as played: the saved choices are used as they were, even if they break a usual rule.
        official: true, recommendedId: g.recommendedId, platinumColony: g.platinumColony, shelters: g.shelters,
      } };
    }
    case "rollSets":
      if (!opts.setsPerGame) return state;
      return { ...state, game: { ...game, sets: rollSets(db, opts, createRng(newSeed())) } };
    case "toggleSet": {
      // Selecting expansions sets the count; none selected means all of them.
      const current = game.sets ?? [];
      const next = current.includes(action.id) ? current.filter((x) => x !== action.id) : [...current, action.id];
      return { ...state, game: { ...game, sets: next.length ? next : null },
        settings: { ...settings, options: { ...opts, setsPerGame: next.length } } };
    }
    case "deal": {
      const seed = newSeed();
      const rng = createRng(seed);
      const sets = game.sets ?? (opts.setsPerGame ? rollSets(db, opts, rng) : null);
      const draft = withPlayed(settings, env, (cardWeight) => randomize(db, opts, {
        sets: sets ?? undefined,
        locked: game.kingdom.filter((id) => game.locked.includes(id)),
        lockedLandscapes: game.landscapes.filter((id) => game.locked.includes(id)),
        cardWeight,
      }, createRng((seed ^ 0x9e3779b9) >>> 0)));
      return { ...state, game: edited(game, { ...draft, sets, seed, choices: {}, platinumColony: null, shelters: null }) };
    }
    case "fill": {
      // Fill empty slots only: everything already on the table stays (without being locked).
      const seed = newSeed();
      const draft = withPlayed(settings, env, (cardWeight) =>
        randomize(db, opts, { sets: game.sets ?? undefined, locked: game.kingdom, lockedLandscapes: game.landscapes, cardWeight }, createRng(seed)));
      return { ...state, game: edited(game, { kingdom: draft.kingdom, landscapes: draft.landscapes, warnings: draft.warnings }) };
    }
    case "replace": {
      const seed = newSeed();
      const draft = withPlayed(settings, env, (cardWeight) =>
        replaceOne(db, opts, { ...game, warnings: [] }, action.id, { sets: game.sets ?? undefined, cardWeight }, createRng(seed)));
      return { ...state, game: edited(game, { kingdom: draft.kingdom, landscapes: draft.landscapes, warnings: draft.warnings }) };
    }
    case "toggleLock": {
      const locked = game.locked.includes(action.id) ? game.locked.filter((x) => x !== action.id) : [...game.locked, action.id];
      return { ...state, game: { ...game, locked } };
    }
    case "add": {
      const card = db.get(action.id);
      if (game.kingdom.includes(card.id) || game.landscapes.includes(card.id)) return state;
      const patch = card.kind === "landscape" ? { landscapes: [...game.landscapes, card.id] } : { kingdom: [...game.kingdom, card.id] };
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
      const isType = (id: string, t: string) => db.get(id).types.includes(t);
      const trait = k.landscapes.find((l) => isType(l, "Trait"));
      const choices: Choices = {
        bane: k.choices.bane as string | undefined,
        ferryman: k.choices.ferryman as string | undefined,
        riverboat: k.choices.riverboat as string | undefined,
        wayOfTheMouse: k.choices.wayOfTheMouse as string | undefined,
        approachingArmy: k.choices.approachingArmy as string | undefined,
        druidBoons: k.choices.druidBoons as string[] | undefined,
        ally: k.landscapes.find((l) => isType(l, "Ally")),
        prophecy: k.landscapes.find((l) => isType(l, "Prophecy")),
        traits: trait && k.choices.traitFor1 ? { [trait]: k.choices.traitFor1 as string } : undefined,
      };
      const standard = k.landscapes.filter((l) => !isType(l, "Ally") && !isType(l, "Prophecy"));
      return {
        settings,
        game: {
          // Unlocked, so "Deal again" moves on to a random kingdom.
          ...emptyGame(), kingdom: k.kingdom, landscapes: standard,
          choices, official: true, recommendedId: k.id, platinumColony: k.colony, shelters: k.shelters,
        },
      };
    }
  }
}

const KEY = "dominion-randomizer:v2";

function load(): State {
  const fresh: State = { settings: defaultSettings(), game: emptyGame() };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as State | null;
    if (!saved) return fresh;
    // Drop anything that no longer exists after a data refresh.
    const known = (ids: string[]) => ids.filter((id) => db.byId.has(id));
    const boxes = new Set(data.boxes.map((b) => b.id));
    return {
      settings: { ...fresh.settings, ...saved.settings, options: { ...fresh.settings.options, ...saved.settings.options,
        enabledBoxes: saved.settings.options.enabledBoxes.filter((b) => boxes.has(b)) } },
      game: { ...fresh.game, ...saved.game, kingdom: known(saved.game.kingdom), landscapes: known(saved.game.landscapes),
        locked: known(saved.game.locked) },
    };
  } catch {
    return fresh;
  }
}

type Listener = (state: State, prev: State) => void;

/** What a room shares: the table and the settings that decide what's dealt and set up. */
export interface SharedState { settings: Partial<Settings>; game: Game }
const SHARED_SETTINGS = ["options", "players", "platinumColony", "shelters", "blackMarketSize"] as const;
/** Actions every client works out for itself, so they aren't sent to the room. */
const LOCAL_ACTIONS = new Set<Action["type"]>(["choices", "played", "accountBoxes"]);
function pick<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}
const shared = (s: State): SharedState => ({ settings: pick(s.settings, SHARED_SETTINGS), game: s.game });
const sharedKey = (s: State) => JSON.stringify(pick(s.settings, SHARED_SETTINGS));

export class Store {
  state: State = load();
  /** Cards played in earlier games; the app wires this to the history. */
  played: () => Set<string> = () => new Set();
  private listeners: Listener[] = [];
  private setupKey = "";
  private setupCache: SetupResult | null = null;

  /**
   * In a room the table and the shared settings come from the room: local changes are sent to it
   * (onShared) and never saved over the player's own saved state, which comes back on leaving.
   */
  roomMode = false;
  onShared: ((shared: SharedState) => void) | null = null;

  /** Cards just added, filled or swapped in, so the table can briefly highlight them. */
  fresh = new Set<string>();
  private freshTimer: ReturnType<typeof setTimeout> | undefined;

  dispatch = (action: Action) => {
    const prev = this.state;
    this.state = reduce(prev, action, { played: this.played() });
    if (this.state === prev) return;
    if (action.type === "add" || action.type === "fill" || action.type === "replace") {
      const had = new Set([...prev.game.kingdom, ...prev.game.landscapes]);
      this.fresh = new Set([...this.state.game.kingdom, ...this.state.game.landscapes].filter((id) => !had.has(id)));
      clearTimeout(this.freshTimer);
      this.freshTimer = setTimeout(() => { this.fresh = new Set(); }, 1500);
    } else if (action.type !== "choices" && action.type !== "played") this.fresh = new Set();
    if (!this.roomMode) {
      try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* storage unavailable */ }
    } else if (!LOCAL_ACTIONS.has(action.type) && (this.state.game !== prev.game || sharedKey(this.state) !== sharedKey(prev))) {
      this.onShared?.(shared(this.state));
    }
    for (const l of this.listeners) l(this.state, prev);
  };

  /** Adopts the room's table and settings (from another player). */
  adopt(remote: SharedState) {
    const prev = this.state;
    const known = (ids: unknown) => (Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && db.byId.has(id)) : []);
    const g = (remote.game ?? {}) as Partial<Game>;
    const st = (remote.settings ?? {}) as Partial<Settings>;
    this.state = {
      settings: { ...prev.settings, ...pick(st, SHARED_SETTINGS), options: { ...prev.settings.options, ...(st.options ?? {}) } },
      game: { ...prev.game, ...g, kingdom: known(g.kingdom), landscapes: known(g.landscapes), locked: known(g.locked) },
    };
    for (const l of this.listeners) l(this.state, prev);
  }

  /** Back to the player's own saved table and settings. */
  leaveRoom() {
    const prev = this.state;
    this.roomMode = false;
    this.onShared = null;
    this.state = load();
    for (const l of this.listeners) l(this.state, prev);
  }

  /** The shared part of the current state (sent to a room). */
  shared(): SharedState { return shared(this.state); }

  subscribe(listener: Listener) {
    this.listeners.push(listener);
  }

  pool() {
    return buildPool(db, this.state.settings.options.enabledBoxes);
  }

  /** The resolved setup for the current game (memoized), or null for an empty table. */
  setup(): SetupResult | null {
    const { game, settings } = this.state;
    if (!game.kingdom.length && !game.landscapes.length) return null;
    const input = {
      kingdom: game.kingdom, landscapes: game.landscapes, players: settings.players,
      platinumColony: game.platinumColony ?? settings.platinumColony, shelters: game.shelters ?? settings.shelters,
      choices: game.choices, acceptChoices: game.official, blackMarketSize: settings.blackMarketSize,
    };
    const key = JSON.stringify([input, game.seed, settings.options.enabledBoxes]);
    if (key !== this.setupKey) {
      // Setup choices (Bane, Ally ...) may use cards the user added from outside their enabled boxes.
      const pool = new Set([...this.pool(), ...game.kingdom, ...game.landscapes]);
      this.setupCache = resolveSetup(input, db, pool, createRng(game.seed));
      this.setupKey = key;
      // Keep the resolved choices so later edits don't reshuffle unrelated picks (Druid's Boons etc.).
      if (JSON.stringify(this.setupCache.choices) !== JSON.stringify(game.choices)) {
        const choices = this.setupCache.choices;
        queueMicrotask(() => this.dispatch({ type: "choices", choices }));
      }
    }
    return this.setupCache;
  }
}
