// Epicycle chain: arms placed head to tail.
//
//   joint_0 = 0 (origin)
//   joint_1 = c_0                                       (fixed DC offset)
//   joint_j = joint_{j-1} + |c_k|·e^{i(2πkt + arg c_k)}  for each chained term
//
// The last joint is ẑ(t) = Σ c_k e^{i2πkt} over the selected terms. The renderer draws
// exactly these joints, so the pen tip on screen is this function's output.

import type { Selection } from './selection';
import type { Vec2 } from './path';

export interface CompiledChain {
  /** Number of rotating arms. */
  count: number;
  dcRe: number;
  dcIm: number;
  k: Float64Array;
  amplitude: Float64Array;
  phase: Float64Array;
}

export function compileChain(selection: Selection): CompiledChain {
  const count = selection.chain.length;
  const k = new Float64Array(count);
  const amplitude = new Float64Array(count);
  const phase = new Float64Array(count);
  selection.chain.forEach((c, i) => {
    k[i] = c.k;
    amplitude[i] = c.amplitude;
    phase[i] = c.phase;
  });
  return { count, dcRe: selection.dc.re, dcIm: selection.dc.im, k, amplitude, phase };
}

/** Number of floats `evaluateChain` writes: (count + 2) joints × (x, y). */
export const jointBufferLength = (chain: CompiledChain): number => 2 * (chain.count + 2);

/**
 * Writes the chain's joints at time t into `out` as [x0, y0, x1, y1, …] and returns it.
 * Index 0 is the origin, 1 is the DC offset, the last is the pen tip.
 */
export function evaluateChain(chain: CompiledChain, t: number, out?: Float64Array): Float64Array {
  const buf = out && out.length >= jointBufferLength(chain) ? out : new Float64Array(jointBufferLength(chain));
  let x = chain.dcRe;
  let y = chain.dcIm;
  buf[0] = 0;
  buf[1] = 0;
  buf[2] = x;
  buf[3] = y;
  for (let i = 0; i < chain.count; i++) {
    // Reduce k·t to [0, 1) first so t = 0 and t = 1 give bit-for-bit the same angle.
    const turns = chain.k[i] * t;
    const angle = 2 * Math.PI * (turns - Math.floor(turns)) + chain.phase[i];
    x += chain.amplitude[i] * Math.cos(angle);
    y += chain.amplitude[i] * Math.sin(angle);
    buf[4 + 2 * i] = x;
    buf[5 + 2 * i] = y;
  }
  return buf;
}

/** Pen tip ẑ(t). */
export function chainTip(chain: CompiledChain, t: number): Vec2 {
  const joints = evaluateChain(chain, t);
  const last = 2 * (chain.count + 1);
  return [joints[last], joints[last + 1]];
}

/** Current angle of arm i at time t, in (-π, π]. */
export function armAngle(k: number, phase: number, t: number): number {
  const turns = k * t;
  const a = 2 * Math.PI * (turns - Math.floor(turns)) + phase;
  return Math.atan2(Math.sin(a), Math.cos(a));
}
