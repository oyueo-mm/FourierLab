import { describe, expect, it } from 'vitest';
import { preparePath } from '../math/path';
import { extractContours, loopLength, toMathPath, traceLoops, type RasterInput } from './contour';

/** Builds an RGBA raster from a per-pixel callback returning [r, g, b, a]. */
function raster(w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): RasterInput {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), 4 * (y * w + x));
  return { width: w, height: h, data };
}
const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

const heart = (x: number, y: number, w: number, h: number) => {
  const u = ((x - w / 2) / (w * 0.4)) * 1.3;
  const v = -((y - h / 2) / (h * 0.4)) * 1.3 + 0.2;
  return (u * u + v * v - 1) ** 3 - u * u * v ** 3 <= 0;
};

/** Largest distance between consecutive points of a closed loop. */
const maxStep = (pts: readonly (readonly [number, number])[]) => {
  let m = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    m = Math.max(m, Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  return m;
};

describe('traceLoops', () => {
  it('traces one closed loop around a square', () => {
    const w = 10;
    const mask = new Uint8Array(w * w);
    for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) mask[y * w + x] = 1;
    const loops = traceLoops(mask, w, w);
    expect(loops).toHaveLength(1);
    // Vertices are edge midpoints, so the corners are cut: a 4×4 square measures ≈ 14.8, not 16.
    expect(loopLength(loops[0])).toBeGreaterThan(14);
    expect(loopLength(loops[0])).toBeLessThan(16);
  });

  it('keeps diagonal-touching pixels as separate loops', () => {
    const mask = new Uint8Array(16);
    mask[1 * 4 + 1] = 1;
    mask[2 * 4 + 2] = 1;
    expect(traceLoops(mask, 4, 4)).toHaveLength(2);
  });

  it('returns an outer loop and a hole for a ring', () => {
    const w = 20;
    const mask = new Uint8Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - 9.5, y - 9.5) < 8 && Math.hypot(x - 9.5, y - 9.5) > 4) mask[y * w + x] = 1;
    expect(traceLoops(mask, w, w)).toHaveLength(2);
  });
});

describe('extractContours', () => {
  it('finds a black heart silhouette as one continuous loop', () => {
    const img = raster(200, 200, (x, y) => (heart(x, y, 200, 200) ? BLACK : WHITE));
    const r = extractContours(img);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const main = r.contours[0];
    expect(main.hole).toBe(false);
    // Every segment follows the boundary (the heart is ~150 px wide): no jump across the image.
    expect(maxStep(main.points)).toBeLessThan(70);
    // Segment midpoints stay on or next to the shape instead of cutting through the background.
    const pts = main.points;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[(i + 1) % pts.length];
      const mx = (pts[i][0] + q[0]) / 2;
      const my = (pts[i][1] + q[1]) / 2;
      const near = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].some(([dx, dy]) => heart(mx + dx, my + dy, 200, 200));
      expect(near).toBe(true);
    }
    // Perimeter of a ~150 px wide heart is several hundred pixels.
    expect(main.length).toBeGreaterThan(350);
  });

  it('finds a circle on white with the right radius and keeps aspect ratio in the math frame', () => {
    const img = raster(120, 80, (x, y) => (Math.hypot(x - 60, y - 40) < 30 ? BLACK : WHITE));
    const r = extractContours(img);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const path = toMathPath(r.contours[0].points);
    const xs = path.map((p) => p[0]);
    const ys = path.map((p) => p[1]);
    const wd = Math.max(...xs) - Math.min(...xs);
    const ht = Math.max(...ys) - Math.min(...ys);
    expect(wd / ht).toBeCloseTo(1, 1);
    expect(Math.max(wd, ht)).toBeCloseTo(1.7, 1);
    expect(path[path.length - 1]).toEqual(path[0]);
  });

  it('uses alpha for a transparent background (white shape on transparent)', () => {
    const img = raster(100, 100, (x, y) => (Math.abs(x - 50) < 20 && Math.abs(y - 50) < 20 ? WHITE : CLEAR));
    const r = extractContours(img);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.transparent).toBe(true);
    expect(r.contours[0].length).toBeGreaterThan(120);
  });

  it('treats a light subject on a dark background as the foreground', () => {
    const img = raster(100, 100, (x, y) => (Math.hypot(x - 50, y - 50) < 25 ? WHITE : BLACK));
    const r = extractContours(img);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contours[0].length).toBeLessThan(200);
  });

  it('reports separate shapes as separate candidates, longest first, never joined', () => {
    const img = raster(200, 100, (x, y) => (Math.hypot(x - 50, y - 50) < 30 || Math.hypot(x - 150, y - 50) < 15 ? BLACK : WHITE));
    const r = extractContours(img);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contours.length).toBe(2);
    expect(r.contours[0].length).toBeGreaterThan(r.contours[1].length);
    for (const c of r.contours) expect(maxStep(c.points)).toBeLessThan(20);
  });

  it('fails cleanly on flat and tiny images', () => {
    const flat = extractContours(raster(64, 64, () => [200, 200, 200, 255]));
    expect(flat.ok).toBe(false);
    const tiny = extractContours(raster(8, 8, () => BLACK));
    expect(tiny.ok).toBe(false);
  });

  it('survives noisy, photo-like input without hanging and stays within the point limit', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const img = raster(384, 384, (x, y) => {
      const v = Math.floor(128 + 100 * Math.sin(x / 9) * Math.cos(y / 11) + (rnd() - 0.5) * 60);
      return [v, v, v, 255];
    });
    const t0 = performance.now();
    const r = extractContours(img);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contours.length).toBeLessThanOrEqual(12);
  });

  it('the extracted path feeds the existing path pipeline in all three modes', () => {
    const img = raster(200, 200, (x, y) => (heart(x, y, 200, 200) ? BLACK : WHITE));
    const r = extractContours(img);
    if (!r.ok) throw new Error('no contour');
    const path = toMathPath(r.contours[0].points);
    for (const mode of ['closed', 'retrace', 'open'] as const) {
      const prepared = preparePath(path, mode, 1024);
      expect(prepared.ok).toBe(true);
    }
  });
});
