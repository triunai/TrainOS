import { createHash } from "node:crypto";

/**
 * Deterministic, hash-seeded randomness for quiz arrangement.
 *
 * The same (bank, participant, sitting) must always produce the same question
 * and option order: the page can be reloaded, and the server re-derives the
 * order at submission time to map a displayed option back to the canonical
 * answer key. Nothing about the arrangement is stored, so nothing about it can
 * drift. A SHA-256 counter stream is slower than a PRNG and irrelevant at
 * quiz sizes; it is obviously deterministic and has no seeding pitfalls.
 */
export class SeededStream {
  private counter = 0;

  constructor(private readonly seed: string) {}

  /** Uniform float in [0, 1). */
  next(): number {
    const digest = createHash("sha256").update(`${this.seed}#${this.counter}`).digest();
    this.counter += 1;
    return digest.readUInt32BE(0) / 0x1_0000_0000;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}

/** Fisher–Yates over indices: returns `perm` where `perm[position] = originalIndex`. */
export function permutation(length: number, seed: string): number[] {
  const stream = new SeededStream(seed);
  const perm = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i -= 1) {
    const j = stream.int(i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}

export function shuffled<T>(items: readonly T[], seed: string): T[] {
  return permutation(items.length, seed).map((i) => items[i]);
}

/** Pick `count` distinct items (deterministic), preserving nothing about input order. */
export function sample<T>(items: readonly T[], count: number, seed: string): T[] {
  return shuffled(items, seed).slice(0, Math.max(0, count));
}
