import { describe, expect, it } from 'vitest';
import { MAX_FRAME_SECONDS, Player, type Scheduler } from './player';
import { BASE_PERIOD_SECONDS, DEFAULT_SETTINGS, clampCircles } from './settings';
import { createProject, parseProject, serializeProject, validateProject } from './project';
import { DEFAULT_VIEW, boundsOf, drawingToWorld, fitView, panBy, screenToWorld, worldToDrawing, worldToScreen, zoomAt } from './view';
import type { Vec2 } from '../math/path';

/** Manual scheduler: frames run only when the test calls `frame(ms)`. */
function manualScheduler() {
  let pending: ((now: number) => void) | null = null;
  const s: Scheduler & { frame: (now: number) => void; active: () => boolean } = {
    request: (cb) => {
      pending = cb;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
    frame: (now) => {
      const cb = pending;
      pending = null;
      cb?.(now);
    },
    active: () => pending !== null,
  };
  return s;
}

describe('Player', () => {
  it('advances by real elapsed time × speed', () => {
    const sch = manualScheduler();
    const p = new Player({ speed: 2 }, sch);
    p.play();
    sch.frame(1000); // first frame only records the timestamp
    sch.frame(1050); // +50 ms
    expect(p.time).toBeCloseTo((0.05 * 2) / BASE_PERIOD_SECONDS, 12);
    // Same elapsed time split into more frames gives the same progress.
    const q = new Player({ speed: 2 }, sch);
    q.play();
    sch.frame(0);
    for (let t = 10; t <= 50; t += 10) sch.frame(t);
    expect(q.time).toBeCloseTo(p.time, 12);
  });

  it('clips long gaps (background tab) to one short step', () => {
    const sch = manualScheduler();
    const p = new Player({ speed: 1 }, sch);
    p.play();
    sch.frame(0);
    sch.frame(60_000);
    expect(p.time).toBeCloseTo(MAX_FRAME_SECONDS / BASE_PERIOD_SECONDS, 12);
  });

  it('loops, or stops at the end in one-shot mode', () => {
    const looping = new Player({ loop: true, speed: 1 }, manualScheduler());
    looping.seek(0.995);
    looping.advance(0.1);
    expect(looping.time).toBeCloseTo(0.005, 12);

    const sch = manualScheduler();
    const once = new Player({ loop: false, speed: 1 }, sch);
    once.play();
    once.seek(0.995);
    once.advance(0.1);
    expect(once.time).toBe(1);
    expect(once.getState().playing).toBe(false);
    expect(sch.active()).toBe(false); // no idle loop after stopping
    once.play(); // restarts from the beginning
    expect(once.time).toBe(0);
  });

  it('runs no animation loop while paused', () => {
    const sch = manualScheduler();
    const p = new Player({}, sch);
    p.play();
    expect(sch.active()).toBe(true);
    p.pause();
    expect(sch.active()).toBe(false);
  });

  it('seeks and steps (wrapping in loop mode), notifying frame listeners', () => {
    const p = new Player({ loop: true }, manualScheduler());
    const seen: number[] = [];
    p.onFrame((t) => seen.push(t));
    p.seek(1.5);
    expect(p.time).toBe(1);
    p.seek(Number.NaN);
    expect(p.time).toBe(0);
    p.step(-0.25);
    expect(p.time).toBeCloseTo(0.75, 12);
    expect(seen).toHaveLength(3);
  });

  it('restart(): a running player goes back to t = 0 and keeps playing', () => {
    const sch = manualScheduler();
    const p = new Player({ speed: 1 }, sch);
    p.play();
    sch.frame(0);
    sch.frame(100);
    p.seek(0.6);
    p.restart();
    expect(p.time).toBe(0);
    expect(p.getState().playing).toBe(true);
    expect(p.restarts).toBe(1);
    // The pre-restart timestamp is forgotten: the next frame starts the clock, it does not jump.
    sch.frame(5000);
    expect(p.time).toBe(0);
    sch.frame(5100);
    expect(p.time).toBeCloseTo(0.1 / BASE_PERIOD_SECONDS, 12);
  });

  it('restart(): a paused player stays paused on the first frame and notifies listeners', () => {
    const p = new Player({}, manualScheduler());
    const seen: number[] = [];
    p.onFrame((t) => seen.push(t));
    p.seek(0.8);
    p.restart();
    expect(p.time).toBe(0);
    expect(p.getState().playing).toBe(false);
    expect(seen).toEqual([0.8, 0]);
  });

  it('restart(): a finished one-shot run is re-armed, not stuck at t = 1', () => {
    const sch = manualScheduler();
    const p = new Player({ loop: false, speed: 5 }, sch);
    p.play();
    p.seek(0.99);
    p.advance(0.1);
    expect(p.time).toBe(1);
    expect(p.getState().playing).toBe(false);
    p.restart();
    expect(p.time).toBe(0);
    expect(p.getState().playing).toBe(false);
    p.play();
    expect(p.getState().playing).toBe(true);
    p.advance(0.05);
    expect(p.time).toBeGreaterThan(0);
    expect(p.time).toBeLessThan(0.1);
  });

  it('publishes state changes as new snapshots', () => {
    const p = new Player({}, manualScheduler());
    const a = p.getState();
    let calls = 0;
    p.subscribe(() => calls++);
    p.setSpeed(3);
    expect(p.getState()).not.toBe(a);
    expect(p.getState().speed).toBe(3);
    expect(calls).toBe(1);
  });
});

describe('view transforms', () => {
  const vp = { width: 800, height: 600 };

  it('round-trips world ↔ screen and flips y', () => {
    const view = { cx: 0.3, cy: -0.2, zoom: 2.5 };
    const [sx, sy] = worldToScreen(view, vp, 0.7, 0.4);
    const [x, y] = screenToWorld(view, vp, sx, sy);
    expect(x).toBeCloseTo(0.7, 12);
    expect(y).toBeCloseTo(0.4, 12);
    // Larger y is higher on screen.
    expect(worldToScreen(DEFAULT_VIEW, vp, 0, 1)[1]).toBeLessThan(worldToScreen(DEFAULT_VIEW, vp, 0, 0)[1]);
    expect(worldToScreen(DEFAULT_VIEW, vp, 0, 0)).toEqual([400, 300]);
  });

  it('zooms about the cursor and pans by screen deltas', () => {
    const before = screenToWorld(DEFAULT_VIEW, vp, 123, 456);
    const z = zoomAt(DEFAULT_VIEW, vp, 3, 123, 456);
    const after = screenToWorld(z, vp, 123, 456);
    expect(after[0]).toBeCloseTo(before[0], 12);
    expect(after[1]).toBeCloseTo(before[1], 12);
    const p = panBy(DEFAULT_VIEW, vp, 50, -20);
    const moved = worldToScreen(p, vp, 0, 0);
    expect(moved[0]).toBeCloseTo(450, 12);
    expect(moved[1]).toBeCloseTo(280, 12);
  });

  it('fits bounds inside the viewport', () => {
    const pts: Vec2[] = [
      [2, 3],
      [4, 3.5],
      [3, 5],
    ];
    const v = fitView(boundsOf(pts), vp);
    for (const [x, y] of pts) {
      const [sx, sy] = worldToScreen(v, vp, x, y);
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThanOrEqual(vp.width);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sy).toBeLessThanOrEqual(vp.height);
    }
    expect(fitView(null, vp)).toEqual(DEFAULT_VIEW);
  });

  it('keeps the reserved right strip free when fitting', () => {
    const pts: Vec2[] = [
      [-1, -0.5],
      [1, 0.5],
    ];
    const inset = 60;
    const v = fitView(boundsOf(pts), vp, 0.05, inset);
    for (const [x, y] of pts) {
      const [sx, sy] = worldToScreen(v, vp, x, y);
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThanOrEqual(vp.width - inset + 1e-9);
      expect(sy).toBeGreaterThanOrEqual(0);
      expect(sy).toBeLessThanOrEqual(vp.height);
    }
    // Centred in the usable strip, not in the whole canvas.
    expect(worldToScreen(v, vp, 0, 0)[0]).toBeCloseTo((vp.width - inset) / 2, 9);
  });

  it('maps the drawing canvas to [-1, 1] on its shorter side with y up', () => {
    const dv = { width: 400, height: 400 };
    expect(drawingToWorld(0, 0, dv)).toEqual([-1, 1]);
    expect(drawingToWorld(400, 400, dv)).toEqual([1, -1]);
    const [sx, sy] = worldToDrawing(0.25, -0.5, dv);
    expect(drawingToWorld(sx, sy, dv)).toEqual([0.25, -0.5]);
  });
});

