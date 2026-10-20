import { describe, expect, it } from 'vitest';
import { binIndex, computeSpectrum, signedFrequency } from './fourier';
import { rankComponents, selectComponents } from './selection';
import { chainTip, compileChain, evaluateChain } from './epicycles';
import { curveResolution, errorCurve, evaluateSeries, evaluateSeriesAt, reconstructAtSamples, rmse, rmsRadius } from './reconstruct';
import { preparePath, type Vec2 } from './path';
import { PRESETS } from './presets';
import { maxPointDistance, rng, rotatingSamples } from './testUtils';

describe('signed frequencies', () => {
  it('maps bins to 0, +1, …, then negatives (Nyquist → -N/2 for even N)', () => {
    expect([0, 1, 2, 3].map((i) => signedFrequency(i, 4))).toEqual([0, 1, -2, -1]);
    expect([0, 1, 2, 3, 4].map((i) => signedFrequency(i, 5))).toEqual([0, 1, 2, -2, -1]);
    for (const n of [4, 5, 256]) for (let i = 0; i < n; i++) expect(binIndex(signedFrequency(i, n), n)).toBe(i);
  });

  it('orders coefficients from -N/2 to N/2-1 with a working index', () => {
    const s = computeSpectrum(rotatingSamples(8, 1));
    expect(s.coefficients.map((c) => c.k)).toEqual([-4, -3, -2, -1, 0, 1, 2, 3]);
    for (const c of s.coefficients) expect(s.coefficients[s.indexOf(c.k)]).toBe(c);
  });
});

describe('computeSpectrum', () => {
  it('a constant signal has only a DC term', () => {
    const s = computeSpectrum(Array.from({ length: 64 }, (): Vec2 => [0.3, -0.2]));
    const dc = s.coefficients[s.indexOf(0)];
    expect(dc.re).toBeCloseTo(0.3, 14);
    expect(dc.im).toBeCloseTo(-0.2, 14);
    for (const c of s.coefficients) if (c.k !== 0) expect(c.amplitude).toBeLessThan(1e-14);
  });

  it('a counter-clockwise circle is a single positive-frequency term with the right radius and phase', () => {
    const s = computeSpectrum(rotatingSamples(256, 1, 0.7, 0.4, [0.1, -0.2]));
    const c1 = s.coefficients[s.indexOf(1)];
    expect(c1.amplitude).toBeCloseTo(0.7, 12);
    expect(c1.phase).toBeCloseTo(0.4, 12);
    const dc = s.coefficients[s.indexOf(0)];
    expect([dc.re, dc.im]).toEqual([expect.closeTo(0.1, 12), expect.closeTo(-0.2, 12)]);
    for (const c of s.coefficients) if (c.k !== 0 && c.k !== 1) expect(c.amplitude).toBeLessThan(1e-12);
  });

  it('a clockwise circle lands on a negative frequency, not on +k', () => {
    for (const k of [-1, -3, -17]) {
      const s = computeSpectrum(rotatingSamples(128, k, 0.5));
      expect(s.coefficients[s.indexOf(k)].amplitude).toBeCloseTo(0.5, 12);
      expect(s.coefficients[s.indexOf(-k)].amplitude).toBeLessThan(1e-12);
    }
  });

  it('does not assume conjugate symmetry (complex signals)', () => {
    // z = 0.6 e^{i2π·3t} + 0.2 e^{-i2π·5t}: amplitudes at +3 and -5 only, not mirrored.
    const n = 64;
    const a = rotatingSamples(n, 3, 0.6);
    const b = rotatingSamples(n, -5, 0.2);
    const s = computeSpectrum(a.map((p, i): Vec2 => [p[0] + b[i][0], p[1] + b[i][1]]));
    expect(s.coefficients[s.indexOf(3)].amplitude).toBeCloseTo(0.6, 12);
    expect(s.coefficients[s.indexOf(-5)].amplitude).toBeCloseTo(0.2, 12);
    expect(s.coefficients[s.indexOf(-3)].amplitude).toBeLessThan(1e-12);
    expect(s.coefficients[s.indexOf(5)].amplitude).toBeLessThan(1e-12);
  });

  it('stores Parseval energy', () => {
    const r = rng(5);
    const pts = Array.from({ length: 128 }, (): Vec2 => [r(), r()]);
    const s = computeSpectrum(pts);
    const mean = pts.reduce((acc, p) => acc + p[0] ** 2 + p[1] ** 2, 0) / pts.length;
    expect(s.totalEnergy).toBeCloseTo(mean, 12);
  });
});

