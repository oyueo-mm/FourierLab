// Read-only inspection hook used by the browser tests (e2e/*.mjs) and handy in devtools:
//   window.__FOURIERLAB__.state()
// It only reports values; nothing here changes application state.

export interface DebugSources {
  viz?: () => Record<string, unknown>;
  app?: () => Record<string, unknown>;
}

const sources: DebugSources = {};

/** How often the expensive stages ran; the tests use it to prove that a slider does not redo the FFT. */
export const counters = { prepare: 0, spectrum: 0 };

export function registerDebug<K extends keyof DebugSources>(key: K, fn: NonNullable<DebugSources[K]>): () => void {
  sources[key] = fn;
  return () => {
    if (sources[key] === fn) delete sources[key];
  };
}

declare global {
  interface Window {
    __FOURIERLAB__?: { state: () => Record<string, unknown> };
  }
}

if (typeof window !== 'undefined') {
  window.__FOURIERLAB__ = {
    state: () => ({ ...(sources.app?.() ?? {}), ...(sources.viz?.() ?? {}), counters: { ...counters } }),
  };
}
