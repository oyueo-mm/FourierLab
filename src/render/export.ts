// PNG export. "current" copies the two visible layers pixel for pixel; "original" and
// "reconstruction" re-render the shapes on a fresh square canvas, fitted so nothing is cut off.

import { boundsOf, fitView, pixelsPerUnit } from '../core/view';
import type { Vec2 } from '../math/path';
import { drawStaticLayer, sceneBounds, type Frame, type SceneData } from './scene';

export type ExportKind = 'original' | 'reconstruction' | 'current';

export const EXPORT_SIZE = 1600;

export interface ExportInfo {
  /** Caption printed in the corner, e.g. "K = 64 · N = 1024". */
  caption: string;
}

function fittedFrame(points: readonly Vec2[], size: number): Frame {
  const vp = { width: size, height: size };
  return { ...vp, view: fitView(boundsOf(points), vp, 0.1) };
}

function caption(ctx: CanvasRenderingContext2D, text: string, size: number) {
  ctx.font = `${Math.round(size / 55)}px ui-sans-serif, system-ui, "Segoe UI", "Malgun Gothic", sans-serif`;
  ctx.fillStyle = '#64748b';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, size * 0.03, size * 0.975);
}

export function renderExport(
  kind: ExportKind,
  scene: SceneData,
  info: ExportInfo,
  layers: { staticCanvas: HTMLCanvasElement; dynamicCanvas: HTMLCanvasElement } | null,
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  if (kind === 'current') {
    if (!layers) throw new Error('no canvas to export');
    out.width = layers.staticCanvas.width;
    out.height = layers.staticCanvas.height;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(layers.staticCanvas, 0, 0);
    ctx.drawImage(layers.dynamicCanvas, 0, 0);
    return out;
  }

  out.width = EXPORT_SIZE;
  out.height = EXPORT_SIZE;
  const ctx = out.getContext('2d')!;
  const pts = kind === 'original' ? (scene.stroke ?? []) : sceneBounds({ ...scene, stroke: null });
  const frame = fittedFrame(pts, EXPORT_SIZE);
  const s = pixelsPerUnit(frame.view, frame);
  const ox = frame.width / 2 - frame.view.cx * s;
  const oy = frame.height / 2 + frame.view.cy * s;
  const lineScale = EXPORT_SIZE / 800;

  drawStaticLayer(ctx, { ...scene, stroke: kind === 'original' ? null : scene.stroke, display: { ...scene.display, preview: false } }, frame);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (kind === 'original' && scene.stroke) {
    ctx.beginPath();
    scene.stroke.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * s, oy - y * s) : ctx.moveTo(ox + x * s, oy - y * s)));
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3 * lineScale;
    ctx.stroke();
  } else if (kind === 'reconstruction' && scene.curve) {
    const { x, y } = scene.curve;
    ctx.beginPath();
    ctx.moveTo(ox + x[0] * s, oy - y[0] * s);
    for (let i = 1; i <= x.length; i++) ctx.lineTo(ox + x[i % x.length] * s, oy - y[i % x.length] * s);
    ctx.strokeStyle = scene.display.trailColor;
    ctx.lineWidth = scene.display.lineWidth * lineScale;
    ctx.stroke();
  }
  caption(ctx, info.caption, EXPORT_SIZE);
  return out;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('PNG 생성에 실패했습니다.'));
      downloadBlob(blob, filename);
      resolve();
    }, 'image/png');
  });
}