describe('component selection', () => {
  const r = rng(11);
  const pts = Array.from({ length: 64 }, (): Vec2 => [r() - 0.5, r() - 0.5]);
  const s = computeSpectrum(pts);

  it('frequency order is +1, -1, +2, -2, … and excludes DC', () => {
    const ranked = rankComponents(s, 'frequency');
    expect(ranked.slice(0, 6).map((c) => c.k)).toEqual([1, -1, 2, -2, 3, -3]);
    expect(ranked).toHaveLength(63);
    expect(ranked.some((c) => c.k === 0)).toBe(false);
    expect(ranked[ranked.length - 1].k).toBe(-32); // Nyquist last
  });

  it('amplitude order is non-increasing', () => {
    const ranked = rankComponents(s, 'amplitude');
    for (let i = 1; i < ranked.length; i++) expect(ranked[i].amplitude).toBeLessThanOrEqual(ranked[i - 1].amplitude);
  });

  it('chain order changes the drawing order but not the selected set', () => {
    const ranked = rankComponents(s, 'frequency');
    const a = selectComponents(s, ranked, 10, 'amplitude');
    const b = selectComponents(s, ranked, 10, 'frequency');
    expect([...a.frequencies].sort()).toEqual([...b.frequencies].sort());
    expect(b.chain.map((c) => c.k)).toEqual([1, -1, 2, -2, 3, -3, 4, -4, 5, -5]);
    for (let i = 1; i < a.chain.length; i++) expect(a.chain[i].amplitude).toBeLessThanOrEqual(a.chain[i - 1].amplitude);
    // Same set → same tip at any time, regardless of stacking order.
    for (const t of [0, 0.123, 0.5, 0.987]) {
      expect(maxPointDistance([chainTip(compileChain(a), t)], [chainTip(compileChain(b), t)])).toBeLessThan(1e-13);
    }
  });

  it('clamps the requested count', () => {
    const ranked = rankComponents(s, 'amplitude');
    expect(selectComponents(s, ranked, -3, 'amplitude').chain).toHaveLength(0);
    expect(selectComponents(s, ranked, 1e9, 'amplitude').chain).toHaveLength(63);
  });
});

describe('epicycles', () => {
  const s = computeSpectrum(
    rotatingSamples(64, 2, 0.5, 0.3).map((p, i): Vec2 => {
      const q = rotatingSamples(64, -1, 0.25, 1.1)[i];
      return [p[0] + q[0] + 0.2, p[1] + q[1] - 0.1];
    }),
  );
  const all = selectComponents(s, rankComponents(s, 'amplitude'), 2, 'amplitude');
  const chain = compileChain(all);

  it('starts at the origin, then the DC offset, then arms head to tail', () => {
    const j = evaluateChain(chain, 0);
    expect([j[0], j[1]]).toEqual([0, 0]);
    expect(j[2]).toBeCloseTo(0.2, 12);
    expect(j[3]).toBeCloseTo(-0.1, 12);
    // Every arm has the length of its coefficient at every time.
    for (const t of [0, 0.3, 0.71]) {
      const jt = evaluateChain(chain, t);
      for (let i = 0; i < chain.count; i++) {
        const len = Math.hypot(jt[4 + 2 * i] - jt[2 + 2 * i], jt[5 + 2 * i] - jt[3 + 2 * i]);
        expect(len).toBeCloseTo(chain.amplitude[i], 12);
      }
    }
  });

  it('a single positive arm turns counter-clockwise, a negative one clockwise', () => {
    for (const k of [1, -1]) {
      const sp = computeSpectrum(rotatingSamples(32, k, 1));
      const c = compileChain(selectComponents(sp, rankComponents(sp, 'amplitude'), 1, 'amplitude'));
      const a = chainTip(c, 0);
      const b = chainTip(c, 0.01);
      const cross = a[0] * b[1] - a[1] * b[0]; // > 0 ⇔ counter-clockwise (y up)
      expect(Math.sign(cross)).toBe(k);
    }
  });

  it('the tip is the series sum at any t, and t = 0 and t = 1 coincide', () => {
    const terms = [all.dc, ...all.chain];
    for (const t of [0, 0.05, 0.25, 0.5, 0.999]) {
      expect(maxPointDistance([chainTip(chain, t)], [evaluateSeriesAt(terms, t)])).toBeLessThan(1e-13);
    }
    expect(maxPointDistance([chainTip(chain, 0)], [chainTip(chain, 1)])).toBe(0);
  });

  it('reuses the output buffer', () => {
    const buf = new Float64Array(64);
    expect(evaluateChain(chain, 0.4, buf)).toBe(buf);
  });
});

