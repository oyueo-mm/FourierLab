// The epicycle canvas. Two stacked canvases: a static layer (grid, original, preview) that
// repaints only when data or view change, and a dynamic layer (trail, circles, tip) that
// repaints on every player frame. Nothing here causes React re-renders per frame.
//
// Gestures (Pointer Events, so mouse, touch and pen share one path):
//   one pointer  → drag pans, a click without movement selects the circle under it
//   two pointers → pinch zooms about the midpoint, moving the midpoint pans
//   wheel        → zoom about the cursor
// The canvas uses `touch-action: none`; the page scrolls from everywhere else.

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { registerDebug } from '../core/debug';
import type { Player } from '../core/player';
import { evaluateChain, type CompiledChain } from '../math/epicycles';
import { DEFAULT_VIEW, boundsOf, fitView, panBy, pixelsPerUnit, zoomAt, type View } from '../core/view';
import { drawDynamicLayer, drawStaticLayer, hitTest, sceneBounds, type DynamicResult, type Frame, type SceneData } from '../render/scene';
import { FitIcon, OriginIcon, TargetIcon, ZoomInIcon, ZoomOutIcon } from './icons';
import { IconButton } from './ui';

export interface VisualizerHandle {
  layers: () => { staticCanvas: HTMLCanvasElement; dynamicCanvas: HTMLCanvasElement } | null;
  fit: () => void;
}

interface Props {
  scene: SceneData;
  player: Player;
  /** Changes when a new drawing is analysed: the view is re-fitted. */
  fitKey: string;
  onSelect: (k: number | null) => void;
  overlay?: ReactNode;
  stats: ReactNode;
  ref?: Ref<VisualizerHandle>;
}

const CLICK_SLOP_PX = 5;

const zoomText = (z: number) => `×${z < 10 ? z.toFixed(1) : z.toFixed(0)}`;

interface Pt {
  x: number;
  y: number;
}

