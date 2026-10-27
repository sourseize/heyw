/**
 * Seeded pseudo-random number generator (mulberry32) and deterministic IDs.
 * No Math.random, no Date.now, no crypto.randomUUID anywhere in the generator:
 * the same seed always yields the same dataset, byte for byte.
 */
import crypto from 'node:crypto';

export class Prng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Picks `n` distinct items (order of the draw). */
  sample<T>(items: readonly T[], n: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (pool.length && out.length < n) {
      out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]);
    }
    return out;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Rounds a float to a weighted choice: `weights` are relative, not normalised. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [value, w] of entries) {
      if ((r -= w) < 0) return value;
    }
    return entries[entries.length - 1][0];
  }
}

/**
 * The first UUID block is fixed: every generated record carries it, so cleanup
 * can recognise test data without any manifest. It reads as "testdata".
 */
export const TESTDATA_NAMESPACE = '7e57da7a';

export function isTestDataId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(`${TESTDATA_NAMESPACE}-`);
}

/** 32-bit seed derived from the master seed and a key such as a date — per-day RNG streams. */
export function seedFor(seed: number, key: string): number {
  return crypto.createHash('sha256').update(`${seed}:${key}`).digest().readUInt32BE(0);
}

/** Stable, UUID-shaped id derived from (seed, kind, index). */
export function testDataId(seed: number, kind: string, index: number | string): string {
  const h = crypto.createHash('sha256').update(`${seed}:${kind}:${index}`).digest('hex');
  return `${TESTDATA_NAMESPACE}-${h.slice(0, 4)}-4${h.slice(4, 7)}-8${h.slice(7, 10)}-${h.slice(10, 22)}`;
}
