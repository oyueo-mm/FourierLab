// Which coefficients are used, and in which order the arms are chained on screen.
//
// The DC term c_0 does not rotate: it is the fixed offset from the origin to the curve's
// centroid. It is always included and is *not* counted as a circle, so "K circles" means
// K rotating terms with k ≠ 0.
//
// Selection (which K terms) and chain order (how the chosen arms are stacked) are separate:
// the sum — and therefore the traced curve — does not depend on the chain order, only the
// look of the epicycles does.

import type { Coefficient, Spectrum } from './fourier';

export type SelectionMode = 'frequency' | 'amplitude';
export type ChainOrder = 'amplitude' | 'frequency';

export const SELECTION_MODES: readonly SelectionMode[] = ['frequency', 'amplitude'];
export const CHAIN_ORDERS: readonly ChainOrder[] = ['amplitude', 'frequency'];

/** Low-to-high frequency order: +1, -1, +2, -2, … (ties broken positive first). */
export const compareByFrequency = (a: Coefficient, b: Coefficient): number =>
  Math.abs(a.k) - Math.abs(b.k) || b.k - a.k;

/** Largest amplitude first; equal amplitudes fall back to frequency order for determinism. */
export const compareByAmplitude = (a: Coefficient, b: Coefficient): number =>
  b.amplitude - a.amplitude || compareByFrequency(a, b);

/** All rotating (k ≠ 0) coefficients in the order they are added for a given mode. */
export function rankComponents(spectrum: Spectrum, mode: SelectionMode): Coefficient[] {
  const rotating = spectrum.coefficients.filter((c) => c.k !== 0);
  return rotating.sort(mode === 'amplitude' ? compareByAmplitude : compareByFrequency);
}

export interface Selection {
  /** c_0, the fixed offset at the start of the chain. */
  dc: Coefficient;
  /** The K selected rotating terms, in chain (drawing) order. */
  chain: Coefficient[];
  /** Selected frequencies, for quick membership tests. */
  frequencies: Set<number>;
}

/** Picks the first `count` terms of `ranked` and orders them for drawing. */
export function selectComponents(
  spectrum: Spectrum,
  ranked: readonly Coefficient[],
  count: number,
  chainOrder: ChainOrder,
): Selection {
  const k = Math.max(0, Math.min(ranked.length, Math.floor(count)));
  const chosen = ranked.slice(0, k);
  chosen.sort(chainOrder === 'amplitude' ? compareByAmplitude : compareByFrequency);
  return {
    dc: spectrum.coefficients[spectrum.indexOf(0)],
    chain: chosen,
    frequencies: new Set(chosen.map((c) => c.k)),
  };
}
