// Canvas 2D drawing of the visualiser, split into two layers:
//   static  — background, grid, original stroke, full reconstruction preview
//   dynamic — trail, epicycles, pen tip (redrawn every animation frame)
// The functions take a context and a size, so PNG export reuses them on an offscreen canvas.

import type { DisplaySettings } from '../core/settings';
import { pixelsPerUnit, type View, type Viewport } from '../core/view';
import { evaluateChain, jointBufferLength, type CompiledChain } from '../math/epicycles';
import type { PathMode, Vec2 } from '../math/path';
import type { Curve } from '../math/reconstruct';

export const COLORS = {
  background: '#ffffff',
  gridMinor: '#eef1f5',
  gridMajor: '#dde3ea',
  axis: '#c3ccd8',
  original: '#a3adbb',
  joinClosed: '#d97706',
  joinOpen: '#e11d48',
  preview: '#14b8a6',
  arm: '#334155',
  dcArm: '#94a3b8',
  circle: '#64748b',
  circlePositive: '#4f46e5',
  circleNegative: '#0d9488',
  selected: '#f59e0b',
  tip: '#e11d48',
} as const;

export interface SceneData {
  /** Original stroke (math frame). */
  stroke: readonly Vec2[] | null;
  mode: PathMode;
  /** Distance between stroke end and start; the joining segment is drawn when visible. */
  endGap: number;
  /** Reconstruction sampled at M evenly spaced t (closed: point M ≡ point 0). */
  curve: Curve | null;
  chain: CompiledChain | null;
  selectedK: number | null;
  display: DisplaySettings;
}

export interface Frame extends Viewport {
  view: View;
}

interface Xf {
  s: number;
  ox: number;
  oy: number;
}

const transformOf = (frame: Frame): Xf => {
  const s = pixelsPerUnit(frame.view, frame);
  return { s, ox: frame.width / 2 - frame.view.cx * s, oy: frame.height / 2 + frame.view.cy * s };
};

function drawGrid(ctx: CanvasRenderingContext2D, frame: Frame, xf: Xf) {
  // Pick a world step that lands 40–100 px apart on screen: 1, 2 or 5 × 10^n.
  const target = 60 / xf.s;
  const pow = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= target) ?? 10 * pow;
  const x0 = Math.floor(-xf.ox / xf.s / step) * step;
  const x1 = (frame.width - xf.ox) / xf.s;
  const y0 = Math.floor((xf.oy - frame.height) / xf.s / step) * step;
  const y1 = xf.oy / xf.s;

  ctx.lineWidth = 1;
  for (const major of [false, true]) {
    ctx.beginPath();
    for (let x = x0, i = Math.round(x0 / step); x <= x1; x += step, i++) {
      if ((i % 5 === 0) !== major) continue;
      const sx = Math.round(xf.ox + x * xf.s) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, frame.height);
    }
    for (let y = y0, i = Math.round(y0 / step); y <= y1; y += step, i++) {
      if ((i % 5 === 0) !== major) continue;
      const sy = Math.round(xf.oy - y * xf.s) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(frame.width, sy);
    }
    ctx.strokeStyle = major ? COLORS.gridMajor : COLORS.gridMinor;
    ctx.stroke();
  }
  ctx.beginPath();
  const ax = Math.round(xf.ox) + 0.5;
  const ay = Math.round(xf.oy) + 0.5;
  ctx.moveTo(ax, 0);
  ctx.lineTo(ax, frame.height);
  ctx.moveTo(0, ay);
  ctx.lineTo(frame.width, ay);
  ctx.strokeStyle = COLORS.axis;
  ctx.stroke();
}

function polyline(ctx: CanvasRenderingContext2D, pts: readonly Vec2[], xf: Xf) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const sx = xf.ox + x * xf.s;
    const sy = xf.oy - y * xf.s;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
}

/** Path from curve point 0 through point `end` (inclusive, wrapping at M). */
function curvePath(ctx: CanvasRenderingContext2D, curve: Curve, end: number, xf: Xf) {
  const m = curve.x.length;
  ctx.beginPath();
  ctx.moveTo(xf.ox + curve.x[0] * xf.s, xf.oy - curve.y[0] * xf.s);
  for (let i = 1; i <= end; i++) {
    const j = i % m;
    ctx.lineTo(xf.ox + curve.x[j] * xf.s, xf.oy - curve.y[j] * xf.s);
  }
}

