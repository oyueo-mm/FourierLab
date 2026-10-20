// Minimal complex arithmetic. Hot loops (FFT, epicycle evaluation) work on parallel
// Float64Arrays instead of these objects; this module is the readable reference.

export interface Complex {
  re: number;
  im: number;
}

export const complex = (re: number, im = 0): Complex => ({ re, im });

export const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });

export const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });

export const mul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

export const scale = (a: Complex, s: number): Complex => ({ re: a.re * s, im: a.im * s });

export const conj = (a: Complex): Complex => ({ re: a.re, im: -a.im });

/** |a| without intermediate overflow/underflow. */
export const abs = (a: Complex): number => Math.hypot(a.re, a.im);

/** arg(a) in (-π, π]. arg(0) is defined as 0. */
export const arg = (a: Complex): number => Math.atan2(a.im, a.re);

/** r·e^{iθ} */
export const fromPolar = (r: number, theta: number): Complex => ({ re: r * Math.cos(theta), im: r * Math.sin(theta) });

/** e^{iθ}: the unit vector at angle θ (counter-clockwise from +x in a y-up frame). */
export const expi = (theta: number): Complex => ({ re: Math.cos(theta), im: Math.sin(theta) });

/**
 * One epicycle arm at time t: c·e^{i2πkt}. Its length is |c| and its angle is 2πkt + arg(c),
 * so k > 0 turns counter-clockwise and k < 0 turns clockwise as t increases.
 */
export const rotatingVector = (c: Complex, k: number, t: number): Complex => mul(c, expi(2 * Math.PI * k * t));
