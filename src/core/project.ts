// Project files (.json): a versioned, validated description of the stroke and settings.
// Parsed with JSON.parse and checked field by field; nothing in a file is ever executed.

import { MAX_INPUT_POINTS, PATH_MODES, SAMPLE_COUNTS, type PathMode, type SampleCount, type Vec2 } from '../math/path';
import { CHAIN_ORDERS, SELECTION_MODES, type ChainOrder, type SelectionMode } from '../math/selection';
import {
  DEFAULT_SETTINGS,
  MAX_LINE_WIDTH,
  MAX_SPEED,
  MIN_LINE_WIDTH,
  MIN_SPEED,
  maxCircles,
  type DisplaySettings,
  type LabSettings,
} from './settings';

export const PROJECT_FORMAT = 'fourierlab-project';
export const PROJECT_VERSION = 1;
/** Coordinates are in drawing-canvas half-widths; anything far outside is not a drawing. */
export const MAX_COORDINATE = 100;
export const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  savedAt: string;
  /** Where the stroke came from (preset id, "user" or "file"); informational only. */
  source: string;
  /** Stroke in math coordinates (y up, drawing canvas = [-1, 1]²), rounded to 1e-6. */
  path: [number, number][];
  settings: LabSettings;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function createProject(path: readonly Vec2[], settings: LabSettings, source: string, now = new Date()): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: now.toISOString(),
    source,
    path: path.map((p) => [round6(p[0]), round6(p[1])]),
    settings: structuredClone(settings),
  };
}

export type ParseResult = { ok: true; project: ProjectFile } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

class ValidationError extends Error {}
const fail = (msg: string): never => {
  throw new ValidationError(msg);
};

function num(obj: Record<string, unknown>, key: string, min: number, max: number, integer = false): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`"${key}" 값이 숫자가 아닙니다.`);
  const n = v as number;
  if (integer && !Number.isInteger(n)) fail(`"${key}" 값은 정수여야 합니다.`);
  if (n < min || n > max) fail(`"${key}" 값 ${n}이(가) 허용 범위 [${min}, ${max}]를 벗어났습니다.`);
  return n;
}

function oneOf<T extends string | number>(obj: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const v = obj[key];
  if (!allowed.includes(v as T)) fail(`"${key}" 값이 올바르지 않습니다. 허용 값: ${allowed.join(', ')}`);
  return v as T;
}

function bool(obj: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = obj[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') fail(`"${key}" 값은 true 또는 false여야 합니다.`);
  return v as boolean;
}

function parseDisplay(raw: unknown): DisplaySettings {
  const d = DEFAULT_SETTINGS.display;
  if (raw === undefined) return { ...d };
  if (!isObject(raw)) fail('"display" 항목이 객체가 아닙니다.');
  const o = raw as Record<string, unknown>;
  const color = o.trailColor === undefined ? d.trailColor : o.trailColor;
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) fail('"trailColor"는 #rrggbb 형식이어야 합니다.');
  return {
    circles: bool(o, 'circles', d.circles),
    arms: bool(o, 'arms', d.arms),
    original: bool(o, 'original', d.original),
    preview: bool(o, 'preview', d.preview),
    trail: bool(o, 'trail', d.trail),
    grid: bool(o, 'grid', d.grid),
    directionColors: bool(o, 'directionColors', d.directionColors),
    trailColor: color as string,
    lineWidth: o.lineWidth === undefined ? d.lineWidth : num(o, 'lineWidth', MIN_LINE_WIDTH, MAX_LINE_WIDTH),
    stats: bool(o, 'stats', d.stats),
  };
}

function parseSettings(raw: unknown): LabSettings {
  if (!isObject(raw)) fail('"settings" 항목이 없거나 객체가 아닙니다.');
  const o = raw as Record<string, unknown>;
  const sampleCount = oneOf<SampleCount>(o, 'sampleCount', SAMPLE_COUNTS);
  return {
    pathMode: oneOf<PathMode>(o, 'pathMode', PATH_MODES),
    sampleCount,
    circleCount: num(o, 'circleCount', 1, maxCircles(sampleCount), true),
    selectionMode: oneOf<SelectionMode>(o, 'selectionMode', SELECTION_MODES),
    chainOrder: o.chainOrder === undefined ? DEFAULT_SETTINGS.chainOrder : oneOf<ChainOrder>(o, 'chainOrder', CHAIN_ORDERS),
    speed: num(o, 'speed', MIN_SPEED, MAX_SPEED),
    loop: bool(o, 'loop', DEFAULT_SETTINGS.loop),
    display: parseDisplay(o.display),
  };
}

function parsePath(raw: unknown): [number, number][] {
  if (!Array.isArray(raw)) fail('"path" 항목이 배열이 아닙니다.');
  const arr = raw as unknown[];
  if (arr.length < 2) fail('"path"에는 최소 2개의 점이 필요합니다.');
  if (arr.length > MAX_INPUT_POINTS) fail(`"path"의 점이 너무 많습니다(최대 ${MAX_INPUT_POINTS}개).`);
  return arr.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) fail(`path[${i}]는 [x, y] 형식이어야 합니다.`);
    const [x, y] = p as unknown[];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      fail(`path[${i}]에 올바르지 않은 숫자가 있습니다.`);
    }
    if (Math.abs(x as number) > MAX_COORDINATE || Math.abs(y as number) > MAX_COORDINATE) {
      fail(`path[${i}] 좌표가 허용 범위(±${MAX_COORDINATE})를 벗어났습니다.`);
    }
    return [x as number, y as number];
  });
}

/** Validates an already-parsed value. */
export function validateProject(value: unknown): ParseResult {
  try {
    if (!isObject(value)) fail('프로젝트 파일의 최상위 값이 객체가 아닙니다.');
    const o = value as Record<string, unknown>;
    if (o.format !== PROJECT_FORMAT) fail('FourierLab 프로젝트 파일이 아닙니다.');
    if (o.version !== PROJECT_VERSION) fail(`지원하지 않는 파일 버전입니다(${String(o.version)}). 지원 버전: ${PROJECT_VERSION}`);
    const project: ProjectFile = {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      savedAt: typeof o.savedAt === 'string' ? o.savedAt.slice(0, 64) : '',
      source: typeof o.source === 'string' ? o.source.slice(0, 64) : 'file',
      path: parsePath(o.path),
      settings: parseSettings(o.settings),
    };
    return { ok: true, project };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Parses JSON text (never evaluates it) and validates the result. */
export function parseProject(text: string): ParseResult {
  if (text.length > MAX_PROJECT_BYTES) return { ok: false, error: '파일이 너무 큽니다(최대 5MB).' };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON 형식이 올바르지 않습니다.' };
  }
  return validateProject(value);
}

export const serializeProject = (project: ProjectFile): string => JSON.stringify(project);
