// Seeded randomness so a setup can be reproduced exactly (history, rooms, shared links).

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  seed: number;
}

/** mulberry32: small, fast, good enough for shuffling cards. */
export function createRng(seed: number = (Math.random() * 2 ** 32) >>> 0): Rng {
  let a = seed >>> 0;
  return {
    seed,
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function pick<T>(rng: Rng, items: readonly T[]): T | undefined {
  return items.length ? items[Math.floor(rng.next() * items.length)] : undefined;
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Weighted sample without replacement. Items with weight <= 0 are never picked. */
export function weightedSample<T>(rng: Rng, items: readonly T[], weight: (t: T) => number, count: number): T[] {
  // Efraimidis–Spirakis: key = u^(1/w), take the largest keys.
  return items
    .map((item) => ({ item, w: weight(item) }))
    .filter((x) => x.w > 0)
    .map((x) => ({ item: x.item, key: Math.pow(rng.next(), 1 / x.w) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map((x) => x.item);
}
