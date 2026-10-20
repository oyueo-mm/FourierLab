// The epicycle canvas. Two stacked canvases: a static layer (grid, original, preview) that
// repaints only when data or view change, and a dynamic layer (trail, circles, tip) that
// repaints on every player frame. Nothing here causes React re-renders per frame.

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
  const perfRef = useRef({ frames: 0, drawMs: 0, since: performance.now(), fps: 0, avgDrawMs: 0 });
  const statsRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(false);
  const [zoomLabel, setZoomLabel] = useState(1);

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
  const applyFollow = useCallback(
    (t: number) => {
      if (!followRef.current || !sceneRef.current.chain) return false;
      const chain = sceneRef.current.chain;
      const res = tipAt(chain, t, jointsRef);
      viewRef.current = { ...viewRef.current, cx: res[0], cy: res[1] };
      return true;
    },
    [],
  );

  const paintAll = useCallback(() => {
    applyFollow(player.time);
    paintStatic();
    paintDynamic(player.time);
  }, [applyFollow, paintStatic, paintDynamic, player]);

  const setView = useCallback(
    (v: View) => {
      viewRef.current = v;
      setZoomLabel(v.zoom);
      paintAll();
    },
    [paintAll],
  );

  const fit = useCallback(() => {
    const { width, height } = sizeRef.current;
    if (!width || !height) return;
    followRef.current = false;
    setFollow(false);
    setView(fitView(boundsOf(sceneBounds(sceneRef.current)), { width, height }, 0.06));
  }, [setView]);

  useImperativeHandle(
    ref,
    () => ({
      layers: () => (staticRef.current && dynamicRef.current ? { staticCanvas: staticRef.current, dynamicCanvas: dynamicRef.current } : null),
      fit,
    }),
    [fit],
  );

  // Size both canvases to the container (device pixels) and repaint in the same callback.
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
      paintAll();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [paintAll]);

  // New scene data: repaint both layers once (whether or not the player is running).
  useLayoutEffect(() => {
    sceneRef.current = scene;
    paintAll();
  }, [scene, paintAll]);

  // A newly analysed drawing starts from the default framing (same as the drawing canvas).
  useLayoutEffect(() => {
    followRef.current = false;
    setFollow(false);
    setView(DEFAULT_VIEW);
  }, [fitKey, setView]);

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

  // Drag to pan; a click without movement selects the circle under the pointer.
  const dragRef = useRef<{ id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < CLICK_SLOP_PX) return;
    if (!d.moved) {
      d.moved = true;
      followRef.current = false;
      setFollow(false);
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    setView(panBy(viewRef.current, sizeRef.current, dx, dy));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (d.moved) return;
    const chain = sceneRef.current.chain;
    const last = lastRef.current;
    if (!chain || !last) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onSelect(hitTest(chain, last.joints, frame(), e.clientX - rect.left, e.clientY - rect.top));
  };

  const zoomBy = (f: number) => setView(zoomAt(viewRef.current, sizeRef.current, f, sizeRef.current.width / 2, sizeRef.current.height / 2));

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-white">
      <div ref={wrapRef} className="absolute inset-0">
        <canvas ref={staticRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        <canvas
          ref={dynamicRef}
          data-testid="viz-canvas"
          role="img"
          aria-label="푸리에 에피사이클 애니메이션. 드래그로 이동, 휠로 확대, 원을 클릭하면 성분 정보가 표시됩니다."
          className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
          // Vertical swipes still scroll the page on touch screens; zoom has buttons.
          style={{ touchAction: 'pan-y' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (dragRef.current = null)}
        />
      </div>

      <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-3.5rem)] flex-wrap gap-1.5">{stats}</div>
      <div
        ref={statsRef}
        data-testid="perf-stats"
        className={`pointer-events-none absolute right-14 bottom-2 rounded bg-white/85 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 ${scene.display.stats ? '' : 'hidden'}`}
      />

      <div className="absolute top-2 right-2 flex flex-col gap-1.5">
        <IconButton label="확대" onClick={() => zoomBy(1.4)}>
          <ZoomInIcon />
        </IconButton>
        <IconButton label="축소" onClick={() => zoomBy(1 / 1.4)}>
          <ZoomOutIcon />
        </IconButton>
        <IconButton label="화면 맞춤" onClick={fit}>
          <FitIcon />
        </IconButton>
        <IconButton
          label="원점 복귀 (기본 보기)"
          onClick={() => {
            followRef.current = false;
            setFollow(false);
            setView(DEFAULT_VIEW);
          }}
        >
          <OriginIcon />
        </IconButton>
        <IconButton
          label="끝점 따라가기"
          active={follow}
          onClick={() => {
            const next = !followRef.current;
            followRef.current = next;
            setFollow(next);
            // Following is most useful zoomed in on the small circles near the tip.
            if (next && viewRef.current.zoom < 4) viewRef.current = { ...viewRef.current, zoom: 6 };
            setZoomLabel(viewRef.current.zoom);
            paintAll();
          }}
        >
          <TargetIcon />
        </IconButton>
        <span className="rounded bg-white/85 px-1 text-center font-mono text-[10px] text-slate-500 tabular" aria-label="확대 배율">
          ×{zoomLabel < 10 ? zoomLabel.toFixed(1) : zoomLabel.toFixed(0)}
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
