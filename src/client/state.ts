// Persisted app state (settings + current game) and the actions that change it.

import type { RecommendedKingdom } from "../shared/types";
import type { HistoryGame } from "../shared/history";
import { resolveSetup, withoutChoice, type AutoBool, type Choices, type RerollKey, type SetupInput, type SetupResult } from "../shared/setup";
import { buildPool, cardWeighter, DEFAULT_OPTIONS, drawnSets, poolSets, randomize, replaceOne, rollSets, type RandomizerOptions } from "../shared/randomizer";
import { createRng } from "../shared/random";
import { data, db } from "./data";

export interface Game {
  kingdom: string[];
  landscapes: string[];
  /** Cards the user locked or added; deals keep them. */
  locked: string[];
  /** Expansions the table was dealt from (its icons); null when it wasn't dealt (recommended or built by hand). */
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
  /** A locked table can't be changed (no dealing, swapping, adding or removing); tapping a card goes straight to its rules. */
  setupLocked: boolean;
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

/** The expansion icons of a table: where it was dealt from plus any expansion added since, or else its cards' own. */
export function tableSets(game: Pick<Game, "sets" | "kingdom" | "landscapes">): string[] {
  const ids = game.sets ?? [...new Set([...game.kingdom, ...game.landscapes].map((id) => db.get(id).set))];
  return data.sets.map((s) => s.id).filter((id) => ids.includes(id));
}

/** A selection of expansions as options: only owned ones, and the roll count follows its size. */
function withSelection(options: RandomizerOptions, sets: readonly string[]): RandomizerOptions {
  const available = poolSets(db, buildPool(db, options.enabledBoxes));
  const drawSets = data.sets.map((s) => s.id).filter((id) => available.includes(id) && sets.includes(id));
  return { ...options, drawSets, rollCount: Math.max(1, drawSets.length) };
}

/** Setup picks made by a single card of the table (it can be locked to keep them). */
const PICK_SOURCES = { bane: "young-witch", ferryman: "ferryman", riverboat: "riverboat", wayOfTheMouse: "way-of-the-mouse", approachingArmy: "approaching-army" } as const;

/** Cards currently serving as a pick (a Bane, Ferryman's pile ...): swapping or filling shouldn't take them for the Kingdom. */
function reservedPicks(choices: Choices): string[] {
  return Object.keys(PICK_SOURCES).map((k) => choices[k as keyof typeof PICK_SOURCES]).filter((x): x is string => !!x);
}

/** The picks that stay when dealing again: those whose card is locked, so a locked Young Witch keeps its Bane. */
function keptPicks(game: Game): Choices {
  const locked = new Set(game.locked);
  const kept: Choices = {};
  for (const [key, source] of Object.entries(PICK_SOURCES)) {
    const k = key as keyof typeof PICK_SOURCES;
    if (locked.has(source) && game.choices[k]) kept[k] = game.choices[k];
  }
  const lockedTypes = new Set(game.kingdom.filter((id) => locked.has(id)).flatMap((id) => db.get(id).types));
  if (lockedTypes.has("Liaison") && game.choices.ally) kept.ally = game.choices.ally;
  if (lockedTypes.has("Omen") && game.choices.prophecy) kept.prophecy = game.choices.prophecy;
  return kept;
}

/** Every card named by a set of choices. */
function pickedCards(choices: Choices): Set<string> {
  return new Set(Object.values(choices).flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v : v ? Object.values(v) : [])));
}

/** Adds the expansion of cards that joined the table to its icons, so they stay true to what's on it. */
function grown(game: Game, kingdom: string[], landscapes: string[]): string[] | null {
  if (!game.sets) return null;
  const had = new Set([...game.kingdom, ...game.landscapes]);
  const added = [...kingdom, ...landscapes].filter((id) => !had.has(id)).map((id) => db.get(id).set);
  return [...new Set([...game.sets, ...added])];
}

