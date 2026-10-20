// Reconstructed curves and approximation error.

import { binIndex, type Coefficient, type Spectrum } from './fourier';
import { fft } from './fft';
import type { Vec2 } from './path';

export interface Curve {
  x: Float64Array;
  y: Float64Array;
}

/**
 * ẑ(m/M) for m = 0..M-1 using only `terms` (plus nothing else — pass c_0 explicitly).
 * Implemented as an inverse FFT of the zero-padded coefficient array, so evaluating the
 * series at M points costs O(M log M) instead of O(M·K). M must be a power of two and at
 * least as large as the spectrum length so that every signed k gets its own bin.
 */
export function evaluateSeries(terms: readonly Coefficient[], m: number): Curve {
  const re = new Float64Array(m);
  const im = new Float64Array(m);
  for (const c of terms) {
    const bin = binIndex(c.k, m);
    re[bin] += c.re;
    im[bin] += c.im;
  }
  const z = fft(re, im, true);
  return { x: z.re, y: z.im };
}

/** Direct evaluation Σ c_k e^{i2πkt} — the slow reference for `evaluateSeries`. */
export function evaluateSeriesAt(terms: readonly Coefficient[], t: number): Vec2 {
  let x = 0;
  let y = 0;
  for (const c of terms) {
    const turns = c.k * t;
    const angle = 2 * Math.PI * (turns - Math.floor(turns));
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    x += c.re * cos - c.im * sin;
    y += c.re * sin + c.im * cos;
  }
  return [x, y];
}

/** Resolution for the trail / preview curve: a power of two ≥ max(2N, 2048). */
export function curveResolution(sampleCount: number): number {
  let m = 2048;
  while (m < 2 * sampleCount) m <<= 1;
  return m;
}

/**
 * Root-mean-square distance between original samples z_n and the reconstruction ẑ(n/N),
 * compared at the same parameter values.
 */
export function rmse(samples: readonly Vec2[], reconstruction: readonly Vec2[]): number {
  if (samples.length !== reconstruction.length || samples.length === 0) throw new Error('rmse: length mismatch');
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const dx = samples[i][0] - reconstruction[i][0];
    const dy = samples[i][1] - reconstruction[i][1];
    sum += dx * dx + dy * dy;
  }
  return Math.sqrt(sum / samples.length);
}

/** Reconstruction at the N sample instants t = n/N using the given terms. */
export function reconstructAtSamples(terms: readonly Coefficient[], n: number): Vec2[] {
  const m = curveResolution(n); // a power-of-two multiple of n when n is a power of two
  const curve = evaluateSeries(terms, m);
  const step = m / n;
  if (!Number.isInteger(step)) return Array.from({ length: n }, (_, i) => evaluateSeriesAt(terms, i / n));
  return Array.from({ length: n }, (_, i) => [curve.x[i * step], curve.y[i * step]] as Vec2);
}

/**
 * RMSE after keeping DC plus the first K of `ranked`, for every K = 0..ranked.length.
 *
 * By Parseval's theorem for the normalised DFT, (1/N)Σ|z_n - ẑ_n|² equals the energy of the
 * dropped coefficients, so RMSE(K) = sqrt(Σ_{dropped} |c_k|²). This is exact at the sample
 * instants and costs O(N) for the whole curve. The tests check it against `rmse` directly.
 */
export function errorCurve(ranked: readonly Coefficient[]): Float64Array {
  const out = new Float64Array(ranked.length + 1);
  let remaining = 0;
  for (let i = ranked.length - 1; i >= 0; i--) {
    remaining += ranked[i].amplitude * ranked[i].amplitude;
    out[i] = Math.sqrt(remaining);
  }
  out[ranked.length] = 0;
  return out;
}

/** RMS distance of the samples from their centroid: a size scale for relative error. */
export function rmsRadius(spectrum: Spectrum): number {
  const dc = spectrum.coefficients[spectrum.indexOf(0)];
  return Math.sqrt(Math.max(0, spectrum.totalEnergy - dc.amplitude * dc.amplitude));
}
