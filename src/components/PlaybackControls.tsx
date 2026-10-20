// Transport buttons, timeline and speed. The time readout and the timeline thumb are updated
// from player frames through refs, so playback never re-renders React.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Player } from '../core/player';
import { MAX_SPEED, MIN_SPEED, periodSeconds } from '../core/settings';
import { PauseIcon, PlayIcon, ReplayIcon, SkipStartIcon, StepBackIcon, StepForwardIcon } from './icons';
import { IconButton, Slider, cx } from './ui';

const TIMELINE_STEPS = 10000;

// Speed slider is logarithmic so 0.1×–1× and 1×–5× both get usable travel.
const speedToSlider = (s: number) => Math.log(s / MIN_SPEED) / Math.log(MAX_SPEED / MIN_SPEED);
const sliderToSpeed = (u: number) => Math.round(MIN_SPEED * (MAX_SPEED / MIN_SPEED) ** u * 100) / 100;

export function TransportRow({
  player,
  loop,
  sampleCount,
  onLoop,
  className,
}: {
  player: Player;
  loop: boolean;
  /** One "step" moves by one sample, 1/N of the period. */
  sampleCount: number;
  onLoop: (loop: boolean) => void;
  className?: string;
}) {
  const { playing } = useSyncExternalStore(player.subscribe, player.getState);
  const step = 1 / sampleCount;
  return (
    <div className={cx('flex items-center justify-between gap-1.5 sm:justify-start sm:gap-2', className)} role="group" aria-label="재생 컨트롤">
      <IconButton
        large
        label="처음으로 이동"
        onClick={() => {
          player.pause();
          player.seek(0);
        }}
      >
        <SkipStartIcon />
      </IconButton>
      <IconButton large label="한 단계 뒤로" onClick={() => player.step(-step)}>
        <StepBackIcon />
      </IconButton>
      <button
        type="button"
        data-testid="play-toggle"
        aria-label={playing ? '일시정지' : '재생'}
        title={playing ? '일시정지 (Space)' : '재생 (Space)'}
        onClick={() => player.toggle()}
        className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-sm transition-colors hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
      </button>
      <IconButton large label="한 단계 진행" onClick={() => player.step(step)}>
        <StepForwardIcon />
      </IconButton>
      <IconButton
        large
        label="처음부터 다시 재생"
        onClick={() => {
          player.restart();
          player.play();
        }}
      >
        <ReplayIcon />
      </IconButton>
      <button
        type="button"
        data-testid="loop-toggle"
        aria-pressed={loop}
        aria-label={loop ? '반복 재생 중 (누르면 한 번만 재생)' : '한 번만 재생 (누르면 반복 재생)'}
        onClick={() => onLoop(!loop)}
        className={cx(
          'h-11 shrink-0 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          loop ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-white text-slate-600',
        )}
      >
        {loop ? '반복' : '한 번'}
      </button>
    </div>
  );
}

export function TimelineRow({ player, speed }: { player: Player; speed: number }) {
  const timelineRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const resumeRef = useRef(false);
  const draggingRef = useRef(false);
  const period = periodSeconds(speed);

  useEffect(() => {
    const update = (t: number) => {
      const input = timelineRef.current;
      if (input) {
        if (!draggingRef.current) input.value = String(Math.round(t * TIMELINE_STEPS));
        input.style.setProperty('--fill', `${t * 100}%`);
      }
      if (timeRef.current) timeRef.current.textContent = `t = ${t.toFixed(3)} · ${(t * period).toFixed(1)} / ${period.toFixed(1)}초`;
    };
    update(player.time);
    return player.onFrame(update);
  }, [player, period]);

  const endDrag = () => {
    draggingRef.current = false;
    if (resumeRef.current) player.play();
    resumeRef.current = false;
  };

  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-slate-500">타임라인</span>
        <span ref={timeRef} className="font-mono text-xs text-slate-500 tabular" data-testid="time-label" />
      </div>
      <input
        ref={timelineRef}
        type="range"
        data-testid="timeline"
        aria-label="타임라인"
        className="slider w-full"
        min={0}
        max={TIMELINE_STEPS}
        step={1}
        defaultValue={0}
        onPointerDown={() => {
          draggingRef.current = true;
          resumeRef.current = player.getState().playing;
          player.pause();
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onChange={(e) => player.seek(Number(e.currentTarget.value) / TIMELINE_STEPS)}
      />
    </div>
  );
}

export function SpeedRow({ speed, onSpeed }: { speed: number; onSpeed: (s: number) => void }) {
  const period = periodSeconds(speed);
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-slate-500">속도</span>
        <button
          type="button"
          onClick={() => onSpeed(1)}
          title="1배속으로"
          className="rounded px-1 font-mono text-xs text-slate-500 tabular hover:bg-slate-100"
          data-testid="speed-label"
        >
          {speed.toFixed(2)}× · {period.toFixed(1)}초/바퀴
        </button>
      </div>
      <Slider
        label="재생 속도"
        min={0}
        max={1}
        step={0.001}
        value={speedToSlider(speed)}
        valueText={`${speed.toFixed(2)}배속`}
        onChange={(u) => onSpeed(sliderToSpeed(u))}
        testId="speed-slider"
      />
    </div>
  );
}
