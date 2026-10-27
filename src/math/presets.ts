// Built-in example paths, generated in the math frame (y up, drawing canvas = [-1, 1]²).
// Closed shapes repeat their first point at the end so that "closed" mode adds no extra
// joining segment; the spiral is deliberately open to show how the ends get connected.

import type { PathMode, Vec2 } from './path';

export type PresetId = 'circle' | 'ellipse' | 'square' | 'triangle' | 'star' | 'heart' | 'infinity' | 'rose' | 'spiral';

export interface Preset {
  id: PresetId;
  name: string;
  /** Path mode applied when the preset is loaded. */
  mode: PathMode;
  points: Vec2[];
}

function parametric(steps: number, f: (u: number) => Vec2, closed = true): Vec2[] {
  const pts: Vec2[] = [];
  const last = closed ? steps : steps - 1;
  for (let i = 0; i <= last; i++) pts.push(f(i / (closed ? steps : steps - 1)));
  if (closed) pts[pts.length - 1] = pts[0]; // exact closure, no rounding gap
  return pts;
}

function polygon(vertices: Vec2[]): Vec2[] {
  return [...vertices, vertices[0]];
}

const TAU = 2 * Math.PI;

function star(points: number, outer: number, inner: number): Vec2[] {
  const v: Vec2[] = [];
  for (let i = 0; i < 2 * points; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i * Math.PI) / points;
    v.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return polygon(v);
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'heart',
    name: '하트',
    mode: 'closed',
    points: parametric(720, (u) => {
      const t = TAU * u;
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      return [x / 21, y / 21 + 0.1];
    }),
  },
  {
    id: 'circle',
    name: '원',
    mode: 'closed',
    points: parametric(360, (u) => [0.7 * Math.cos(TAU * u), 0.7 * Math.sin(TAU * u)]),
  },
  {
    id: 'ellipse',
    name: '타원',
    mode: 'closed',
    points: parametric(360, (u) => [0.8 * Math.cos(TAU * u), 0.45 * Math.sin(TAU * u)]),
  },
  {
    id: 'square',
    name: '정사각형',
    mode: 'closed',
    points: polygon([
      [-0.62, -0.62],
      [0.62, -0.62],
      [0.62, 0.62],
      [-0.62, 0.62],
    ]),
  },
  {
    id: 'triangle',
    name: '삼각형',
    mode: 'closed',
    points: polygon([0, 1, 2].map((i): Vec2 => {
      const a = Math.PI / 2 + (i * TAU) / 3;
      return [0.78 * Math.cos(a), 0.78 * Math.sin(a) - 0.12];
    })),
  },
  { id: 'star', name: '별', mode: 'closed', points: star(5, 0.82, 0.34) },
  {
    id: 'infinity',
    name: '무한대',
    mode: 'closed',
    points: parametric(720, (u) => {
      const t = TAU * u;
      const d = 1 + Math.sin(t) ** 2;
      return [(0.88 * Math.cos(t)) / d, (0.88 * Math.sin(t) * Math.cos(t)) / d];
    }),
  },
  {
    id: 'rose',
    name: '장미 곡선',
    mode: 'closed',
    points: parametric(900, (u) => {
      const t = Math.PI * u;
      const r = 0.8 * Math.cos(3 * t);
      return [r * Math.cos(t), r * Math.sin(t)];
    }),
  },
  {
    id: 'spiral',
    name: '나선',
    mode: 'closed',
    points: parametric(
      900,
      (u) => {
        const t = 6 * Math.PI * u;
        const r = 0.06 + (0.74 * t) / (6 * Math.PI);
        return [r * Math.cos(t), r * Math.sin(t)];
      },
      false,
    ),
  },
];

export const DEFAULT_PRESET: PresetId = 'heart';

export const getPreset = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id);
