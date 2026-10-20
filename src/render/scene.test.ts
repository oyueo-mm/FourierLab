// Geometry checks for the renderer that do not need a real canvas: a recording context
// captures the arcs/lines so we can verify that what is drawn matches the math module.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/settings';
import { worldToScreen } from '../core/view';
import { chainTip, compileChain } from '../math/epicycles';
import { computeSpectrum } from '../math/fourier';
import { preparePath } from '../math/path';
import { PRESETS } from '../math/presets';
import { curveResolution, evaluateSeries } from '../math/reconstruct';
import { rankComponents, selectComponents } from '../math/selection';
import { drawDynamicLayer, hitTest, joinSegment, type Frame, type SceneData } from './scene';

type Call = { op: string; args: number[] };

function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        return (...args: number[]) => calls.push({ op: prop, args });
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function heartScene(k: number): SceneData {
  const preset = PRESETS.find((p) => p.id === 'heart')!;
  const prepared = preparePath(preset.points, 'closed', 512);
  if (!prepared.ok) throw new Error('expected ok');
  const s = computeSpectrum(prepared.path.samples);
  const sel = selectComponents(s, rankComponents(s, 'amplitude'), k, 'amplitude');
  return {
    stroke: prepared.path.stroke,
    mode: 'closed',
    endGap: prepared.path.endGap,
    curve: evaluateSeries([sel.dc, ...sel.chain], curveResolution(512)),
    chain: compileChain(sel),
    selectedK: null,
    display: DEFAULT_SETTINGS.display,
  };
}

const frame: Frame = { width: 900, height: 700, view: { cx: 0.1, cy: -0.05, zoom: 1.7 } };

describe('drawDynamicLayer', () => {
  it('draws the pen tip exactly at the math tip ẑ(t), in screen space', () => {
    const scene = heartScene(30);
    for (const t of [0, 0.137, 0.5, 0.9999, 1]) {
      const { ctx, calls } = recordingContext();
      const res = drawDynamicLayer(ctx, scene, frame, t)!;
      const [wx, wy] = chainTip(scene.chain!, t);
      const [sx, sy] = worldToScreen(frame.view, frame, wx, wy);
      expect(res.tipScreen[0]).toBeCloseTo(sx, 9);
      expect(res.tipScreen[1]).toBeCloseTo(sy, 9);
      // The last arc drawn is the tip dot, centred on that point.
      const arcs = calls.filter((c) => c.op === 'arc');
      const tipArc = arcs[arcs.length - 1];
      expect(tipArc.args[0]).toBeCloseTo(sx, 9);
      expect(tipArc.args[1]).toBeCloseTo(sy, 9);
    }
  });

  it('the trail ends at the pen tip (no gap between curve and epicycles)', () => {
    const scene = heartScene(12);
    const t = 0.4321;
    const { ctx, calls } = recordingContext();
    const res = drawDynamicLayer(ctx, scene, frame, t)!;
    // First stroke() closes the trail path; the lineTo just before it is the tip.
    const firstStroke = calls.findIndex((c) => c.op === 'stroke');
    const lastLine = calls.slice(0, firstStroke).filter((c) => c.op === 'lineTo').pop()!;
    expect(lastLine.args[0]).toBeCloseTo(res.tipScreen[0], 9);
    expect(lastLine.args[1]).toBeCloseTo(res.tipScreen[1], 9);
  });

  it('skips circles too small to see but still chains every arm', () => {
    const scene = heartScene(511);
    const { ctx, calls } = recordingContext();
    drawDynamicLayer(ctx, { ...scene, display: { ...scene.display, circles: true, arms: true } }, frame, 0.3);
    const circleArcs = calls.filter((c) => c.op === 'arc' && c.args[2] > 3); // radius > 3px: real circles
    expect(circleArcs.length).toBeLessThan(511);
    const lineTos = calls.filter((c) => c.op === 'lineTo').length;
    expect(lineTos).toBeGreaterThanOrEqual(511);
  });
});

describe('hitTest', () => {
  it('finds the circle whose ring is under the pointer', () => {
    const scene = heartScene(8);
    const res = drawDynamicLayer(recordingContext().ctx, scene, frame, 0.2)!;
    const chain = scene.chain!;
    const i = 0; // largest circle in amplitude chain order
    const [cx, cy] = worldToScreen(frame.view, frame, res.joints[2], res.joints[3]);
    // A point on the ring of circle i, opposite its arm.
    const [ex, ey] = worldToScreen(frame.view, frame, res.joints[4], res.joints[5]);
    const px = cx - (ex - cx);
    const py = cy - (ey - cy);
    expect(hitTest(chain, res.joints, frame, px, py)).toBe(chain.k[i]);
    expect(hitTest(chain, res.joints, frame, -500, -500)).toBeNull();
  });
});

describe('joinSegment', () => {
  it('is shown for closed/open strokes with a gap and never for retrace', () => {
    const stroke: [number, number][] = [
      [0, 0],
      [1, 0],
    ];
    expect(joinSegment({ stroke, mode: 'closed', endGap: 1 })).toEqual([
      [1, 0],
      [0, 0],
    ]);
    expect(joinSegment({ stroke, mode: 'open', endGap: 1 })).not.toBeNull();
    expect(joinSegment({ stroke, mode: 'retrace', endGap: 1 })).toBeNull();
    expect(joinSegment({ stroke, mode: 'closed', endGap: 0 })).toBeNull();
  });
});
