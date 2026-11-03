// Picks Kingdom piles and landscapes. All randomness goes through the seeded Rng.

import type { Card } from "./types";
import type { CardDb } from "./setup";
import { shuffle, weightedSample, type Rng } from "./random";
import { TRAITS } from "./traits";

export const STANDARD_LANDSCAPE_TYPES = ["Event", "Landmark", "Project", "Way", "Trait"];

export interface TraitRule {
  /** Multiplies the weight of matching cards; 0 excludes them. Default 1. */
  weight?: number;
  min?: number;
  max?: number;
}

export interface RandomizerOptions {
  enabledBoxes: string[];
  /** Per-set weight (default 1), used both for rolling expansions and for picking cards. */
  setWeights: Record<string, number>;
  /** Expansions cards are drawn from. Empty means none chosen: the implicit set (see `implicitSet`) is used. */
  drawSets: string[];
  /** How many expansions "Roll" selects. Follows the selection's size, but changing it doesn't change the selection. */
  rollCount: number;
  kingdomSize: number;
  landscapeCount: number;
  maxWays: number;
  traitRules: Record<string, TraitRule>;
  /** Cards never to pick. */
  banned?: string[];
}

export const DEFAULT_OPTIONS: RandomizerOptions = {
  enabledBoxes: [],
  setWeights: {},
  drawSets: [],
  rollCount: 1,
  kingdomSize: 10,
  landscapeCount: 2,
  maxWays: 1,
  traitRules: {},
};

export interface RollContext {
  /** Expansions to draw from (see `drawnSets`). Cards outside them are not picked. */
  sets?: string[];
  /** Kingdom piles kept as they are. */
  locked?: string[];
  lockedLandscapes?: string[];
  /** Cards not to pick this time (e.g. the card being replaced). */
  avoid?: string[];
  /** Extra per-card weight, e.g. from play history. 0 excludes. */
  cardWeight?: (id: string) => number;
}

export interface Draft {
  kingdom: string[];
  landscapes: string[];
  warnings: string[];
}

export const isStandardLandscape = (c: Card) =>
  c.kind === "landscape" && c.types.some((t) => STANDARD_LANDSCAPE_TYPES.includes(t));

/** Every Kingdom pile and landscape printed in at least one enabled box. */
export function buildPool(db: CardDb, enabledBoxes: readonly string[]): Set<string> {
  const enabled = new Set(enabledBoxes);
  return new Set(db.data.cards
    .filter((c) => (c.kind === "kingdom" || c.kind === "landscape") && c.boxes.some((b) => enabled.has(b)))
    .map((c) => c.id));
}

/** Sets that have at least one Kingdom pile in the pool. */
export function poolSets(db: CardDb, pool: ReadonlySet<string>): string[] {
  return [...new Set([...pool].map((id) => db.get(id)).filter((c) => c.kind === "kingdom").map((c) => c.set))];
}

/** The expansion used while none is selected: Dominion (2nd edition) if owned, otherwise the first owned one. */
export function implicitSet(db: CardDb, enabledBoxes: readonly string[]): string | undefined {
  const available = poolSets(db, buildPool(db, enabledBoxes));
  return available.includes("dominion") ? "dominion" : db.data.sets.find((s) => available.includes(s.id))?.id;
}

/** The selected expansions that are owned, in the order of the set list. */
export function selectedSets(db: CardDb, opts: RandomizerOptions): string[] {
  const available = poolSets(db, buildPool(db, opts.enabledBoxes));
  return db.data.sets.map((s) => s.id).filter((id) => available.includes(id) && opts.drawSets.includes(id));
}

/** The expansions a deal draws from: the selection, or the implicit set when nothing is selected. */
export function drawnSets(db: CardDb, opts: RandomizerOptions): string[] {
  const chosen = selectedSets(db, opts);
  if (chosen.length) return chosen;
  const implicit = implicitSet(db, opts.enabledBoxes);
  return implicit ? [implicit] : [];
}

/** Picks `count` owned expansions, weighted by the set weights. */
export function rollSets(db: CardDb, opts: RandomizerOptions, rng: Rng, count = opts.rollCount): string[] {
  const available = poolSets(db, buildPool(db, opts.enabledBoxes));
  return weightedSample(rng, available, (s) => opts.setWeights[s] ?? 1, Math.max(1, count));
}

/** Weights cards by their expansion and the card preferences (Tune) times an optional extra factor. */
export function cardWeighter(db: CardDb, opts: RandomizerOptions, extra?: (id: string) => number): (c: Card) => number {
  const cache = new Map<string, number>();
  return (c) => {
    let w = cache.get(c.id);
    if (w === undefined) {
      w = (opts.setWeights[c.set] ?? 1) * (extra?.(c.id) ?? 1);
      for (const t of cardTraits(db, c)) w *= opts.traitRules[t]?.weight ?? 1;
      cache.set(c.id, w);
    }
    return w;
  };
}

export function cardTraits(db: CardDb, card: Card): Set<string> {
  return new Set(TRAITS.filter((t) => t.test(card, db)).map((t) => t.id));
}

