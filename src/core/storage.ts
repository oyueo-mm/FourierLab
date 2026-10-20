// Autosave of the current project so a page reload restores the same drawing and settings.
// Stored in the same validated format as project files; any read/write failure (private
// mode, blocked storage, corrupt data) falls back to the defaults silently.

import type { PathMode, Vec2 } from '../math/path';
import type { LabSettings } from './settings';
import { createProject, validateProject, type ProjectFile } from './project';

const KEY = 'fourierlab:autosave:v1';

/** A stroke being edited in the drawer that has not been applied to the animation yet. */
export interface Draft {
  points: Vec2[];
  mode: PathMode;
}

export interface Autosave {
  project: ProjectFile;
  draft: Draft | null;
}

export function saveAutosave(path: readonly Vec2[], settings: LabSettings, source: string, draft: Draft | null) {
  try {
    const data = {
      project: createProject(path, settings, source),
      draft: draft ? { path: createProject(draft.points, settings, 'user').path, mode: draft.mode } : null,
    };
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable or full: autosave is best-effort */
  }
}

export function loadAutosave(): Autosave | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { project?: unknown; draft?: unknown };
    const r = validateProject(data.project);
    if (!r.ok) return null;
    let draft: Draft | null = null;
    // First release stored the bare point array; later ones store { path, mode }.
    const d = data.draft;
    const rawPath = Array.isArray(d) ? d : d && typeof d === 'object' ? (d as { path?: unknown }).path : null;
    const rawMode = d && typeof d === 'object' && !Array.isArray(d) ? (d as { mode?: unknown }).mode : undefined;
    if (Array.isArray(rawPath)) {
      const checked = validateProject({ ...r.project, path: rawPath, settings: { ...r.project.settings, pathMode: rawMode ?? r.project.settings.pathMode } });
      if (checked.ok) draft = { points: checked.project.path, mode: checked.project.settings.pathMode };
    }
    return { project: r.project, draft };
  } catch {
    return null;
  }
}

export function clearAutosave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
