/**
 * Deterministic seeded PRNG (mulberry32). State is a plain number so it lives
 * safely inside the serializable GameState and games are replayable from a seed.
 */
export interface RngState {
  seed: number;
}

export function createRng(seed: number): RngState {
  return { seed: seed >>> 0 };
}

function nextUint32(state: RngState): number {
  state.seed = (state.seed + 0x6d2b79f5) | 0;
  let t = state.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

export type CoinResult = 'heads' | 'tails';

export function flipCoin(state: RngState): CoinResult {
  return nextUint32(state) % 2 === 0 ? 'heads' : 'tails';
}

/** Random integer in [0, maxExclusive). */
export function randomInt(state: RngState, maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error('maxExclusive must be > 0');
  return nextUint32(state) % maxExclusive;
}

export function pickRandom<T>(state: RngState, items: readonly T[]): T {
  if (items.length === 0) throw new Error('cannot pick from empty array');
  const item = items[randomInt(state, items.length)];
  if (item === undefined) throw new Error('unreachable: index in range');
  return item;
}
