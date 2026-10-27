// Image → contour extraction. Pure functions over pixel arrays (no DOM), so they are unit-testable.
//
// Pipeline: RGBA → "ink" map (0..1, 1 = foreground) → blur → threshold (Otsu by default) →
// marching squares (closed, ordered loops) → smoothing + Douglas–Peucker → math-frame path.
// A contour is traced along the real boundary, so consecutive points are always neighbours;
// separate shapes are never joined with a straight line (one contour = one candidate).

import type { Vec2 } from '../math/path';

export interface RasterInput {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel (as in ImageData.data). */
  data: Uint8ClampedArray;
}

export interface ContourOptions {
  /** 0..1 offset added to the automatic (Otsu) threshold. */
  thresholdOffset: number;
  /** Flip foreground and background (on top of the automatic polarity). */
  invert: boolean;
  /** Douglas–Peucker tolerance in working pixels (0 = keep all points). */
  simplify: number;
  /** Boundary smoothing passes (0 = none). */
  smooth: number;
}

export const DEFAULT_CONTOUR_OPTIONS: ContourOptions = { thresholdOffset: 0, invert: false, simplify: 0.6, smooth: 2 };

export interface Contour {
  /** Closed loop in pixel coordinates (last point != first point). */
  points: Vec2[];
  /** Perimeter in pixels. */
  length: number;
  /** Absolute enclosed area in square pixels. */
  area: number;
  /** True for holes inside a shape. */
  hole: boolean;
}

export type ExtractErrorCode = 'too-small' | 'flat' | 'no-contour';

export interface ExtractError {
  code: ExtractErrorCode;
  message: string;
}

export const EXTRACT_ERRORS: Record<ExtractErrorCode, string> = {
  'too-small': '이미지가 너무 작습니다(최소 16×16 픽셀).',
  flat: '거의 단색 이미지여서 윤곽선을 찾을 수 없습니다.',
  'no-contour': '윤곽선을 찾지 못했습니다. 임계값이나 반전을 바꿔 보세요.',
};

export type ExtractResult =
  | { ok: true; contours: Contour[]; width: number; height: number; threshold: number; transparent: boolean }
  | { ok: false; error: ExtractError };

const err = (code: ExtractErrorCode): ExtractResult => ({ ok: false, error: { code, message: EXTRACT_ERRORS[code] } });

export const MIN_IMAGE_SIDE = 16;
/** Contours shorter than this many pixels are noise. */
const MIN_CONTOUR_LENGTH = 12;
/** Keep at most this many candidates. */
const MAX_CANDIDATES = 12;

/** Builds the 0..1 "ink" map: 1 where a shape probably is. Returns also whether alpha was used. */
export function inkMap(img: RasterInput): { ink: Float32Array; transparent: boolean } {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const ink = new Float32Array(n);
  let transparentPixels = 0;
  for (let i = 0; i < n; i++) if (data[4 * i + 3] < 250) transparentPixels++;
  const transparent = transparentPixels / n > 0.01;

  if (transparent) {
    for (let i = 0; i < n; i++) ink[i] = data[4 * i + 3] / 255;
    return { ink, transparent };
  }

  for (let i = 0; i < n; i++) {
    const lum = (0.2126 * data[4 * i] + 0.7152 * data[4 * i + 1] + 0.0722 * data[4 * i + 2]) / 255;
    ink[i] = 1 - lum; // dark = foreground
  }
  // Dark background (mean of the border darker than mid-grey): the subject is the light part.
  let border = 0;
  let count = 0;
  const add = (x: number, y: number) => {
    border += ink[y * w + x];
    count++;
  };
  for (let x = 0; x < w; x++) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    add(0, y);
    add(w - 1, y);
  }
  if (border / count > 0.5) for (let i = 0; i < n; i++) ink[i] = 1 - ink[i];
  return { ink, transparent };
}

