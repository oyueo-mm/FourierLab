// World (math frame, y up) ↔ screen (CSS pixels, y down) transforms for the visualiser.
//
//   sx = w/2 + (x - cx)·s,   sy = h/2 - (y - cy)·s,   s = zoom · min(w, h) / (2·FRAME_HALF)
//
// At zoom 1 centred on the origin the visualiser shows the same [-1, 1]² square as the
// drawing canvas (plus a margin), so both panels line up.

import type { Vec2 } from '../math/path';

export const FRAME_HALF = 1.15;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 400;

export interface View {
  /** World point at the centre of the canvas. */
  cx: number;
  cy: number;
  zoom: number;
}

export const DEFAULT_VIEW: View = { cx: 0, cy: 0, zoom: 1 };

export interface Viewport {
  width: number;
  height: number;
}

export const pixelsPerUnit = (view: View, vp: Viewport): number =>
  (view.zoom * Math.min(vp.width, vp.height)) / (2 * FRAME_HALF);

export function worldToScreen(view: View, vp: Viewport, x: number, y: number): Vec2 {
  const s = pixelsPerUnit(view, vp);
  return [vp.width / 2 + (x - view.cx) * s, vp.height / 2 - (y - view.cy) * s];
}

export function screenToWorld(view: View, vp: Viewport, sx: number, sy: number): Vec2 {
  const s = pixelsPerUnit(view, vp);
  return [view.cx + (sx - vp.width / 2) / s, view.cy - (sy - vp.height / 2) / s];
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Zooms by `factor`, keeping the world point under (sx, sy) fixed on screen. */
export function zoomAt(view: View, vp: Viewport, factor: number, sx: number, sy: number): View {
  const zoom = clampZoom(view.zoom * factor);
  const [wx, wy] = screenToWorld(view, vp, sx, sy);
  const s = pixelsPerUnit({ ...view, zoom }, vp);
  return { zoom, cx: wx - (sx - vp.width / 2) / s, cy: wy + (sy - vp.height / 2) / s };
}

/** Pans by a screen-space drag of (dx, dy) CSS pixels. */
export function panBy(view: View, vp: Viewport, dx: number, dy: number): View {
  const s = pixelsPerUnit(view, vp);
  return { ...view, cx: view.cx - dx / s, cy: view.cy + dy / s };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Iterable<Vec2>): Bounds | null {
  let b: Bounds | null = null;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!b) b = { minX: x, minY: y, maxX: x, maxY: y };
    else {
      b.minX = Math.min(b.minX, x);
      b.minY = Math.min(b.minY, y);
      b.maxX = Math.max(b.maxX, x);
      b.maxY = Math.max(b.maxY, y);
    }
  }
  return b;
}

/**
 * View that fits `bounds` with a relative margin. `insetRight` reserves a strip on the right
 * (CSS pixels) that stays empty, e.g. for the zoom buttons floating over the canvas.
 */
export function fitView(bounds: Bounds | null, vp: Viewport, margin = 0.08, insetRight = 0): View {
  if (!bounds) return DEFAULT_VIEW;
  const w = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const h = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const base = Math.min(vp.width, vp.height) / (2 * FRAME_HALF);
  const usableWidth = Math.max(vp.width - insetRight, 1);
  const scale = Math.min(usableWidth / w, vp.height / h) * (1 - 2 * margin);
  // The bounds' centre goes to the middle of the usable strip, i.e. insetRight/2 left of the canvas centre.
  return {
    cx: (bounds.minX + bounds.maxX) / 2 + insetRight / (2 * scale),
    cy: (bounds.minY + bounds.maxY) / 2,
    zoom: clampZoom(scale / base),
  };
}

/** Drawing canvas: square-ish frame where the shorter side spans [-1, 1]. */
export function drawingToWorld(sx: number, sy: number, vp: Viewport): Vec2 {
  const half = Math.min(vp.width, vp.height) / 2;
  return [(sx - vp.width / 2) / half, -(sy - vp.height / 2) / half];
}

export function worldToDrawing(x: number, y: number, vp: Viewport): Vec2 {
  const half = Math.min(vp.width, vp.height) / 2;
  return [vp.width / 2 + x * half, vp.height / 2 - y * half];
}
