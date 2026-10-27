import { useEffect, useRef, useState } from 'react';
import { maxCircles, type DisplaySettings } from '../core/settings';
import type { SelectionMode } from '../math/selection';
import { COLORS } from '../render/scene';
import { Chip, Field, Segmented, Slider } from './ui';

// Circle-count slider is logarithmic: 1–10 gets as much travel as 100–1000.
const SLIDER_MAX = 1000;
const countToSlider = (k: number, max: number) => Math.round((Math.log(k) / Math.log(max)) * SLIDER_MAX);
const sliderToCount = (u: number, max: number) => Math.max(1, Math.min(max, Math.round(Math.exp((u / SLIDER_MAX) * Math.log(max)))));

interface CountProps {
  sampleCount: number;
  count: number;
  /** Live value while the thumb is being dragged (the animation keeps running). */
  onPreview: (k: number) => void;
  /** Final value: the animation restarts from t = 0 with this many circles. */
  onCommit: (k: number) => void;
}

export function CircleCountControl({ sampleCount, count, onPreview, onCommit }: CountProps) {
  const max = maxCircles(sampleCount);
  // The slider keeps its own thumb position while dragging; the log mapping is not exactly
  // invertible, so deriving it from `count` on every event would make the thumb jitter.
  const [pos, setPos] = useState(() => countToSlider(count, max));
  const fromSlider = useRef(count);
  useEffect(() => {
    if (count !== fromSlider.current) setPos(countToSlider(count, max));
  }, [count, max]);

  const [draft, setDraft] = useState(String(count));
  useEffect(() => setDraft(String(count)), [count]);
  // Enter is an explicit "apply" and always redraws; leaving the field only applies a changed value,
  // so tapping into the box and away again (or moving focus elsewhere) never restarts the animation.
  const commitDraft = (explicit: boolean) => {
    const v = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(v)) {
      setDraft(String(count));
      return;
    }
    const k = Math.max(1, Math.min(max, Math.round(v)));
    setDraft(String(k));
    if (explicit || k !== count) onCommit(k);
  };

  const quick = [1, 2, 5, 10, 50, 100, max];
  return (
    <Field label="원의 개수 K">
      <div className="flex items-center gap-3">
        <Slider
          label="원의 개수"
          min={0}
          max={SLIDER_MAX}
          step={1}
          value={pos}
          valueText={`원 ${count}개`}
          testId="circle-slider"
          onChange={(u) => {
            const k = sliderToCount(u, max);
            fromSlider.current = k;
            setPos(u);
            onPreview(k);
          }}
          onCommit={(u) => onCommit(sliderToCount(u, max))}
        />
        <input
          type="number"
          inputMode="numeric"
          aria-label="원의 개수 직접 입력"
          data-testid="circle-input"
          min={1}
          max={max}
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={() => commitDraft(false)}
          onKeyDown={(e) => e.key === 'Enter' && commitDraft(true)}
          className="h-11 w-20 shrink-0 rounded-lg border border-line px-2 text-right font-mono text-base tabular focus:border-accent focus:outline-none sm:h-9 sm:text-sm"
        />
      </div>
      <div className="flex gap-1 sm:flex-wrap sm:gap-1.5" role="group" aria-label="원 개수 빠른 선택">
        {quick.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onCommit(q)}
            data-testid={`circles-${q === max ? 'all' : q}`}
            aria-pressed={q === count}
            className={`h-11 min-w-10 flex-1 rounded-lg px-1 font-mono text-sm tabular transition-colors sm:h-7 sm:min-w-0 sm:flex-none sm:px-2 sm:text-xs ${
              q === count ? 'bg-accent text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {q === max ? '전체' : q}
          </button>
        ))}
      </div>
    </Field>
  );
}

export function SelectionControl({ value, onChange }: { value: SelectionMode; onChange: (m: SelectionMode) => void }) {
  return (
    <Field label="성분 선택 방식">
      <Segmented<SelectionMode>
        label="성분 선택 방식"
        value={value}
        onChange={onChange}
        options={[
          { value: 'amplitude', label: '진폭 큰 순서', title: '반지름이 큰 원부터 K개 사용 (같은 K에서 오차 최소)' },
          { value: 'frequency', label: '저주파부터', title: 'k = +1, −1, +2, −2, … 순서로 K개 사용' },
        ]}
      />
    </Field>
  );
}

const swatchLine = (color: string) => (
  <svg width="14" height="8" aria-hidden="true">
    <line x1="1" y1="4" x2="13" y2="4" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);
const swatchCircle = (color: string) => (
  <svg width="12" height="12" aria-hidden="true">
    <circle cx="6" cy="6" r="4.5" fill="none" stroke={color} strokeWidth="1.5" />
  </svg>
);

export function DisplayChips({ display: d, onDisplay }: { display: DisplaySettings; onDisplay: (patch: Partial<DisplaySettings>) => void }) {
  return (
    <Field label="표시 항목">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="표시 항목">
        <Chip on={d.circles} onToggle={() => onDisplay({ circles: !d.circles })} swatch={swatchCircle(COLORS.circlePositive)}>
          원
        </Chip>
        <Chip on={d.arms} onToggle={() => onDisplay({ arms: !d.arms })} swatch={swatchLine(COLORS.arm)}>
          벡터
        </Chip>
        <Chip on={d.trail} onToggle={() => onDisplay({ trail: !d.trail })} swatch={swatchLine(d.trailColor)}>
          궤적
        </Chip>
        <Chip on={d.original} onToggle={() => onDisplay({ original: !d.original })} swatch={swatchLine(COLORS.original)}>
          원본
        </Chip>
        <Chip on={d.preview} onToggle={() => onDisplay({ preview: !d.preview })} swatch={swatchLine(COLORS.preview)}>
          전체 근사 곡선
        </Chip>
      </div>
    </Field>
  );
}
