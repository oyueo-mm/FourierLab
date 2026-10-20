import { describe, expect, it } from 'vitest';
import { dft, fft, isPowerOfTwo, transform } from './fft';
import { maxAbsDiff, randomSignal } from './testUtils';

describe('dft (reference)', () => {
  it('puts a constant signal entirely in bin 0', () => {
    const n = 16;
    const X = dft(new Float64Array(n).fill(2), new Float64Array(n).fill(-1));
    expect(X.re[0]).toBeCloseTo(2 * n, 12);
    expect(X.im[0]).toBeCloseTo(-n, 12);
    for (let k = 1; k < n; k++) expect(Math.hypot(X.re[k], X.im[k])).toBeLessThan(1e-12);
  });

  it('concentrates a complex sinusoid in its own bin', () => {
    const n = 12; // not a power of two on purpose
    for (const k0 of [1, 5, n - 3]) {
      const re = new Float64Array(n);
      const im = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        re[j] = Math.cos((2 * Math.PI * k0 * j) / n);
        im[j] = Math.sin((2 * Math.PI * k0 * j) / n);
      }
      const X = dft(re, im);
      for (let k = 0; k < n; k++) {
        expect(Math.hypot(X.re[k], X.im[k])).toBeCloseTo(k === k0 ? n : 0, 10);
      }
    }
  });

  it('inverts (up to the factor N)', () => {
    const { re, im } = randomSignal(10, 1);
    const X = dft(re, im);
    const x = dft(X.re, X.im, true);
    expect(maxAbsDiff(x.re.map((v) => v / 10), re)).toBeLessThan(1e-12);
    expect(maxAbsDiff(x.im.map((v) => v / 10), im)).toBeLessThan(1e-12);
  });
});

describe('fft', () => {
  it('matches the reference DFT for every power of two up to 2048', () => {
    for (let n = 1; n <= 2048; n *= 2) {
      const { re, im } = randomSignal(n, n);
      const A = fft(re, im);
      const B = dft(re, im);
      const tol = 1e-10 * Math.max(1, n);
      expect(maxAbsDiff(A.re, B.re)).toBeLessThan(tol);
      expect(maxAbsDiff(A.im, B.im)).toBeLessThan(tol);
      const Ai = fft(re, im, true);
      const Bi = dft(re, im, true);
      expect(maxAbsDiff(Ai.re, Bi.re)).toBeLessThan(tol);
      expect(maxAbsDiff(Ai.im, Bi.im)).toBeLessThan(tol);
    }
  });

  it('round-trips forward → inverse / N', () => {
    const n = 1024;
    const { re, im } = randomSignal(n, 42);
    const X = fft(re, im);
    const x = fft(X.re, X.im, true);
    expect(maxAbsDiff(x.re.map((v) => v / n), re)).toBeLessThan(1e-13);
    expect(maxAbsDiff(x.im.map((v) => v / n), im)).toBeLessThan(1e-13);
  });

  it('satisfies Parseval: Σ|x|² = Σ|X|²/N', () => {
    const n = 512;
    const { re, im } = randomSignal(n, 7);
    const X = fft(re, im);
    let ex = 0;
    let eX = 0;
    for (let i = 0; i < n; i++) {
      ex += re[i] ** 2 + im[i] ** 2;
      eX += X.re[i] ** 2 + X.im[i] ** 2;
    }
    expect(eX / n).toBeCloseTo(ex, 9);
  });

  it('does not modify its inputs', () => {
    const { re, im } = randomSignal(8, 3);
    const copyRe = Float64Array.from(re);
    fft(re, im);
    expect(Array.from(re)).toEqual(Array.from(copyRe));
  });

  it('rejects non-power-of-two lengths and mismatched arrays', () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow();
    expect(() => fft(new Float64Array(8), new Float64Array(4))).toThrow();
  });

  it('transform() falls back to the DFT for other lengths', () => {
    expect(isPowerOfTwo(1024)).toBe(true);
    expect(isPowerOfTwo(1000)).toBe(false);
    const { re, im } = randomSignal(30, 9);
    const A = transform(re, im);
    const B = dft(re, im);
    expect(maxAbsDiff(A.re, B.re)).toBe(0);
  });
});
