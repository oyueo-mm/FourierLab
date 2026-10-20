import type { PathMode, SampleCount } from '../math/path';
import type { ChainOrder, SelectionMode } from '../math/selection';

export interface DisplaySettings {
  circles: boolean;
  arms: boolean;
  original: boolean;
  /** The whole reconstructed curve, drawn faintly behind the animation. */
  preview: boolean;
  trail: boolean;
  grid: boolean;
  /** Tint counter-clockwise (k > 0) and clockwise (k < 0) circles differently. */
  directionColors: boolean;
  trailColor: string;
  /** Trail line width in CSS pixels. */
  lineWidth: number;
  /** Show FPS / frame time on the canvas. */
  stats: boolean;
}

export interface LabSettings {
  pathMode: PathMode;
  sampleCount: SampleCount;
  /** Rotating circles (k ≠ 0). DC is always included and not counted. */
  circleCount: number;
  selectionMode: SelectionMode;
  chainOrder: ChainOrder;
  /** Playback speed multiplier; 1× = one full drawing every BASE_PERIOD_SECONDS. */
  speed: number;
  loop: boolean;
  display: DisplaySettings;
}

export const BASE_PERIOD_SECONDS = 10;
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 5;
export const MIN_LINE_WIDTH = 1;
export const MAX_LINE_WIDTH = 6;

export const TRAIL_COLORS = [
  { value: '#2563eb', name: '파랑' },
  { value: '#0d9488', name: '청록' },
  { value: '#7c3aed', name: '보라' },
  { value: '#e11d48', name: '장미' },
  { value: '#0f172a', name: '먹색' },
] as const;

export const DEFAULT_SETTINGS: LabSettings = {
  pathMode: 'closed',
  sampleCount: 1024,
  circleCount: 64,
  selectionMode: 'amplitude',
  chainOrder: 'amplitude',
  speed: 1,
  loop: true,
  display: {
    circles: true,
    arms: true,
    original: true,
    preview: false,
    trail: true,
    grid: true,
    directionColors: true,
    trailColor: TRAIL_COLORS[0].value,
    lineWidth: 2.5,
    stats: false,
  },
};

/** Largest circle count for N samples: every non-DC bin. */
export const maxCircles = (sampleCount: number): number => sampleCount - 1;

export const clampCircles = (count: number, sampleCount: number): number =>
  Math.max(1, Math.min(maxCircles(sampleCount), Math.round(count)));

/** Seconds for one full traversal at the given speed. */
export const periodSeconds = (speed: number): number => BASE_PERIOD_SECONDS / speed;