export function randomize(db: CardDb, opts: RandomizerOptions, ctx: RollContext, rng: Rng): Draft {
  const warnings: string[] = [];
  const pool = buildPool(db, opts.enabledBoxes);
  const inSets = (c: Card) => !ctx.sets?.length || ctx.sets.includes(c.set);
  const banned = new Set([...(opts.banned ?? []), ...(ctx.avoid ?? [])]);
  const traitCache = new Map<string, Set<string>>();
  const traitsOf = (id: string) => {
    let t = traitCache.get(id);
    if (!t) traitCache.set(id, (t = cardTraits(db, db.get(id))));
    return t;
  };

  const weightOf = cardWeighter(db, opts, ctx.cardWeight);

  // --- Kingdom piles
  const kingdom = [...(ctx.locked ?? [])];
  let candidates = [...pool].map((id) => db.get(id))
    .filter((c) => c.kind === "kingdom" && inSets(c) && !banned.has(c.id) && !kingdom.includes(c.id));
  const count = (trait: string) => kingdom.filter((id) => traitsOf(id).has(trait)).length;
  const fitsMax = (c: Card) => [...traitsOf(c.id)].every((t) => {
    const max = opts.traitRules[t]?.max;
    return max === undefined || count(t) < max;
  });
  const take = (c: Card) => {
    kingdom.push(c.id);
    candidates = candidates.filter((x) => x.id !== c.id);
  };

  // Minimums first, rarest requirement first so broad ones don't crowd them out.
  const mins = Object.entries(opts.traitRules).filter(([, r]) => (r.min ?? 0) > 0)
    .sort(([a], [b]) => candidates.filter((c) => traitsOf(c.id).has(a)).length - candidates.filter((c) => traitsOf(c.id).has(b)).length);
  for (const [trait, rule] of mins) {
    while (count(trait) < rule.min! && kingdom.length < opts.kingdomSize) {
      const [pick] = weightedSample(rng, candidates.filter((c) => traitsOf(c.id).has(trait) && fitsMax(c)),
        (c) => Math.max(weightOf(c), 0.0001), 1); // a required trait overrides a 0 weight
      if (!pick) { warnings.push(`Couldn't find enough cards for "${TRAITS.find((t) => t.id === trait)?.label ?? trait}".`); break; }
      take(pick);
    }
  }
  while (kingdom.length < opts.kingdomSize) {
    const [pick] = weightedSample(rng, candidates.filter(fitsMax), weightOf, 1);
    if (!pick) { warnings.push(`Only ${kingdom.length} Kingdom piles match the current options.`); break; }
    take(pick);
  }
  // Shuffle so the "first/last card" Colony and Shelters rules see a random order.
  const locked = new Set(ctx.locked ?? []);
  const rolled = shuffle(rng, kingdom.filter((id) => !locked.has(id)));
  const finalKingdom = (ctx.locked?.length ? [...ctx.locked, ...rolled] : rolled);

  // --- Landscapes
  const landscapes = [...(ctx.lockedLandscapes ?? [])];
  const isWay = (id: string) => db.get(id).types.includes("Way");
  const landscapeCandidates = [...pool].map((id) => db.get(id))
    .filter((c) => isStandardLandscape(c) && inSets(c) && !banned.has(c.id) && !landscapes.includes(c.id));
  while (landscapes.length < opts.landscapeCount) {
    const ways = landscapes.filter(isWay).length;
    const [pick] = weightedSample(rng,
      landscapeCandidates.filter((c) => !landscapes.includes(c.id) && (ways < opts.maxWays || !isWay(c.id))),
      (c) => (opts.setWeights[c.set] ?? 1) * (ctx.cardWeight?.(c.id) ?? 1), 1);
    if (!pick) {
      if (landscapeCandidates.length) warnings.push(`Only ${landscapes.length} landscapes match the current options.`);
      break;
    }
    landscapes.push(pick.id);
  }

  return { kingdom: finalKingdom, landscapes, warnings };
}

/** Replaces one Kingdom pile or landscape, keeping everything else (and its position) as is. */
export function replaceOne(db: CardDb, opts: RandomizerOptions, draft: Draft, id: string, ctx: RollContext, rng: Rng): Draft {
  const landscape = draft.landscapes.includes(id);
  const others = (landscape ? draft.landscapes : draft.kingdom).filter((x) => x !== id);
  const avoid = [...(ctx.avoid ?? []), id];
  const rolled = randomize(db, {
    ...opts,
    kingdomSize: draft.kingdom.length,
    landscapeCount: draft.landscapes.length,
  }, {
    ...ctx,
    avoid,
    locked: landscape ? draft.kingdom : others,
    lockedLandscapes: landscape ? others : draft.landscapes,
  }, rng);
  const added = (landscape ? rolled.landscapes : rolled.kingdom).find((x) => !(landscape ? draft.landscapes : draft.kingdom).includes(x));
  if (!added) return { ...draft, warnings: [...rolled.warnings, "Nothing else to swap in with the current options."] };
  const swap = (old: string[]) => old.map((x) => (x === id ? added : x));
  return landscape
    ? { kingdom: draft.kingdom, landscapes: swap(draft.landscapes), warnings: rolled.warnings }
    : { kingdom: swap(draft.kingdom), landscapes: draft.landscapes, warnings: rolled.warnings };
}