/** Visible joining segment between stroke end and start, if the mode adds one. */
export function joinSegment(scene: Pick<SceneData, 'stroke' | 'mode' | 'endGap'>): [Vec2, Vec2] | null {
  if (!scene.stroke || scene.stroke.length < 2 || scene.mode === 'retrace' || scene.endGap < 1e-3) return null;
  return [scene.stroke[scene.stroke.length - 1], scene.stroke[0]];
}

export function drawStaticLayer(ctx: CanvasRenderingContext2D, scene: SceneData, frame: Frame) {
  const xf = transformOf(frame);
  const d = scene.display;
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, frame.width, frame.height);
  if (d.grid) drawGrid(ctx, frame, xf);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (d.original && scene.stroke && scene.stroke.length > 1) {
    polyline(ctx, scene.stroke, xf);
    ctx.strokeStyle = COLORS.original;
    ctx.lineWidth = 1.75;
    ctx.stroke();
    const join = joinSegment(scene);
    if (join) {
      polyline(ctx, join, xf);
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = scene.mode === 'open' ? COLORS.joinOpen : COLORS.joinClosed;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (d.preview && scene.curve) {
    curvePath(ctx, scene.curve, scene.curve.x.length, xf);
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = COLORS.preview;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** Circles are batched by on-screen radius; larger ones are drawn more strongly. */
const CIRCLE_BUCKETS = [
  { minRadius: 60, alpha: 0.5 },
  { minRadius: 20, alpha: 0.38 },
  { minRadius: 6, alpha: 0.27 },
  { minRadius: 0.6, alpha: 0.16 },
];

export interface DynamicResult {
  joints: Float64Array;
  /** Pen tip in canvas CSS pixels. */
  tipScreen: Vec2;
}

/**
 * Draws trail, epicycles and the pen tip at progress `t`. `jointsBuffer` is reused between
 * frames. The tip drawn is the last joint of `evaluateChain`, i.e. ẑ(t) of the math module.
 */
export function drawDynamicLayer(
  ctx: CanvasRenderingContext2D,
  scene: SceneData,
  frame: Frame,
  t: number,
  jointsBuffer?: Float64Array,
): DynamicResult | null {
  const chain = scene.chain;
  if (!chain) return null;
  const xf = transformOf(frame);
  const d = scene.display;
  const joints = evaluateChain(chain, t, jointsBuffer);
  const n = chain.count;
  const last = 2 * (n + 1);
  const tipX = xf.ox + joints[last] * xf.s;
  const tipY = xf.oy - joints[last + 1] * xf.s;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Trail: the exact reconstruction from t = 0 up to now (independent of earlier frames,
  // so seeking backwards or jumping anywhere draws the right thing).
  if (d.trail && scene.curve && t > 0) {
    const m = scene.curve.x.length;
    const end = Math.min(m, Math.floor(t * m));
    curvePath(ctx, scene.curve, end, xf);
    if (end < m) ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = d.trailColor;
    ctx.lineWidth = d.lineWidth;
    ctx.stroke();
  }

  if (d.circles) {
    const groups = d.directionColors ? [1, -1] : [0];
    for (const sign of groups) {
      for (let b = 0; b < CIRCLE_BUCKETS.length; b++) {
        const bucket = CIRCLE_BUCKETS[b];
        const upper = b === 0 ? Infinity : CIRCLE_BUCKETS[b - 1].minRadius;
        ctx.beginPath();
        let any = false;
        for (let i = 0; i < n; i++) {
          if (sign !== 0 && Math.sign(chain.k[i]) !== sign) continue;
          const r = chain.amplitude[i] * xf.s;
          if (r < bucket.minRadius || r >= upper) continue;
          const cx = xf.ox + joints[2 + 2 * i] * xf.s;
          const cy = xf.oy - joints[3 + 2 * i] * xf.s;
          ctx.moveTo(cx + r, cy);
          ctx.arc(cx, cy, r, 0, 2 * Math.PI);
          any = true;
        }
        if (!any) continue;
        ctx.globalAlpha = bucket.alpha;
        ctx.strokeStyle = sign > 0 ? COLORS.circlePositive : sign < 0 ? COLORS.circleNegative : COLORS.circle;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  if (d.arms) {
    // Fixed DC arm from the origin to the centroid.
    ctx.beginPath();
    ctx.moveTo(xf.ox, xf.oy);
    ctx.lineTo(xf.ox + joints[2] * xf.s, xf.oy - joints[3] * xf.s);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COLORS.dcArm;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(xf.ox - 4, xf.oy);
    ctx.lineTo(xf.ox + 4, xf.oy);
    ctx.moveTo(xf.ox, xf.oy - 4);
    ctx.lineTo(xf.ox, xf.oy + 4);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(xf.ox + joints[2] * xf.s, xf.oy - joints[3] * xf.s);
    for (let i = 0; i < n; i++) ctx.lineTo(xf.ox + joints[4 + 2 * i] * xf.s, xf.oy - joints[5 + 2 * i] * xf.s);
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = COLORS.arm;
    ctx.lineWidth = 1.25;
    ctx.stroke();

    // Centre dots on circles that are big enough to read.
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (chain.amplitude[i] * xf.s < 8) continue;
      const cx = xf.ox + joints[2 + 2 * i] * xf.s;
      const cy = xf.oy - joints[3 + 2 * i] * xf.s;
      ctx.moveTo(cx + 1.8, cy);
      ctx.arc(cx, cy, 1.8, 0, 2 * Math.PI);
    }
    ctx.fillStyle = COLORS.arm;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (scene.selectedK !== null) {
    const i = indexOfK(chain, scene.selectedK);
    if (i >= 0) {
      const cx = xf.ox + joints[2 + 2 * i] * xf.s;
      const cy = xf.oy - joints[3 + 2 * i] * xf.s;
      const ex = xf.ox + joints[4 + 2 * i] * xf.s;
      const ey = xf.oy - joints[5 + 2 * i] * xf.s;
      const r = chain.amplitude[i] * xf.s;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(r, 3), 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
      ctx.fill();
      ctx.strokeStyle = COLORS.selected;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
      ctx.fillStyle = COLORS.selected;
      ctx.fill();
    }
  }

  // Pen tip.
  ctx.beginPath();
  ctx.arc(tipX, tipY, 5.5, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(tipX, tipY, 4, 0, 2 * Math.PI);
  ctx.fillStyle = COLORS.tip;
  ctx.fill();

  return { joints, tipScreen: [tipX, tipY] };
}

export function indexOfK(chain: CompiledChain, k: number): number {
  for (let i = 0; i < chain.count; i++) if (chain.k[i] === k) return i;
  return -1;
}

/**
 * Circle under a screen point: the ring (or arm) closest to the pointer within `tolerance`
 * pixels. Larger circles win ties. Returns the frequency k, or null.
 */
export function hitTest(chain: CompiledChain, joints: Float64Array, frame: Frame, sx: number, sy: number, tolerance = 8): number | null {
  if (joints.length < jointBufferLength(chain)) return null;
  const xf = transformOf(frame);
  let best: number | null = null;
  let bestScore = tolerance;
  for (let i = 0; i < chain.count; i++) {
    const r = chain.amplitude[i] * xf.s;
    if (r < 2) continue;
    const cx = xf.ox + joints[2 + 2 * i] * xf.s;
    const cy = xf.oy - joints[3 + 2 * i] * xf.s;
    const ex = xf.ox + joints[4 + 2 * i] * xf.s;
    const ey = xf.oy - joints[5 + 2 * i] * xf.s;
    const ring = Math.abs(Math.hypot(sx - cx, sy - cy) - r);
    const arm = distanceToSegment(sx, sy, cx, cy, ex, ey);
    const score = Math.min(ring, arm);
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = chain.k[i];
    }
  }
  return best;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}

/**
 * Points whose bounding box frames the scene: the stroke, the reconstruction and the origin.
 * With `includeCircles` the first (largest, attached to the centre c₀) circle is framed too, so
 * it is not cut off at the edge of the canvas; image exports leave it out.
 */
export function sceneBounds(scene: SceneData, includeCircles = false): Vec2[] {
  const pts: Vec2[] = [];
  if (scene.stroke) pts.push(...scene.stroke);
  if (scene.curve) for (let i = 0; i < scene.curve.x.length; i += 4) pts.push([scene.curve.x[i], scene.curve.y[i]]);
  pts.push([0, 0]);
  const chain = scene.chain;
  if (includeCircles && chain && chain.count > 0) {
    const r = chain.amplitude[0];
    pts.push([chain.dcRe - r, chain.dcIm - r], [chain.dcRe + r, chain.dcIm + r]);
  }
  return pts;
}
