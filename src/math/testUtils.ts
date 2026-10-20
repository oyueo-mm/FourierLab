// Helpers shared by the math tests.
import type { Vec2 } from './path';

/** Deterministic PRNG (mulberry32) so random-signal tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSignal(n: number, seed: number): { re: Float64Array; im: Float64Array } {
  const r = rng(seed);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = r() * 2 - 1;
    im[i] = r() * 2 - 1;
  }
  return { re, im };
}

export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

export function maxPointDistance(a: readonly Vec2[], b: readonly Vec2[]): number {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]));
  return m;
}

export const allFinite = (pts: readonly Vec2[]): boolean => pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));

/** Samples of r·e^{i(2πk n/N + φ)} + offset. */
export function rotatingSamples(n: number, k: number, r = 1, phase = 0, offset: Vec2 = [0, 0]): Vec2[] {
  return Array.from({ length: n }, (_, i): Vec2 => {
    const a = (2 * Math.PI * k * i) / n + phase;
    return [offset[0] + r * Math.cos(a), offset[1] + r * Math.sin(a)];
  });
}