/** 3×3 box blur, edges clamped. */
export function boxBlur(src: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = src[y * w + Math.max(0, x - 1)];
      const b = src[y * w + x];
      const c = src[y * w + Math.min(w - 1, x + 1)];
      tmp[y * w + x] = (a + b + c) / 3;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = tmp[Math.max(0, y - 1) * w + x];
      const b = tmp[y * w + x];
      const c = tmp[Math.min(h - 1, y + 1) * w + x];
      out[y * w + x] = (a + b + c) / 3;
    }
  }
  return out;
}

/** Otsu's threshold of values in [0, 1]. */
export function otsu(values: Float32Array): number {
  const BINS = 256;
  const hist = new Float64Array(BINS);
  for (let i = 0; i < values.length; i++) hist[Math.min(BINS - 1, Math.max(0, Math.floor(values[i] * BINS)))]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < BINS; i++) sumAll += i * hist[i];
  let wB = 0;
  let sumB = 0;
  let best = -1;
  let threshold = BINS / 2;
  for (let i = 0; i < BINS; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = i + 1;
    }
  }
  return threshold / BINS;
}

// Marching squares on a padded mask. Vertices are edge midpoints, identified by
// (cell index * 2 + {0: horizontal edge, 1: vertical edge}). Segments are directed so that the
// foreground is always on the same side, which makes every vertex have exactly one successor.
// Cell corners: TL=1, TR=2, BR=4, BL=8. Edges: T = horizontal at (x, y), B = horizontal at
// (x, y+1), L = vertical at (x, y), R = vertical at (x+1, y).
type E = 'T' | 'R' | 'B' | 'L';
const SEGMENTS: Record<number, [E, E][]> = {
  1: [['L', 'T']],
  2: [['T', 'R']],
  3: [['L', 'R']],
  4: [['R', 'B']],
  5: [['L', 'T'], ['R', 'B']],
  6: [['T', 'B']],
  7: [['L', 'B']],
  8: [['B', 'L']],
  9: [['B', 'T']],
  10: [['T', 'R'], ['B', 'L']],
  11: [['B', 'R']],
  12: [['R', 'L']],
  13: [['R', 'T']],
  14: [['T', 'L']],
};

/** Traces all boundaries of `mask` (1 = foreground) as closed loops in pixel coordinates. */
export function traceLoops(mask: Uint8Array, w: number, h: number): Vec2[][] {
  // Pad by one background pixel so every shape is closed.
  const pw = w + 2;
  const ph = h + 2;
  const padded = new Uint8Array(pw * ph);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) padded[(y + 1) * pw + x + 1] = mask[y * w + x];

  const vid = (e: E, x: number, y: number) => {
    switch (e) {
      case 'T': return (y * pw + x) * 2;
      case 'B': return ((y + 1) * pw + x) * 2;
      case 'L': return (y * pw + x) * 2 + 1;
      case 'R': return (y * pw + x + 1) * 2 + 1;
    }
  };
  const next = new Map<number, number>();
  for (let y = 0; y < ph - 1; y++) {
    for (let x = 0; x < pw - 1; x++) {
      const c = padded[y * pw + x] | (padded[y * pw + x + 1] << 1) | (padded[(y + 1) * pw + x + 1] << 2) | (padded[(y + 1) * pw + x] << 3);
      const segs = SEGMENTS[c];
      if (!segs) continue;
      for (const [a, b] of segs) next.set(vid(a, x, y), vid(b, x, y));
    }
  }

  const position = (id: number): Vec2 => {
    const vertical = id & 1;
    const cell = id >> 1;
    const x = cell % pw;
    const y = (cell - x) / pw;
    // Subtract the padding so coordinates are in image pixel space (pixel centres at +0.5).
    return vertical ? [x - 1 + 0.5, y - 1 + 1] : [x - 1 + 1, y - 1 + 0.5];
  };

  const loops: Vec2[][] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: Vec2[] = [];
    let cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      loop.push(position(cur));
      const n = next.get(cur);
      if (n === undefined) break;
      cur = n;
    }
    loops.push(loop);
  }
  return loops;
}

