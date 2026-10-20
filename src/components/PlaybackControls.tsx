// Play / pause / step / seek / speed / loop. Time display and the timeline are updated
// through refs from player frames, so playback never re-renders React.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Player } from '../core/player';
import { MAX_SPEED, MIN_SPEED, periodSeconds } from '../core/settings';
import { PauseIcon, PlayIcon, ReplayIcon, SkipStartIcon, StepBackIcon, StepForwardIcon } from './icons';
import { IconButton, Segmented, Slider } from './ui';

const TIMELINE_STEPS = 10000;

// Speed slider is logarithmic so 0.1×–1× and 1×–5× both get usable travel.
const speedToSlider = (s: number) => Math.log(s / MIN_SPEED) / Math.log(MAX_SPEED / MIN_SPEED);
const sliderToSpeed = (u: number) => {
  const s = MIN_SPEED * (MAX_SPEED / MIN_SPEED) ** u;
  return Math.round(s * 100) / 100;
};

interface Props {
  player: Player;
  speed: number;
  loop: boolean;
  /** One "step" moves by one sample, 1/N of the period. */
  sampleCount: number;
  onSpeed: (s: number) => void;
  onLoop: (loop: boolean) => void;
}

export function PlaybackControls({ player, speed, loop, sampleCount, onSpeed, onLoop }: Props) {
  const { playing } = useSyncExternalStore(player.subscribe, player.getState);
  const timelineRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const resumeRef = useRef(false);
  const draggingRef = useRef(false);
  const period = periodSeconds(speed);

  useEffect(() => {
    const update = (t: number) => {
      const input = timelineRef.current;
      if (input && !draggingRef.current) {
        input.value = String(Math.round(t * TIMELINE_STEPS));
      }
      if (input) input.style.setProperty('--fill', `${t * 100}%`);
      if (timeRef.current) timeRef.current.textContent = `t = ${t.toFixed(3)} · ${(t * period).toFixed(1)} / ${period.toFixed(1)}초`;
    };
    update(player.time);
    return player.onFrame(update);
  }, [player, period]);

  const step = 1 / sampleCount;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <IconButton
            label="처음으로 이동"
            onClick={() => {
              player.pause();
              player.seek(0);
            }}
          >
            <SkipStartIcon />
          </IconButton>
          <IconButton label="한 단계 뒤로" onClick={() => player.step(-step)}>
            <StepBackIcon />
          </IconButton>
          <button
            type="button"
            data-testid="play-toggle"
            aria-label={playing ? '일시정지' : '재생'}
            title={playing ? '일시정지 (Space)' : '재생 (Space)'}
            onClick={() => player.toggle()}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white shadow-sm transition-colors hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </button>
          <IconButton label="한 단계 진행" onClick={() => player.step(step)}>
            <StepForwardIcon />
          </IconButton>
          <IconButton
            label="처음부터 다시 재생"
            onClick={() => {
              player.seek(0);
              player.play();
            }}
          >
            <ReplayIcon />
          </IconButton>
        </div>
        <div className="w-36">
          <Segmented
            label="재생 방식"
            size="sm"
            value={loop ? 'loop' : 'once'}
            onChange={(v) => onLoop(v === 'loop')}
            options={[
              { value: 'loop', label: '반복' },
              { value: 'once', label: '한 번' },
            ]}
          />
        </div>
        <span ref={timeRef} className="ml-auto font-mono text-xs text-slate-500 tabular" data-testid="time-label" />
      </div>

      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-xs font-semibold text-slate-500">타임라인</span>
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
          onPointerUp={() => {
            draggingRef.current = false;
            if (resumeRef.current) player.play();
            resumeRef.current = false;
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
            if (resumeRef.current) player.play();
            resumeRef.current = false;
          }}
          onChange={(e) => player.seek(Number(e.currentTarget.value) / TIMELINE_STEPS)}
        />
      </div>

      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-xs font-semibold text-slate-500">속도</span>
        <Slider
          label="재생 속도"
          min={0}
          max={1}
          step={0.001}
          value={speedToSlider(speed)}
          valueText={`${speed.toFixed(2)}배속`}
          onChange={(u) => onSpeed(sliderToSpeed(u))}
        />
        <button
          type="button"
          onClick={() => onSpeed(1)}
          title="1배속으로"
          className="w-28 shrink-0 rounded-md px-1 py-0.5 text-right font-mono text-xs text-slate-600 tabular hover:bg-slate-100"
          data-testid="speed-label"
        >
          {speed.toFixed(2)}× · {period.toFixed(1)}초
        </button>
      </div>
    </div>
  );
}