describe('project files', () => {
  const path: Vec2[] = [
    [0, 0],
    [0.5, 0.25],
    [0.123456789, -0.5],
  ];

  it('round-trips through JSON', () => {
    const p = createProject(path, DEFAULT_SETTINGS, 'user', new Date('2026-01-01T00:00:00Z'));
    const r = parseProject(serializeProject(p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.settings).toEqual(DEFAULT_SETTINGS);
    expect(r.project.path[2]).toEqual([0.123457, -0.5]);
  });

  it('rejects malformed or out-of-range content with a readable message', () => {
    const good = createProject(path, DEFAULT_SETTINGS, 'user');
    const cases: [unknown, RegExp][] = [
      [null, /객체/],
      [{ ...good, format: 'other' }, /프로젝트 파일이 아닙니다/],
      [{ ...good, version: 2 }, /버전/],
      [{ ...good, path: [[0, 0]] }, /최소 2개/],
      [{ ...good, path: [[0, 0], [1, 'x']] }, /숫자/],
      [{ ...good, path: [[0, 0], [1e9, 0]] }, /범위/],
      [{ ...good, settings: { ...good.settings, sampleCount: 300 } }, /sampleCount/],
      [{ ...good, settings: { ...good.settings, circleCount: 5000 } }, /circleCount/],
      [{ ...good, settings: { ...good.settings, speed: 99 } }, /speed/],
      [{ ...good, settings: { ...good.settings, pathMode: 'zigzag' } }, /pathMode/],
      [{ ...good, settings: { ...good.settings, display: { trailColor: 'red;background:url(x)' } } }, /trailColor/],
    ];
    for (const [value, msg] of cases) {
      const r = validateProject(value);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(msg);
    }
    expect(parseProject('{not json')).toEqual({ ok: false, error: 'JSON 형식이 올바르지 않습니다.' });
  });

  it('fills optional display fields with defaults', () => {
    const p = createProject(path, DEFAULT_SETTINGS, 'user');
    const { display: _omit, ...settings } = p.settings;
    const r = validateProject({ ...p, settings });
    expect(r.ok && r.project.settings.display).toEqual(DEFAULT_SETTINGS.display);
  });

  it('clamps circle counts to the valid range', () => {
    expect(clampCircles(0, 256)).toBe(1);
    expect(clampCircles(9999, 256)).toBe(255);
  });
});
