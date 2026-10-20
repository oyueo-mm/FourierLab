// Path cleaning, validation and arc-length resampling.
//
// Coordinates here are always in the *math frame*: y points up and the drawing canvas
// spans [-1, 1] on its shorter side (so 1 unit = half the drawing canvas). Screen
// coordinates never reach this module.

export type Vec2 = readonly [number, number];

/**
 * How a single stroke becomes a periodic signal:
 * - closed:  the end is joined back to the start with a straight segment (default).
 * - retrace: the stroke is walked forwards and then backwards, so the signal is continuous
 *            without adding a new segment (every part of the drawing is traced twice).
 * - open:    the stroke is sampled as-is; periodic repetition jumps from the end straight
 *            back to the start, which a truncated series can only approximate with ringing.
 */
export type PathMode = 'closed' | 'retrace' | 'open';

export const PATH_MODES: readonly PathMode[] = ['closed', 'retrace', 'open'];

export const SAMPLE_COUNTS = [256, 512, 1024, 2048] as const;
export type SampleCount = (typeof SAMPLE_COUNTS)[number];

/** Raw strokes longer than this are rejected rather than silently truncated. */
export const MAX_INPUT_POINTS = 20000;
/** Consecutive points closer than this (math units) are merged. */
export const MIN_POINT_DISTANCE = 1e-6;
/** A path shorter than this (2% of the drawing canvas width) is too short to analyse. */
export const MIN_PATH_LENGTH = 0.04;

export type PathErrorCode = 'empty' | 'single-point' | 'too-short' | 'too-many-points';

export interface PathError {
  code: PathErrorCode;
  message: string;
}

export const PATH_ERROR_MESSAGES: Record<PathErrorCode, string> = {
  empty: '그림이 비어 있습니다. 캔버스에 선을 그리거나 예제를 선택해 주세요.',
  'single-point': '점 하나만 입력되었습니다. 클릭 대신 드래그해서 선을 그려 주세요.',
  'too-short': '선이 너무 짧습니다. 조금 더 크게 그려 주세요.',
  'too-many-points': `입력 좌표가 너무 많습니다(최대 ${MAX_INPUT_POINTS.toLocaleString()}개). 더 단순한 선으로 다시 그려 주세요.`,
};

const pathError = (code: PathErrorCode): PathError => ({ code, message: PATH_ERROR_MESSAGES[code] });

const isFinitePoint = (p: Vec2 | undefined): p is Vec2 =>
  !!p && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Drops non-finite points and merges consecutive (near-)duplicates. */
export function cleanPath(points: readonly Vec2[], minDistance = MIN_POINT_DISTANCE): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    if (!isFinitePoint(p)) continue;
    const last = out[out.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < minDistance) continue;
    out.push([p[0], p[1]]);
  }
  return out;
}

/** Total length of the polyline, including the closing segment when `closed`. */
export function pathLength(points: readonly Vec2[], closed: boolean): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  if (closed && points.length > 1) {
    const a = points[points.length - 1];
    len += Math.hypot(points[0][0] - a[0], points[0][1] - a[1]);
  }
  return len;
}

/**
 * Samples `count` points spaced evenly by arc length.
 * - closed: s_j = j·L/count, j = 0..count-1 (the closing segment is part of L, and the
 *   last sample sits one step before returning to the start).
 * - open:   s_j = j·L/(count-1), so the first and last samples are the stroke's endpoints.
 * Expects a cleaned path with at least two distinct points.
 */
export function resampleByArcLength(points: readonly Vec2[], count: number, closed: boolean): Vec2[] {
  if (points.length < 2) throw new Error('resampleByArcLength needs at least two points');
  if (!Number.isInteger(count) || count < 2) throw new Error(`invalid sample count ${count}`);

  const verts = closed ? [...points, points[0]] : [...points];
  const cum = new Float64Array(verts.length);
  for (let i = 1; i < verts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(verts[i][0] - verts[i - 1][0], verts[i][1] - verts[i - 1][1]);
  }
  const total = cum[verts.length - 1];
  if (!(total > 0)) throw new Error('path has zero length');

  const step = closed ? total / count : total / (count - 1);
  const out: Vec2[] = new Array(count);
  let seg = 1; // current segment is verts[seg-1] → verts[seg]
  for (let j = 0; j < count; j++) {
    const s = j === count - 1 && !closed ? total : j * step;
    while (seg < verts.length - 1 && cum[seg] < s) seg++;
    const a = verts[seg - 1];
    const b = verts[seg];
    const segLen = cum[seg] - cum[seg - 1];
    const u = segLen > 0 ? Math.min(1, Math.max(0, (s - cum[seg - 1]) / segLen)) : 0;
    out[j] = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  }
  return out;
}

export interface PreparedPath {
  /** The cleaned stroke as drawn (what the user sees as "original"). */
  stroke: Vec2[];
  /** The periodic signal z_n, n = 0..N-1, uniformly spaced in arc length. */
  samples: Vec2[];
  mode: PathMode;
  /** Gap between stroke end and start (math units). Shown as the joining / jump segment. */
  endGap: number;
  /** Length of the periodic path that was sampled (includes closing segment / return trip). */
  periodicLength: number;
}

export type PrepareResult = { ok: true; path: PreparedPath } | { ok: false; error: PathError };

/** Cleans, validates and resamples a single stroke into N periodic samples. Never throws for bad input. */
export function preparePath(raw: readonly Vec2[], mode: PathMode, sampleCount: number): PrepareResult {
  if (raw.length > MAX_INPUT_POINTS) return { ok: false, error: pathError('too-many-points') };
  const stroke = cleanPath(raw);
  if (stroke.length === 0) return { ok: false, error: pathError('empty') };
  if (stroke.length === 1) return { ok: false, error: pathError('single-point') };
  if (pathLength(stroke, false) < MIN_PATH_LENGTH) return { ok: false, error: pathError('too-short') };

  const first = stroke[0];
  const last = stroke[stroke.length - 1];
  const endGap = Math.hypot(last[0] - first[0], last[1] - first[1]);

  let periodic: Vec2[];
  let closed: boolean;
  if (mode === 'closed') {
    // A stroke that already ends on its start would otherwise get a zero-length closing segment.
    periodic = endGap < MIN_POINT_DISTANCE ? stroke.slice(0, -1) : stroke;
    closed = true;
  } else if (mode === 'retrace') {
    // start → end → back to (just after) start; the closing segment completes the return trip.
    periodic = [...stroke, ...stroke.slice(1, -1).reverse()];
    closed = true;
  } else {
    periodic = stroke;
    closed = false;
  }
  if (periodic.length < 2) return { ok: false, error: pathError('single-point') };

  const samples = resampleByArcLength(periodic, sampleCount, closed);
  return { ok: true, path: { stroke, samples, mode, endGap, periodicLength: pathLength(periodic, closed) } };
}
