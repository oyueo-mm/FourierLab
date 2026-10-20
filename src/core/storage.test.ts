import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';
import { clearAutosave, loadAutosave, saveAutosave } from './storage';
import type { Vec2 } from '../math/path';

const KEY = 'fourierlab:autosave:v1';

function stubStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  return data;
}

const path: Vec2[] = [
  [0, 0],
  [0.5, 0.25],
  [0.25, -0.5],
];

describe('autosave', () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = stubStorage();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips the applied project and an unapplied draft with its path mode', () => {
    const draft = { points: [[0.1, 0.1], [0.9, 0.2], [0.4, 0.8]] as Vec2[], mode: 'retrace' as const };
    saveAutosave(path, DEFAULT_SETTINGS, 'heart', draft);
    const r = loadAutosave();
    expect(r?.project.path).toEqual(path);
    expect(r?.project.source).toBe('heart');
    expect(r?.draft).toEqual(draft);
  });

  it('stores no draft when everything is applied', () => {
    saveAutosave(path, DEFAULT_SETTINGS, 'user', null);
    expect(loadAutosave()?.draft).toBeNull();
  });

  it('reads the first release format (draft stored as a bare point array)', () => {
    saveAutosave(path, DEFAULT_SETTINGS, 'user', null);
    const saved = JSON.parse(data.get(KEY)!);
    saved.draft = [[0.2, 0.2], [0.7, 0.1]];
    data.set(KEY, JSON.stringify(saved));
    const r = loadAutosave();
    expect(r?.draft?.points).toEqual([[0.2, 0.2], [0.7, 0.1]]);
    expect(r?.draft?.mode).toBe(DEFAULT_SETTINGS.pathMode);
  });

  it('ignores a draft with invalid numbers or an unknown mode instead of crashing', () => {
    saveAutosave(path, DEFAULT_SETTINGS, 'user', null);
    const saved = JSON.parse(data.get(KEY)!);
    saved.draft = { path: [[0, 0], [1, 'x']], mode: 'closed' };
    data.set(KEY, JSON.stringify(saved));
    expect(loadAutosave()?.draft).toBeNull();
    saved.draft = { path: [[0, 0], [1, 1]], mode: 'zigzag' };
    data.set(KEY, JSON.stringify(saved));
    expect(loadAutosave()?.draft).toBeNull();
  });

  it('returns null for corrupt data and survives unavailable storage', () => {
    data.set(KEY, '{not json');
    expect(loadAutosave()).toBeNull();
    clearAutosave();
    expect(data.has(KEY)).toBe(false);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadAutosave()).toBeNull();
    expect(() => saveAutosave(path, DEFAULT_SETTINGS, 'user', null)).not.toThrow();
    expect(() => clearAutosave()).not.toThrow();
  });
});