const emptyGame = (): Game => ({
  kingdom: [], landscapes: [], locked: [], sets: null, choices: {}, official: false,
  recommendedId: null, platinumColony: null, shelters: null, seed: newSeed(), warnings: [], playedId: null, setupLocked: false,
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
  /** Selects the owned expansions cards are drawn from (never changes the icons of the table already dealt). */
  | { type: "drawSets"; sets: string[] }
  | { type: "toggleSet"; id: string }
  | { type: "rollCount"; count: number }
  /** Selects `rollCount` random owned expansions. */
  | { type: "rollSets" }
  /** Picks a Bane, an Ally ... again. */
  | { type: "reroll"; key: RerollKey }
  | { type: "deal" }
  | { type: "fill" }
  | { type: "replace"; id: string }
  | { type: "toggleLock"; id: string }
  | { type: "add"; id: string }
  /** Adds a random Kingdom card from one expansion (or from the game's expansions when null). */
  | { type: "addRandom"; set: string | null }
  | { type: "lockSetup"; on: boolean }
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

/** What setup needs to know about a game: its cards and the rules around them, plus where fresh picks should lean. */
function setupInput(state: State, env: Env): SetupInput {
  const { game, settings } = state;
  const opts = settings.options;
  const playedWeight = settings.playedCards === "any" ? undefined
    : (id: string) => (env.played.has(id) ? (settings.playedCards === "none" ? 0 : FEWER_WEIGHT) : 1);
  return {
    kingdom: game.kingdom, landscapes: game.landscapes, players: settings.players,
    platinumColony: game.platinumColony ?? settings.platinumColony, shelters: game.shelters ?? settings.shelters,
    choices: game.choices, acceptChoices: game.official, blackMarketSize: settings.blackMarketSize,
    prefer: { sets: drawnSets(db, opts), weight: cardWeighter(db, opts, playedWeight) },
  };
}

/** Setup choices (Bane, Ally ...) may use cards the user added from outside their enabled boxes. */
function setupPool(state: State): Set<string> {
  const { game, settings } = state;
  return new Set([...buildPool(db, settings.options.enabledBoxes), ...game.kingdom, ...game.landscapes]);
}

/** Actions that change the cards on the table; a locked table ignores them. */
const TABLE_EDITS = new Set<Action["type"]>(["deal", "fill", "replace", "toggleLock", "add", "addRandom", "remove", "clear", "reroll"]);

function reduce(state: State, action: Action, env: Env): State {
  const { settings, game } = state;
  const opts = settings.options;
  if (game.setupLocked && TABLE_EDITS.has(action.type)) return state;
  switch (action.type) {
    case "settings":
      return { ...state, settings: { ...settings, ...action.patch } };
    case "options": {
      let options = { ...opts, ...action.patch };
      // Owning fewer expansions can leave the selection holding sets that are gone.
      if (action.patch.enabledBoxes) options = withSelection(options, options.drawSets);
      return { ...state, settings: { ...settings, options,
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
    case "drawSets":
      return { ...state, settings: { ...settings, options: withSelection(opts, action.sets) } };
    case "toggleSet": {
      const next = opts.drawSets.includes(action.id) ? opts.drawSets.filter((x) => x !== action.id) : [...opts.drawSets, action.id];
      return { ...state, settings: { ...settings, options: withSelection(opts, next) } };
    }
    case "rollCount": {
      const most = Math.max(1, poolSets(db, buildPool(db, opts.enabledBoxes)).length);
      return { ...state, settings: { ...settings, options: { ...opts, rollCount: Math.min(most, Math.max(1, action.count)) } } };
    }
    case "rollSets":
      return { ...state, settings: { ...settings, options: withSelection(opts, rollSets(db, opts, createRng(newSeed()))) } };
    case "reroll": {
      const { choices, previous } = withoutChoice(game.choices, action.key);
      // Only a single card is kept out of the new pick; a Black Market deck or Druid's Boons are simply drawn again.
      const input = { ...setupInput(state, env), choices, acceptChoices: false, exclude: previous ? [previous] : [] };
      const resolved = resolveSetup(input, db, setupPool(state), createRng(newSeed()));
      const again = withoutChoice(resolved.choices, action.key).previous;
      return { ...state, game: edited(game, { choices: resolved.choices,
        warnings: previous && again === previous ? ["There's no other card that fits."] : [] }) };
    }
    case "deal": {
      const seed = newSeed();
      const sets = drawnSets(db, opts);
      const kept = keptPicks(game);
      const draft = withPlayed(settings, env, (cardWeight) => randomize(db, opts, {
        sets,
        locked: game.kingdom.filter((id) => game.locked.includes(id)),
        lockedLandscapes: game.landscapes.filter((id) => game.locked.includes(id)),
        avoid: reservedPicks(kept),
        cardWeight,
      }, createRng((seed ^ 0x9e3779b9) >>> 0)));
      return { ...state, game: edited(game, { ...draft, sets, seed, choices: kept, platinumColony: null, shelters: null }) };
    }
    case "fill": {
      // Fill empty slots only: everything already on the table stays (without being locked).
      const seed = newSeed();
      const draft = withPlayed(settings, env, (cardWeight) =>
        randomize(db, opts, { sets: drawnSets(db, opts), locked: game.kingdom, lockedLandscapes: game.landscapes, avoid: reservedPicks(game.choices), cardWeight }, createRng(seed)));
      return { ...state, game: edited(game, { kingdom: draft.kingdom, landscapes: draft.landscapes, sets: grown(game, draft.kingdom, draft.landscapes), warnings: draft.warnings }) };
    }
    case "replace": {
      const seed = newSeed();
      const draft = withPlayed(settings, env, (cardWeight) =>
        replaceOne(db, opts, { ...game, warnings: [] }, action.id, { sets: drawnSets(db, opts), avoid: reservedPicks(game.choices), cardWeight }, createRng(seed)));
      return { ...state, game: edited(game, { kingdom: draft.kingdom, landscapes: draft.landscapes, sets: grown(game, draft.kingdom, draft.landscapes), warnings: draft.warnings }) };
    }
    case "toggleLock": {
      const locked = game.locked.includes(action.id) ? game.locked.filter((x) => x !== action.id) : [...game.locked, action.id];
      return { ...state, game: { ...game, locked } };
    }
    case "add": {
      const card = db.get(action.id);
      if (game.kingdom.includes(card.id) || game.landscapes.includes(card.id)) return state;
      const patch = card.kind === "landscape" ? { landscapes: [...game.landscapes, card.id] } : { kingdom: [...game.kingdom, card.id] };
      return { ...state, game: edited(game, { ...patch, sets: grown(game, patch.kingdom ?? game.kingdom, patch.landscapes ?? game.landscapes),
        locked: [...game.locked, card.id], warnings: [] }) };
    }
    case "addRandom": {
      // Picking an expansion you don't own still works: its current boxes join the pool for this card.
      const enabledBoxes = action.set
        ? [...new Set([...opts.enabledBoxes, ...data.boxes.filter((b) => b.set === action.set && b.edition !== 1).map((b) => b.id)])]
        : opts.enabledBoxes;
      const seed = newSeed();
      const draft = withPlayed(settings, env, (cardWeight) => randomize(db,
        { ...opts, enabledBoxes, kingdomSize: game.kingdom.length + 1, landscapeCount: game.landscapes.length },
        { sets: action.set ? [action.set] : drawnSets(db, opts), locked: game.kingdom, lockedLandscapes: game.landscapes, avoid: reservedPicks(game.choices), cardWeight },
        createRng(seed)));
      const added = draft.kingdom.filter((id) => !game.kingdom.includes(id));
      if (!added.length) return { ...state, game: { ...game, warnings: ["No more cards to add from there."] } };
      return { ...state, game: edited(game, { kingdom: draft.kingdom, sets: grown(game, draft.kingdom, game.landscapes),
        locked: [...game.locked, ...added], warnings: draft.warnings }) };
    }
    case "lockSetup":
      if (action.on && !game.kingdom.length && !game.landscapes.length) return state;
      return { ...state, game: { ...game, setupLocked: action.on } };
    case "remove":
      return { ...state, game: edited(game, {
        kingdom: game.kingdom.filter((x) => x !== action.id),
        landscapes: game.landscapes.filter((x) => x !== action.id),
        locked: game.locked.filter((x) => x !== action.id),
        warnings: [],
      }) };
    case "clear":
      return { ...state, game: emptyGame() };
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

/**
 * Options saved before the expansion selection existed had "expansions per game" (0 meant every owned
 * expansion). Those become a selection: all owned expansions, or the ones the table was dealt from.
 */
function migrateOptions(options: RandomizerOptions & { setsPerGame?: number }, dealt?: string[] | null): RandomizerOptions {
  const { setsPerGame, ...rest } = options;
  if (Array.isArray(rest.drawSets)) return withSelection(rest, rest.drawSets);
  const all = poolSets(db, buildPool(db, rest.enabledBoxes));
  return withSelection(rest, setsPerGame && dealt ? dealt : setsPerGame ? [] : all);
}

function load(): State {
  const fresh: State = { settings: defaultSettings(), game: emptyGame() };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as State | null;
    if (!saved) return fresh;
    // Drop anything that no longer exists after a data refresh.
    const known = (ids: string[]) => ids.filter((id) => db.byId.has(id));
    const boxes = new Set(data.boxes.map((b) => b.id));
    const options = { ...fresh.settings.options, ...saved.settings.options,
      enabledBoxes: saved.settings.options.enabledBoxes.filter((b) => boxes.has(b)) };
    return {
      settings: { ...fresh.settings, ...saved.settings, options: migrateOptions(options, saved.game?.sets) },
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
    if (action.type === "add" || action.type === "addRandom" || action.type === "fill" || action.type === "replace" || action.type === "reroll") {
      // Table cards that arrived, or (re-picked) Banes, Allies ... that now appear off to the side.
      const had = new Set(action.type === "reroll" ? pickedCards(prev.game.choices) : [...prev.game.kingdom, ...prev.game.landscapes]);
      const now = action.type === "reroll" ? pickedCards(this.state.game.choices) : [...this.state.game.kingdom, ...this.state.game.landscapes];
      this.fresh = new Set([...now].filter((id) => !had.has(id)));
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
      // A room saved by an older version has no selection of expansions: keep this player's.
      settings: { ...prev.settings, ...pick(st, SHARED_SETTINGS), options: migrateOptions({ ...prev.settings.options, ...(st.options ?? {}) }, g.sets) },
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
    // The picks' leanings (expansions, weights) only matter when something is picked, so they aren't part of the key.
    const key = JSON.stringify([{ ...setupInput(this.state, { played: new Set() }), prefer: undefined }, game.seed, settings.options.enabledBoxes]);
    if (key !== this.setupKey) {
      // In a room every player works out the same picks from the shared seed, so personal history stays out of them.
      const input = setupInput(this.state, { played: this.roomMode ? new Set() : this.played() });
      this.setupCache = resolveSetup(input, db, setupPool(this.state), createRng(game.seed));
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
