// Complex Fourier coefficients of a sampled closed curve.
//
//   c_k = (1/N) Σ_{n=0}^{N-1} z_n · e^{-i2πkn/N},   z_n = x_n + i·y_n  (math frame, y up)
//
// and the curve is rebuilt as ẑ(t) = Σ_k c_k · e^{i2πkt}, t ∈ [0, 1).
//
// A drawn curve is a complex-valued signal, so c_{-k} is in general unrelated to c_k:
// no conjugate symmetry is assumed anywhere.

import { transform } from './fft';
import type { Vec2 } from './path';

/**
 * Signed frequency of DFT bin `index` for length `n` (numpy `fftfreq` convention):
 * bins 0..⌈n/2⌉-1 are 0, +1, +2, …; the rest are negative. For even n the Nyquist bin n/2
 * maps to -n/2. At the sample instants t = j/n the choice ±n/2 is indistinguishable; between
 * samples it decides the direction of that one circle.
 */
export function signedFrequency(index: number, n: number): number {
  return index < Math.ceil(n / 2) ? index : index - n;
}

/** Bin index (0..n-1) holding signed frequency k. */
export const binIndex = (k: number, n: number): number => ((k % n) + n) % n;

export interface Coefficient {
  /** Signed frequency k: revolutions per period; k > 0 counter-clockwise, k < 0 clockwise. */
  k: number;
  re: number;
  im: number;
  /** |c_k| — the circle's radius. */
  amplitude: number;
  /** arg(c_k) in (-π, π] — the arm's angle at t = 0. */
  phase: number;
}

export interface Spectrum {
  n: number;
  /** One entry per bin, ordered by signed frequency from -⌊n/2⌋ to ⌈n/2⌉-1. */
  coefficients: Coefficient[];
  /** Index into `coefficients` for each signed frequency, via `indexOf(k)`. */
  indexOf: (k: number) => number;
  /** Σ|c_k|² = mean |z_n|² (Parseval). */
  totalEnergy: number;
}

/** Normalised DFT of the samples, returned as signed-frequency coefficients. */
export function computeSpectrum(samples: readonly Vec2[]): Spectrum {
  const n = samples.length;
  if (n === 0) throw new Error('computeSpectrum needs at least one sample');
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = samples[i][0];
    im[i] = samples[i][1];
  }
  const X = transform(re, im);
  const minK = -Math.floor(n / 2);
  const coefficients: Coefficient[] = new Array(n);
  let totalEnergy = 0;
  for (let bin = 0; bin < n; bin++) {
    const k = signedFrequency(bin, n);
    const cr = X.re[bin] / n;
    const ci = X.im[bin] / n;
    const amplitude = Math.hypot(cr, ci);
    totalEnergy += amplitude * amplitude;
    coefficients[k - minK] = { k, re: cr, im: ci, amplitude, phase: Math.atan2(ci, cr) };
  }
  return { n, coefficients, indexOf: (k) => k - minK, totalEnergy };
}
