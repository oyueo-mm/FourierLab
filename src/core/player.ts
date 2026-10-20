// Playback clock, independent of React.
//
// Progress p ∈ [0, 1] is the fraction of one traversal of the drawing. It advances by
// real elapsed time: dp/dt = speed / BASE_PERIOD_SECONDS. A requestAnimationFrame loop runs
// only while playing, so a paused player costs nothing.

import { BASE_PERIOD_SECONDS } from './settings';

/** Longest step taken in one frame; longer gaps (background tab, debugger) are clipped. */
export const MAX_FRAME_SECONDS = 0.1;

export interface PlayerState {
  playing: boolean;
  speed: number;
  loop: boolean;
}

type FrameListener = (progress: number) => void;
type StateListener = () => void;

export interface Scheduler {
  request: (cb: (now: number) => void) => number;
  cancel: (id: number) => void;
}

const browserScheduler: Scheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};

export class Player {
  private progress = 0;
  /** Number of `restart()` calls so far (diagnostics for the browser tests). */
  restarts = 0;
  private state: PlayerState;
  private frameId: number | null = null;
  private lastTime: number | null = null;
  private frameListeners = new Set<FrameListener>();
  private stateListeners = new Set<StateListener>();
  private readonly scheduler: Scheduler;

  constructor(initial: Partial<PlayerState> = {}, scheduler: Scheduler = browserScheduler) {
    this.state = { playing: false, speed: 1, loop: true, ...initial };
    this.scheduler = scheduler;
  }

  /** Current progress in [0, 1]. */
  get time(): number {
    return this.progress;
  }

  /** Stable snapshot for useSyncExternalStore (replaced on every change). */
  getState = (): PlayerState => this.state;

  subscribe = (listener: StateListener): (() => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  /** Called with the progress after every change of time (frames, seeks, steps). */
  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  private setState(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.stateListeners.forEach((l) => l());
  }

  private emitFrame() {
    this.frameListeners.forEach((l) => l(this.progress));
  }

  play() {
    if (this.state.playing) return;
    // A finished one-shot run starts over.
    if (this.progress >= 1) this.progress = 0;
    this.setState({ playing: true });
    this.lastTime = null;
    this.frameId = this.scheduler.request(this.tick);
  }

  pause() {
    if (!this.state.playing) return;
    if (this.frameId !== null) this.scheduler.cancel(this.frameId);
    this.frameId = null;
    this.lastTime = null;
    this.setState({ playing: false });
  }

  toggle() {
    if (this.state.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: number) {
    this.setState({ speed });
  }

  setLoop(loop: boolean) {
    this.setState({ loop });
  }

  /**
   * Back to the first frame because the thing being drawn changed (circle count, selection
   * mode, a new drawing). Keeps the play state: a running player continues from t = 0, a paused
   * one stays paused on the new first frame, and a finished one-shot run is re-armed.
   */
  restart() {
    this.restarts++;
    this.lastTime = null;
    this.seek(0);
  }

  /** Jumps to progress p (clamped to [0, 1]) without changing play state. */
  seek(p: number) {
    this.progress = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));
    this.emitFrame();
  }

  /** Moves by `delta` of a period, wrapping around in loop mode. */
  step(delta: number) {
    let p = this.progress + delta;
    if (this.state.loop) p = ((p % 1) + 1) % 1;
    this.seek(p);
  }

  /** Re-emits the current time (e.g. after the data changed while paused). */
  refresh() {
    this.emitFrame();
  }

  /** Forget the previous frame timestamp, so the next frame does not include a long gap. */
  resetClock() {
    this.lastTime = null;
  }

  dispose() {
    if (this.frameId !== null) this.scheduler.cancel(this.frameId);
    this.frameId = null;
    this.frameListeners.clear();
    this.stateListeners.clear();
  }

  /** Advances by `seconds` of real time. Exposed for tests. */
  advance(seconds: number) {
    const dt = Math.min(Math.max(seconds, 0), MAX_FRAME_SECONDS);
    let p = this.progress + (dt * this.state.speed) / BASE_PERIOD_SECONDS;
    if (p >= 1) {
      if (this.state.loop) p -= Math.floor(p);
      else {
        this.progress = 1;
        this.emitFrame();
        this.pause();
        return;
      }
    }
    this.progress = p;
    this.emitFrame();
  }

  private tick = (now: number) => {
    this.frameId = null;
    if (!this.state.playing) return;
    if (this.lastTime !== null) this.advance((now - this.lastTime) / 1000);
    else this.emitFrame();
    this.lastTime = now;
    if (this.state.playing) this.frameId = this.scheduler.request(this.tick);
  };
}
