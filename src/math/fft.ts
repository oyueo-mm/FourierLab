// Discrete Fourier transforms on split complex arrays (re[], im[]).
//
// Convention (unnormalised, numpy-style):
//   forward  X[k] = Σ_{n=0}^{N-1} x[n] · e^{-i2πkn/N}
//   inverse  x[n] = Σ_{k=0}^{N-1} X[k] · e^{+i2πkn/N}      (no 1/N; callers scale)
//
// `dft` is the O(N²) reference used by the tests and for lengths that are not a power of two.
// `fft` is an iterative radix-2 Cooley–Tukey transform for power-of-two lengths.

export interface SplitComplex {
  re: Float64Array;
  im: Float64Array;
}

export const isPowerOfTwo = (n: number): boolean => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

function checkInput(re: ArrayLike<number>, im: ArrayLike<number>): number {
  if (re.length !== im.length) throw new Error(`re/im length mismatch: ${re.length} vs ${im.length}`);
  return re.length;
}

/** Reference DFT, O(N²). Works for any N ≥ 1. */
export function dft(re: ArrayLike<number>, im: ArrayLike<number>, inverse = false): SplitComplex {
  const n = checkInput(re, im);
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  const sign = inverse ? 1 : -1;
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let j = 0; j < n; j++) {
      // Reduce k·j mod N before forming the angle so large products keep full precision.
      const angle = (sign * 2 * Math.PI * ((k * j) % n)) / n;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      sr += re[j] * c - im[j] * s;
      si += re[j] * s + im[j] * c;
    }
    outRe[k] = sr;
    outIm[k] = si;
  }
  return { re: outRe, im: outIm };
}

// Twiddle tables are cached per size: e^{-i2πj/N} for j < N/2.
const twiddleCache = new Map<number, SplitComplex>();

function twiddles(n: number): SplitComplex {
  let t = twiddleCache.get(n);
  if (!t) {
    const half = n >> 1;
    const re = new Float64Array(half);
    const im = new Float64Array(half);
    for (let j = 0; j < half; j++) {
      // Each angle is computed directly (no recurrence) so the error does not accumulate.
      const angle = (-2 * Math.PI * j) / n;
      re[j] = Math.cos(angle);
      im[j] = Math.sin(angle);
    }
    t = { re, im };
    twiddleCache.set(n, t);
  }
  return t;
}

/** Radix-2 FFT. N must be a power of two. Returns new arrays; the inputs are not modified. */
export function fft(re: ArrayLike<number>, im: ArrayLike<number>, inverse = false): SplitComplex {
  const n = checkInput(re, im);
  if (!isPowerOfTwo(n)) throw new Error(`fft length must be a power of two, got ${n}`);
  const xr = Float64Array.from(re);
  const xi = Float64Array.from(im);
  if (n === 1) return { re: xr, im: xi };

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = xr[i];
      xr[i] = xr[j];
      xr[j] = tmp;
      tmp = xi[i];
      xi[i] = xi[j];
      xi[j] = tmp;
    }
  }

  const tw = twiddles(n);
  const conjSign = inverse ? -1 : 1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let j = 0; j < half; j++) {
        const wr = tw.re[j * step];
        const wi = conjSign * tw.im[j * step];
        const a = start + j;
        const b = a + half;
        const br = xr[b] * wr - xi[b] * wi;
        const bi = xr[b] * wi + xi[b] * wr;
        xr[b] = xr[a] - br;
        xi[b] = xi[a] - bi;
        xr[a] += br;
        xi[a] += bi;
      }
    }
  }
  return { re: xr, im: xi };
}

/** Forward or inverse transform of any length: FFT when N is a power of two, otherwise the reference DFT. */
export function transform(re: ArrayLike<number>, im: ArrayLike<number>, inverse = false): SplitComplex {
  return isPowerOfTwo(re.length) ? fft(re, im, inverse) : dft(re, im, inverse);
}