describe('reconstruction', () => {
  it('the zero-padded inverse FFT matches direct evaluation between samples', () => {
    const r = rng(3);
    const s = computeSpectrum(Array.from({ length: 128 }, (): Vec2 => [r(), r()]));
    const sel = selectComponents(s, rankComponents(s, 'amplitude'), 40, 'amplitude');
    const terms = [sel.dc, ...sel.chain];
    const m = curveResolution(128);
    const curve = evaluateSeries(terms, m);
    for (const i of [0, 1, 7, 333, m - 1]) {
      const p = evaluateSeriesAt(terms, i / m);
      expect(curve.x[i]).toBeCloseTo(p[0], 12);
      expect(curve.y[i]).toBeCloseTo(p[1], 12);
    }
  });

  it('all components reproduce the original samples (general curve, every N)', () => {
    for (const n of [256, 512, 1024, 2048]) {
      const r = rng(n);
      const raw = Array.from({ length: 40 }, (): Vec2 => [r() * 2 - 1, r() * 2 - 1]);
      const prepared = preparePath(raw, 'closed', n);
      if (!prepared.ok) throw new Error('expected ok');
      const s = computeSpectrum(prepared.path.samples);
      const ranked = rankComponents(s, 'frequency');
      const sel = selectComponents(s, ranked, ranked.length, 'amplitude');
      const rec = reconstructAtSamples([sel.dc, ...sel.chain], n);
      expect(maxPointDistance(rec, prepared.path.samples)).toBeLessThan(1e-12);
      // …and so does the epicycle chain itself.
      const chain = compileChain(sel);
      for (const i of [0, 1, n >> 1, n - 1]) {
        expect(maxPointDistance([chainTip(chain, i / n)], [prepared.path.samples[i]])).toBeLessThan(1e-11);
      }
    }
  });

  it('Parseval error curve equals the directly measured RMSE and never increases', () => {
    const r = rng(21);
    const prepared = preparePath(
      Array.from({ length: 30 }, (): Vec2 => [r() * 2 - 1, r() * 2 - 1]),
      'closed',
      256,
    );
    if (!prepared.ok) throw new Error('expected ok');
    const s = computeSpectrum(prepared.path.samples);
    for (const mode of ['frequency', 'amplitude'] as const) {
      const ranked = rankComponents(s, mode);
      const curve = errorCurve(ranked);
      expect(curve).toHaveLength(ranked.length + 1);
      for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeLessThanOrEqual(curve[i - 1] + 1e-15);
      expect(curve[ranked.length]).toBe(0);
      expect(curve[0]).toBeCloseTo(rmsRadius(s), 12);
      for (const k of [0, 1, 5, 40, 200, 255]) {
        const sel = selectComponents(s, ranked, k, 'amplitude');
        const direct = rmse(prepared.path.samples, reconstructAtSamples([sel.dc, ...sel.chain], 256));
        expect(curve[k]).toBeCloseTo(direct, 11);
      }
    }
    // Amplitude order is optimal: never worse than frequency order for the same K.
    const ca = errorCurve(rankComponents(s, 'amplitude'));
    const cf = errorCurve(rankComponents(s, 'frequency'));
    for (let k = 0; k < ca.length; k++) expect(ca[k]).toBeLessThanOrEqual(cf[k] + 1e-12);
  });
});

describe('presets', () => {
  const analyse = (id: string, n = 1024) => {
    const preset = PRESETS.find((p) => p.id === id)!;
    const prepared = preparePath(preset.points, preset.mode, n);
    if (!prepared.ok) throw new Error(`${id}: ${prepared.error.message}`);
    const s = computeSpectrum(prepared.path.samples);
    return { prepared: prepared.path, s, curveF: errorCurve(rankComponents(s, 'frequency')), curveA: errorCurve(rankComponents(s, 'amplitude')) };
  };

  it('every preset prepares cleanly in every mode', () => {
    for (const p of PRESETS) {
      for (const mode of ['closed', 'retrace', 'open'] as const) {
        const r = preparePath(p.points, mode, 512);
        expect(r.ok, `${p.id}/${mode}`).toBe(true);
      }
    }
  });

  it('circle: one circle (k = +1) is enough', () => {
    const { s, curveA } = analyse('circle');
    expect(rankComponents(s, 'amplitude')[0].k).toBe(1);
    expect(s.coefficients[s.indexOf(1)].amplitude).toBeCloseTo(0.7, 4);
    expect(curveA[1]).toBeLessThan(1e-4); // residual from the 360-gon the preset is drawn as
  });

  it('ellipse: dominated by k = +1 and k = -1', () => {
    const { s } = analyse('ellipse');
    expect(new Set(rankComponents(s, 'amplitude').slice(0, 2).map((c) => c.k))).toEqual(new Set([1, -1]));
  });

  it('heart and star converge as circles are added', () => {
    for (const id of ['heart', 'star']) {
      const { curveF, s } = analyse(id);
      const scale = rmsRadius(s);
      // Relative RMSE with 10 / 50 / 100 circles (frequency order).
      const rel = [10, 50, 100].map((k) => curveF[k] / scale);
      expect(rel[0]).toBeGreaterThan(rel[1]);
      expect(rel[1]).toBeGreaterThan(rel[2]);
      expect(rel[2]).toBeLessThan(0.01);
    }
  });

  it('open mode shows a slower decay than closed mode for the spiral (end-to-start jump)', () => {
    const preset = PRESETS.find((p) => p.id === 'spiral')!;
    const err = (mode: 'closed' | 'open') => {
      const prepared = preparePath(preset.points, mode, 1024);
      if (!prepared.ok) throw new Error('expected ok');
      const s = computeSpectrum(prepared.path.samples);
      return errorCurve(rankComponents(s, 'frequency'))[100] / rmsRadius(s);
    };
    expect(err('open')).toBeGreaterThan(err('closed'));
  });
});
