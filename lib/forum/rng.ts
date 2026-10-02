/**
 * Seeded randomness for the forum.
 *
 * Scheduling tie-breaks must be reproducible: replaying turn 40 has to pick the
 * same speaker it picked the first time, or the drift harness (spec §12) and any
 * replay are meaningless. So nothing here uses Math.random().
 */

/** FNV-1a — stable across runs and processes, unlike a Map/Set iteration order. */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, and good enough for tie-breaks. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sort by weight descending, breaking ties with a seeded shuffle.
 *
 * The seed is assigned in a stable order (by id) *before* the weight sort, so the
 * result depends only on `key` and the weights — never on input order.
 */
export function orderByWeightThenSeed<T>(
  items: readonly T[],
  weight: (item: T) => number,
  idOf: (item: T) => string,
  key: string,
): T[] {
  const rng = mulberry32(hashString(key));
  const decorated = [...items]
    .sort((a, b) => (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0))
    .map((item) => ({ item, w: weight(item), r: rng() }));

  decorated.sort((x, y) => y.w - x.w || x.r - y.r);
  return decorated.map((d) => d.item);
}

/** Deterministic single pick — used for template and highlight rotation. */
export function hashPick<T>(items: readonly T[], key: string): T | undefined {
  if (items.length === 0) return undefined;
  return items[hashString(key) % items.length];
}
