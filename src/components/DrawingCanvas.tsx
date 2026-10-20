// Drawing input: one continuous stroke via Pointer Events (mouse, touch and pen share one
// code path). Points are stored in the math frame, so the drawing survives resizes and the
// analysis never sees screen pixels.

import { useCallback, useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { drawingToWorld, worldToDrawing, type Viewport } from '../core/view';
import { MAX_INPUT_POINTS, type PathMode, type Vec2 } from '../math/path';
import { COLORS, joinSegment } from '../render/scene';

/** New points closer than this many CSS pixels to the previous one are skipped. */
const MIN_STEP_PX = 0.75;

export interface StrokeEvent {
  points: Vec2[];
  /** The stroke was ended because it reached MAX_INPUT_POINTS. */
  truncated: boolean;
}

interface Props {
  points: readonly Vec2[] | null;
  mode: PathMode;
  onStrokeStart: () => void;
  onStrokeEnd: (e: StrokeEvent) => void;
  onStrokeCancel: () => void;
}

export function DrawingCanvas({ points, mode, onStrokeStart, onStrokeEnd, onStrokeCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef<Viewport & { dpr: number }>({ width: 0, height: 0, dpr: 1 });
  const liveRef = useRef<{ id: number; pts: Vec2[] } | null>(null);
  const frameRef = useRef<number | null>(null);
  const propsRef = useRef({ points, mode });
  propsRef.current = { points, mode };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const { width, height, dpr } = sizeRef.current;
    if (!canvas || !width || !height) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    const vp = { width, height };
    const toScreen = (p: Vec2) => worldToDrawing(p[0], p[1], vp);

    // Quarter-unit grid and axes, so the origin used by the analysis is visible.
    ctx.lineWidth = 1;
    ctx.beginPath();
    const half = Math.min(width, height) / 2;
    for (let i = -8; i <= 8; i++) {
      if (i === 0) continue;
      const x = Math.round(width / 2 + (i / 4) * half) + 0.5;
      const y = Math.round(height / 2 + (i / 4) * half) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.strokeStyle = COLORS.gridMinor;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(Math.round(width / 2) + 0.5, 0);
    ctx.lineTo(Math.round(width / 2) + 0.5, height);
    ctx.moveTo(0, Math.round(height / 2) + 0.5);
    ctx.lineTo(width, Math.round(height / 2) + 0.5);
    ctx.strokeStyle = COLORS.gridMajor;
    ctx.stroke();

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const live = liveRef.current;
    const { points: pts, mode: m } = propsRef.current;
    const shown = live ? live.pts : pts;
    if (!shown || shown.length === 0) return;

    if (!live && pts && pts.length > 1) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      const join = joinSegment({ stroke: pts, mode: m, endGap: Math.hypot(last[0] - first[0], last[1] - first[1]) });
      if (join) {
        const [a, b] = join.map(toScreen);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = m === 'open' ? COLORS.joinOpen : COLORS.joinClosed;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    ctx.beginPath();
    shown.forEach((p, i) => {
      const [x, y] = toScreen(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = live ? COLORS.circlePositive : '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Start marker and a direction arrow a little way along the stroke.
    const [sx, sy] = toScreen(shown[0]);
    if (!live && shown.length > 2) {
      const total = shown.length;
      const a = toScreen(shown[Math.min(total - 1, Math.floor(total * 0.04))]);
      const b = toScreen(shown[Math.min(total - 1, Math.floor(total * 0.04) + Math.max(1, Math.floor(total * 0.01)))]);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (Number.isFinite(ang) && (a[0] !== b[0] || a[1] !== b[1])) {
        ctx.beginPath();
        ctx.moveTo(b[0] + 7 * Math.cos(ang), b[1] + 7 * Math.sin(ang));
        ctx.lineTo(b[0] + 7 * Math.cos(ang + 2.5), b[1] + 7 * Math.sin(ang + 2.5));
        ctx.lineTo(b[0] + 7 * Math.cos(ang - 2.5), b[1] + 7 * Math.sin(ang - 2.5));
        ctx.closePath();
        ctx.fillStyle = '#059669';
        ctx.fill();
      }
    }
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#059669';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, []);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      draw();
    });
  }, [draw]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      sizeRef.current = { width, height, dpr };
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      draw(); // repaint in the same frame so a resize never shows a cleared canvas
    });
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [draw]);

  useEffect(() => draw(), [points, mode, draw]);

  const toWorld = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return drawingToWorld(e.clientX - rect.left, e.clientY - rect.top, sizeRef.current);
  };

  const finish = (truncated: boolean) => {
    const live = liveRef.current;
    if (!live) return;
    liveRef.current = null;
    try {
      canvasRef.current?.releasePointerCapture(live.id);
    } catch {
      /* capture already gone */
    }
    onStrokeEnd({ points: live.pts, truncated });
    draw();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (liveRef.current) return; // one stroke at a time (ignore a second finger)
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events cannot be captured */
    }
    liveRef.current = { id: e.pointerId, pts: [toWorld(e)] };
    onStrokeStart();
    scheduleDraw();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const live = liveRef.current;
    if (!live || e.pointerId !== live.id) return;
    const native = e.nativeEvent;
    // Coalesced events recover the intermediate positions of fast drags where supported.
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const minStep = MIN_STEP_PX / (Math.min(sizeRef.current.width, sizeRef.current.height) / 2 || 1);
    for (const ev of events.length ? events : [native]) {
      const p = toWorld(ev);
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      const last = live.pts[live.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < minStep) continue;
      live.pts.push(p);
      if (live.pts.length >= MAX_INPUT_POINTS) {
        finish(true);
        return;
      }
    }
    scheduleDraw();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const live = liveRef.current;
    if (!live || e.pointerId !== live.id) return;
    const p = toWorld(e);
    const last = live.pts[live.pts.length - 1];
    if (Number.isFinite(p[0]) && Number.isFinite(p[1]) && (p[0] !== last[0] || p[1] !== last[1])) live.pts.push(p);
    finish(false);
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const live = liveRef.current;
    if (!live || e.pointerId !== live.id) return;
    liveRef.current = null;
    onStrokeCancel();
    draw();
  };

  return (
    <canvas
      ref={canvasRef}
      data-testid="drawing-canvas"
      aria-label="그림 입력 캔버스: 마우스나 손가락으로 한 번에 이어지는 선을 그리세요"
      className="block h-full w-full cursor-crosshair"
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={(e) => {
        // Capture lost without pointerup (e.g. element hidden): keep what was drawn.
        if (liveRef.current && e.pointerId === liveRef.current.id) finish(false);
      }}
    />
  );
}
