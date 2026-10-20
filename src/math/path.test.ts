import { describe, expect, it } from 'vitest';
import { cleanPath, MAX_INPUT_POINTS, pathLength, preparePath, resampleByArcLength, type Vec2 } from './path';
import { allFinite } from './testUtils';

const spacing = (pts: readonly Vec2[], closed: boolean) => {
  const d: number[] = [];
  for (let i = 1; i < pts.length; i++) d.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  if (closed) d.push(Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]));
  return d;
};

describe('cleanPath', () => {
  it('drops NaN / Infinity and merges duplicates', () => {
    const out = cleanPath([
      [0, 0],
      [0, 0],
      [NaN, 1],
      [1, Infinity],
      [1, 0],
      [1, 0],
      [1, 1e-9],
      [2, 0],
    ]);
    expect(out).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });
});

describe('resampleByArcLength', () => {
  it('spaces samples evenly on a uniformly sampled line (open)', () => {
    const line: Vec2[] = Array.from({ length: 11 }, (_, i) => [i / 10, 0]);
    const s = resampleByArcLength(line, 5, false);
    expect(s.map((p) => p[0])).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('spaces samples evenly on an unevenly sampled line', () => {
    const line: Vec2[] = [
      [0, 0],
      [0.01, 0],
      [0.02, 0],
      [0.9, 0],
      [1, 0],
    ];
    const s = resampleByArcLength(line, 101, false);
    for (const d of spacing(s, false)) expect(d).toBeCloseTo(0.01, 12);
    expect(s[100]).toEqual([1, 0]);
  });

  it('includes the closing segment for closed paths', () => {
    const square: Vec2[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const s = resampleByArcLength(square, 8, true);
    expect(s).toEqual([
      [0, 0],
      [0.5, 0],
      [1, 0],
      [1, 0.5],
      [1, 1],
      [0.5, 1],
      [0, 1],
      [0, 0.5],
    ]);
    for (const d of spacing(s, true)) expect(d).toBeCloseTo(0.5, 12);
  });

  it('handles very short paths without NaN', () => {
    const s = resampleByArcLength(
      [
        [0, 0],
        [1e-5, 0],
      ],
      1024,
      true,
    );
    expect(s).toHaveLength(1024);
    expect(allFinite(s)).toBe(true);
  });
});

describe('preparePath', () => {
  const triangle: Vec2[] = [
    [0, 0],
    [1, 0],
    [0, 1],
  ];

  it('rejects empty, single-point and stationary input with a message', () => {
    expect(preparePath([], 'closed', 256)).toMatchObject({ ok: false, error: { code: 'empty' } });
    expect(preparePath([[0.2, 0.3]], 'closed', 256)).toMatchObject({ ok: false, error: { code: 'single-point' } });
    const repeated: Vec2[] = Array.from({ length: 50 }, () => [0.1, 0.1]);
    expect(preparePath(repeated, 'closed', 256)).toMatchObject({ ok: false, error: { code: 'single-point' } });
    expect(
      preparePath(
        [
          [0, 0],
          [0.01, 0],
        ],
        'closed',
        256,
      ),
    ).toMatchObject({ ok: false, error: { code: 'too-short' } });
    expect(preparePath([[NaN, NaN]], 'closed', 256)).toMatchObject({ ok: false, error: { code: 'empty' } });
  });

  it('rejects oversized input instead of truncating it', () => {
    const big: Vec2[] = Array.from({ length: MAX_INPUT_POINTS + 1 }, (_, i) => [i * 1e-4, 0]);
    expect(preparePath(big, 'closed', 256)).toMatchObject({ ok: false, error: { code: 'too-many-points' } });
  });

  it('produces exactly N finite samples in every mode', () => {
    for (const mode of ['closed', 'retrace', 'open'] as const) {
      for (const n of [256, 512, 1024, 2048]) {
        const r = preparePath(triangle, mode, n);
        expect(r.ok).toBe(true);
        if (!r.ok) continue;
        expect(r.path.samples).toHaveLength(n);
        expect(allFinite(r.path.samples)).toBe(true);
      }
    }
  });

  it('closed mode samples the closing segment; open mode starts and ends on the stroke ends', () => {
    const closed = preparePath(triangle, 'closed', 300);
    const open = preparePath(triangle, 'open', 300);
    if (!closed.ok || !open.ok) throw new Error('expected ok');
    expect(closed.path.periodicLength).toBeCloseTo(2 + Math.SQRT2, 12);
    expect(open.path.periodicLength).toBeCloseTo(1 + Math.SQRT2, 12);
    expect(open.path.samples[0]).toEqual([0, 0]);
    expect(open.path.samples[299][0]).toBeCloseTo(0, 12);
    expect(open.path.samples[299][1]).toBeCloseTo(1, 12);
    expect(closed.path.endGap).toBeCloseTo(1, 12);
  });

  it('retrace mode walks the stroke there and back (twice the length, symmetric)', () => {
    const line: Vec2[] = [
      [0, 0],
      [0.5, 0],
      [1, 0],
    ];
    const r = preparePath(line, 'retrace', 8);
    if (!r.ok) throw new Error('expected ok');
    expect(r.path.periodicLength).toBeCloseTo(2, 12);
    expect(r.path.samples.map((p) => p[0])).toEqual([0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25]);
  });

  it('does not add a zero-length closing segment to an already closed stroke', () => {
    const closedSquare: Vec2[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    const r = preparePath(closedSquare, 'closed', 8);
    if (!r.ok) throw new Error('expected ok');
    expect(r.path.periodicLength).toBeCloseTo(4, 12);
    expect(r.path.endGap).toBe(0);
    for (const d of spacing(r.path.samples, true)) expect(d).toBeCloseTo(0.5, 12);
  });

  it('keeps the cleaned stroke separate from the samples', () => {
    const r = preparePath(triangle, 'closed', 64);
    if (!r.ok) throw new Error('expected ok');
    expect(r.path.stroke).toEqual(triangle);
    expect(pathLength(r.path.stroke, false)).toBeCloseTo(1 + Math.SQRT2, 12);
  });
});
