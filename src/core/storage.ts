// Autosave of the current project so a page reload restores the same drawing and settings.
// Stored in the same validated format as project files; any read/write failure (private
// mode, blocked storage, corrupt data) falls back to the defaults silently.

import type { Vec2 } from '../math/path';
import type { LabSettings } from './settings';
import { createProject, validateProject, type ProjectFile } from './project';

const KEY = 'fourierlab:autosave:v1';

export interface Autosave {
  project: ProjectFile;
  /** A drawn stroke not yet analysed, if any. */
  draft: Vec2[] | null;
}

export function saveAutosave(path: readonly Vec2[], settings: LabSettings, source: string, draft: readonly Vec2[] | null) {
  try {
    const data = { project: createProject(path, settings, source), draft: draft ? createProject(draft, settings, 'user').path : null };
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
    let draft: Vec2[] | null = null;
    if (Array.isArray(data.draft)) {
      const d = validateProject({ ...r.project, path: data.draft });
      if (d.ok) draft = d.project.path;
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