export const signedArea = (pts: readonly Vec2[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

export const loopLength = (pts: readonly Vec2[]): number => {
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    len += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return len;
};

/** Chaikin-free smoothing: each pass moves a point toward the mean of its neighbours (loop). */
export function smoothLoop(pts: readonly Vec2[], passes: number): Vec2[] {
  let cur = pts as Vec2[];
  for (let k = 0; k < passes; k++) {
    const n = cur.length;
    if (n < 4) break;
    cur = cur.map((p, i) => {
      const a = cur[(i - 1 + n) % n];
      const b = cur[(i + 1) % n];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4] as Vec2;
    });
  }
  return cur;
}

/** Douglas–Peucker on an open polyline (iterative, no recursion depth issues). */
export function simplifyPolyline(pts: readonly Vec2[], epsilon: number): Vec2[] {
  const n = pts.length;
  if (epsilon <= 0 || n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [ax, ay] = pts[s];
    const [bx, by] = pts[e];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = pts[i];
      let d: number;
      if (len2 === 0) d = Math.hypot(px - ax, py - ay);
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx >= 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplifies a closed loop (splits at the two farthest-apart anchor points so the seam is not special). */
export function simplifyLoop(pts: readonly Vec2[], epsilon: number): Vec2[] {
  const n = pts.length;
  if (epsilon <= 0 || n < 8) return pts.slice();
  const half = Math.floor(n / 2);
  const a = simplifyPolyline(pts.slice(0, half + 1), epsilon);
  const b = simplifyPolyline([...pts.slice(half), pts[0]], epsilon);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Extracts contour candidates, longest first. */
export function extractContours(img: RasterInput, options: ContourOptions = DEFAULT_CONTOUR_OPTIONS): ExtractResult {
  const { width: w, height: h } = img;
  if (w < MIN_IMAGE_SIDE || h < MIN_IMAGE_SIDE) return err('too-small');

  const { ink: raw, transparent } = inkMap(img);
  let lo = 1;
  let hi = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] < lo) lo = raw[i];
    if (raw[i] > hi) hi = raw[i];
  }
  if (hi - lo < 0.08) return err('flat');

  const ink = transparent ? raw : boxBlur(raw, w, h);
  const threshold = Math.min(0.98, Math.max(0.02, otsu(ink) + options.thresholdOffset));
  const mask = new Uint8Array(w * h);
  let fg = 0;
  for (let i = 0; i < mask.length; i++) {
    const on = options.invert ? ink[i] < threshold : ink[i] >= threshold;
    mask[i] = on ? 1 : 0;
    fg += mask[i];
  }
  if (fg === 0) return err('no-contour');

  const contours: Contour[] = [];
  for (const loop of traceLoops(mask, w, h)) {
    if (loop.length < 8) continue;
    const length = loopLength(loop);
    if (length < MIN_CONTOUR_LENGTH) continue;
    const sa = signedArea(loop);
    const smoothed = smoothLoop(loop, options.smooth);
    const simplified = simplifyLoop(smoothed, options.simplify);
    if (simplified.length < 4) continue;
    contours.push({ points: simplified, length: loopLength(simplified), area: Math.abs(sa), hole: sa > 0 });
  }
  if (contours.length === 0) return err('no-contour');
  contours.sort((a, b) => b.length - a.length);
  return { ok: true, contours: contours.slice(0, MAX_CANDIDATES), width: w, height: h, threshold, transparent };
}

/**
 * Converts a pixel-space loop into the app's math frame: y up, centred on the contour's bounding
 * box, whose longer side spans ±`fill` of the drawing canvas. The aspect ratio is preserved, and the
 * first point is repeated at the end so the stroke is visibly closed.
 */
export function toMathPath(loop: readonly Vec2[], fill = 0.85): Vec2[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of loop) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const half = Math.max(maxX - minX, maxY - minY) / 2 || 1;
  const scale = fill / half;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const out: Vec2[] = loop.map((p) => [(p[0] - cx) * scale, -(p[1] - cy) * scale]);
  out.push(out[0]);
  return out;
}
