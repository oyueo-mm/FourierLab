import { describe, expect, it } from 'vitest';
import { abs, add, arg, complex, conj, expi, fromPolar, mul, rotatingVector, scale, sub } from './complex';

const close = (a: { re: number; im: number }, b: { re: number; im: number }, eps = 1e-12) => {
  expect(Math.abs(a.re - b.re)).toBeLessThan(eps);
  expect(Math.abs(a.im - b.im)).toBeLessThan(eps);
};

describe('complex arithmetic', () => {
  it('adds and subtracts componentwise', () => {
    close(add(complex(1, 2), complex(3, -5)), complex(4, -3));
    close(sub(complex(1, 2), complex(3, -5)), complex(-2, 7));
  });

  it('multiplies with i² = -1', () => {
    close(mul(complex(0, 1), complex(0, 1)), complex(-1, 0));
    close(mul(complex(1, 2), complex(3, 4)), complex(-5, 10));
    close(scale(complex(1, -2), 3), complex(3, -6));
    close(mul(complex(2, 3), conj(complex(2, 3))), complex(13, 0));
  });

  it('computes modulus and argument', () => {
    expect(abs(complex(3, 4))).toBe(5);
    expect(abs(complex(1e200, 1e200))).toBeCloseTo(Math.SQRT2 * 1e200, -185); // no overflow
    expect(arg(complex(0, 1))).toBeCloseTo(Math.PI / 2, 15);
    expect(arg(complex(-1, 0))).toBeCloseTo(Math.PI, 15);
    expect(arg(complex(0, -1))).toBeCloseTo(-Math.PI / 2, 15);
    expect(arg(complex(0, 0))).toBe(0);
  });

  it('round-trips polar form', () => {
    for (const z of [complex(1, 1), complex(-2, 0.5), complex(0.3, -4)]) {
      close(fromPolar(abs(z), arg(z)), z);
    }
    close(expi(Math.PI), complex(-1, 0));
  });

  it('rotates positive frequencies counter-clockwise and negative clockwise', () => {
    const c = complex(1, 0);
    // A quarter period later, k = +1 points up (+90°) and k = -1 points down (-90°).
    close(rotatingVector(c, 1, 0.25), complex(0, 1));
    close(rotatingVector(c, -1, 0.25), complex(0, -1));
    // Initial angle is arg(c); length is |c| at every t.
    const d = fromPolar(2, 0.7);
    close(rotatingVector(d, 3, 0), d);
    for (const t of [0.1, 0.33, 0.9]) expect(abs(rotatingVector(d, 3, t))).toBeCloseTo(2, 12);
    expect(arg(rotatingVector(d, 1, 0.1))).toBeCloseTo(0.7 + 2 * Math.PI * 0.1, 12);
  });
});