export function Visualizer({ scene, player, fitKey, onSelect, overlay, stats, ref }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const dynamicRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const viewRef = useRef<View>(DEFAULT_VIEW);
  const sceneRef = useRef(scene);
  const jointsRef = useRef<Float64Array>(new Float64Array(0));
  const lastRef = useRef<DynamicResult | null>(null);
  const followRef = useRef(false);
  // A fit was requested before the canvas had a size (first paint, hidden parent): do it once it has.
  const needsFitRef = useRef(true);
  const perfRef = useRef({ frames: 0, drawMs: 0, since: performance.now(), fps: 0, avgDrawMs: 0 });
  const statsRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(false);
  const [zoomLabel, setZoomLabel] = useState(zoomText(1));

  const frame = useCallback((): Frame => ({ ...sizeRef.current, view: viewRef.current }), []);

  const paintStatic = useCallback(() => {
    const ctx = staticRef.current?.getContext('2d');
    const { width, height, dpr } = sizeRef.current;
    if (!ctx || !width || !height) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStaticLayer(ctx, sceneRef.current, frame());
  }, [frame]);

  const paintDynamic = useCallback(
    (t: number) => {
      const ctx = dynamicRef.current?.getContext('2d');
      const { width, height, dpr } = sizeRef.current;
      if (!ctx || !width || !height) return;
      const start = performance.now();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const chain = sceneRef.current.chain;
      if (chain && jointsRef.current.length < 2 * (chain.count + 2)) jointsRef.current = new Float64Array(2 * (chain.count + 2));
      lastRef.current = drawDynamicLayer(ctx, sceneRef.current, frame(), t, jointsRef.current);

      const perf = perfRef.current;
      perf.frames++;
      perf.drawMs += performance.now() - start;
      const now = performance.now();
      if (now - perf.since >= 500) {
        perf.fps = (perf.frames * 1000) / (now - perf.since);
        perf.avgDrawMs = perf.drawMs / perf.frames;
        perf.frames = 0;
        perf.drawMs = 0;
        perf.since = now;
        if (statsRef.current) statsRef.current.textContent = `${perf.fps.toFixed(0)} fps · 그리기 ${perf.avgDrawMs.toFixed(2)} ms`;
      }
    },
    [frame],
  );

  /** Follow mode: centre the view on the pen tip at time t (before painting). */
  const applyFollow = useCallback((t: number) => {
    if (!followRef.current || !sceneRef.current.chain) return false;
    const res = tipAt(sceneRef.current.chain, t, jointsRef);
    viewRef.current = { ...viewRef.current, cx: res[0], cy: res[1] };
    return true;
  }, []);

  const paintAll = useCallback(() => {
    applyFollow(player.time);
    paintStatic();
    paintDynamic(player.time);
  }, [applyFollow, paintStatic, paintDynamic, player]);

  const setView = useCallback(
    (v: View) => {
      viewRef.current = v;
      setZoomLabel(zoomText(v.zoom));
      paintAll();
    },
    [paintAll],
  );

  const stopFollow = useCallback(() => {
    followRef.current = false;
    setFollow(false);
  }, []);

  /** Fits everything the animation can show; returns false while the canvas has no size yet. */
  const fitNow = useCallback(() => {
    const { width, height } = sizeRef.current;
    if (!width || !height) return false;
    needsFitRef.current = false;
    stopFollow();
    // Keep clear of the zoom buttons on the right edge.
    setView(fitView(boundsOf(sceneBounds(sceneRef.current, true)), { width, height }, 0.06, Math.min(56, width * 0.18)));
    return true;
  }, [setView, stopFollow]);

  const fit = useCallback(() => {
    needsFitRef.current = true;
    fitNow();
  }, [fitNow]);

  useImperativeHandle(
    ref,
    () => ({
      layers: () => (staticRef.current && dynamicRef.current ? { staticCanvas: staticRef.current, dynamicCanvas: dynamicRef.current } : null),
      fit,
    }),
    [fit],
  );

  // Size both canvases to the container (device pixels) and repaint in the same callback, so a
  // resize never leaves a cleared (black/transparent) canvas on screen.
  useLayoutEffect(() => {
    const wrap = wrapRef.current!;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      sizeRef.current = { width, height, dpr };
      for (const c of [staticRef.current, dynamicRef.current]) {
        if (!c) continue;
        c.width = Math.max(1, Math.round(width * dpr));
        c.height = Math.max(1, Math.round(height * dpr));
      }
      if (!(needsFitRef.current && fitNow())) paintAll();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [paintAll, fitNow]);

  // New scene data: repaint both layers once (whether or not the player is running).
  useLayoutEffect(() => {
    sceneRef.current = scene;
    paintAll();
  }, [scene, paintAll]);

  // A newly applied drawing is framed to fit the (now much larger, non-square) canvas.
  useLayoutEffect(() => {
    needsFitRef.current = true;
    fitNow();
  }, [fitKey, fitNow]);

  // Player frames → dynamic layer only (plus static when following the tip).
  useEffect(
    () =>
      player.onFrame((t) => {
        if (applyFollow(t)) paintStatic();
        paintDynamic(t);
      }),
    [player, applyFollow, paintStatic, paintDynamic],
  );

  useEffect(
    () =>
      registerDebug('viz', () => {
        const last = lastRef.current;
        const { width, height } = sizeRef.current;
        return {
          canvas: { width, height },
          view: { ...viewRef.current, pixelsPerUnit: pixelsPerUnit(viewRef.current, { width, height }) },
          tipScreen: last?.tipScreen ?? null,
          fps: perfRef.current.fps,
          avgDrawMs: perfRef.current.avgDrawMs,
        };
      }),
    [],
  );

  // Wheel zoom about the cursor (non-passive so the page does not scroll).
  useEffect(() => {
    const el = dynamicRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      const sx = followRef.current ? rect.width / 2 : e.clientX - rect.left;
      const sy = followRef.current ? rect.height / 2 : e.clientY - rect.top;
      setView(zoomAt(viewRef.current, sizeRef.current, factor, sx, sy));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setView]);

  // ── pointer gestures ──
  const pointers = useRef(new Map<number, Pt>());
  // `moved` stays true once a drag or pinch happened, so releasing never counts as a click.
  const gesture = useRef<{ startX: number; startY: number; moved: boolean; pinch: { dist: number; mx: number; my: number } | null } | null>(null);

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = dynamicRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const firstTwo = (): [Pt, Pt] => {
    const it = pointers.current.values();
    return [it.next().value as Pt, it.next().value as Pt];
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers cannot be captured */
    }
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 1) {
      gesture.current = { startX: e.clientX, startY: e.clientY, moved: false, pinch: null };
    } else if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = firstTwo();
      gesture.current.moved = true;
      gesture.current.pinch = { dist: Math.hypot(b.x - a.x, b.y - a.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    const prev = pointers.current.get(e.pointerId);
    if (!g || !prev) return;
    const cur = local(e);
    pointers.current.set(e.pointerId, cur);

    if (pointers.current.size >= 2 && g.pinch) {
      const [a, b] = firstTwo();
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const vp = sizeRef.current;
      let view = viewRef.current;
      if (g.pinch.dist > 1 && dist > 1) {
        // Following the pen tip keeps the view centred on it, so zoom about the centre then.
        const zx = followRef.current ? vp.width / 2 : mx;
        const zy = followRef.current ? vp.height / 2 : my;
        view = zoomAt(view, vp, dist / g.pinch.dist, zx, zy);
      }
      if (!followRef.current) view = panBy(view, vp, mx - g.pinch.mx, my - g.pinch.my);
      g.pinch = { dist, mx, my };
      setView(view);
      return;
    }

    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < CLICK_SLOP_PX) return;
    if (!g.moved) {
      g.moved = true;
      stopFollow();
    }
    setView(panBy(viewRef.current, sizeRef.current, cur.x - prev.x, cur.y - prev.y));
  };

  const endPointer = (e: ReactPointerEvent<HTMLCanvasElement>, isUp: boolean) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (pointers.current.size > 0) {
      g.pinch = null; // one finger stays down: carry on as a pan from where it is
      return;
    }
    gesture.current = null;
    if (!isUp || g.moved) return;
    const chain = sceneRef.current.chain;
    const last = lastRef.current;
    if (!chain || !last) return;
    const p = local(e);
    onSelect(hitTest(chain, last.joints, frame(), p.x, p.y));
  };

  const zoomBy = (f: number) => setView(zoomAt(viewRef.current, sizeRef.current, f, sizeRef.current.width / 2, sizeRef.current.height / 2));

  return (
    <div className="absolute inset-0 overflow-hidden rounded-xl bg-white">
      <div ref={wrapRef} className="absolute inset-0">
        <canvas ref={staticRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        <canvas
          ref={dynamicRef}
          data-testid="viz-canvas"
          role="img"
          aria-label="푸리에 에피사이클 애니메이션. 드래그로 이동, 두 손가락 또는 휠로 확대·축소, 원을 누르면 성분 정보가 표시됩니다."
          className="no-select absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endPointer(e, true)}
          onPointerCancel={(e) => endPointer(e, false)}
        />
      </div>

      <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-3.75rem)] flex-wrap items-start gap-1.5 sm:max-w-[calc(100%-4rem)]">{stats}</div>
      <div
        ref={statsRef}
        data-testid="perf-stats"
        className={`pointer-events-none absolute right-14 bottom-2 rounded bg-white/85 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 ${scene.display.stats ? '' : 'hidden'}`}
      />

      <div className="absolute top-2 right-2 flex flex-col gap-1.5">
        <IconButton label="확대" className="bg-white/90" onClick={() => zoomBy(1.4)}>
          <ZoomInIcon />
        </IconButton>
        <IconButton label="축소" className="bg-white/90" onClick={() => zoomBy(1 / 1.4)}>
          <ZoomOutIcon />
        </IconButton>
        <IconButton label="화면 맞춤" className="bg-white/90" onClick={fit}>
          <FitIcon />
        </IconButton>
        <IconButton
          label="원점 복귀 (기본 보기)"
          className="bg-white/90"
          onClick={() => {
            stopFollow();
            setView(DEFAULT_VIEW);
          }}
        >
          <OriginIcon />
        </IconButton>
        <IconButton
          label="끝점 따라가기"
          active={follow}
          className={follow ? '' : 'bg-white/90'}
          onClick={() => {
            const next = !followRef.current;
            followRef.current = next;
            setFollow(next);
            // Following is most useful zoomed in on the small circles near the tip.
            if (next && viewRef.current.zoom < 4) viewRef.current = { ...viewRef.current, zoom: 6 };
            setZoomLabel(zoomText(viewRef.current.zoom));
            paintAll();
          }}
        >
          <TargetIcon />
        </IconButton>
        <span className="rounded bg-white/85 px-1 text-center font-mono text-[10px] text-slate-500 tabular" aria-label="확대 배율" data-testid="zoom-label">
          {zoomLabel}
        </span>
      </div>

      {overlay && <div className="absolute bottom-2 left-2 max-w-[min(20rem,calc(100%-4rem))]">{overlay}</div>}
    </div>
  );
}

/** Tip position at t using the shared joints buffer (no drawing). */
function tipAt(chain: CompiledChain, t: number, buf: { current: Float64Array }): [number, number] {
  if (buf.current.length < 2 * (chain.count + 2)) buf.current = new Float64Array(2 * (chain.count + 2));
  const j = evaluateChain(chain, t, buf.current);
  const last = 2 * (chain.count + 1);
  return [j[last], j[last + 1]];
}
