import { useEffect, useState } from 'react';
import { maxCircles, type DisplaySettings, type LabSettings } from '../core/settings';
import type { SelectionMode } from '../math/selection';
import { COLORS } from '../render/scene';
import { Chip, Field, Segmented, Slider } from './ui';

// Circle-count slider is logarithmic: 1–10 gets as much travel as 100–1000.
const SLIDER_MAX = 1000;
const countToSlider = (k: number, max: number) => Math.round((Math.log(k) / Math.log(max)) * SLIDER_MAX);
const sliderToCount = (u: number, max: number) => Math.max(1, Math.min(max, Math.round(Math.exp((u / SLIDER_MAX) * Math.log(max)))));

interface Props {
  settings: LabSettings;
  onCircles: (k: number) => void;
  onSelectionMode: (m: SelectionMode) => void;
  onDisplay: (patch: Partial<DisplaySettings>) => void;
}

const swatchLine = (color: string, dashed = false) => (
  <svg width="14" height="8" aria-hidden="true">
    <line x1="1" y1="4" x2="13" y2="4" stroke={color} strokeWidth="2.5" strokeDasharray={dashed ? '3 2' : undefined} strokeLinecap="round" />
  </svg>
);
const swatchCircle = (color: string) => (
  <svg width="12" height="12" aria-hidden="true">
    <circle cx="6" cy="6" r="4.5" fill="none" stroke={color} strokeWidth="1.5" />
  </svg>
);

export function CircleControls({ settings, onCircles, onSelectionMode, onDisplay }: Props) {
  const max = maxCircles(settings.sampleCount);
  const k = settings.circleCount;
  const [draft, setDraft] = useState(String(k));
  useEffect(() => setDraft(String(k)), [k]);
  const commitDraft = () => {
    const v = Number(draft);
    if (Number.isFinite(v)) onCircles(Math.max(1, Math.min(max, Math.round(v))));
    else setDraft(String(k));
  };
  const d = settings.display;
  const quick = [1, 2, 5, 10, 50, 100, max];

  return (
    <div className="space-y-4">
      <Field label="원의 개수 K" hint={`최대 ${max.toLocaleString()} (N − 1)`}>
        <div className="flex items-center gap-3">
          <Slider
            label="원의 개수"
            min={0}
            max={SLIDER_MAX}
            step={1}
            value={countToSlider(k, max)}
            valueText={`원 ${k}개`}
            onChange={(u) => onCircles(sliderToCount(u, max))}
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
            onBlur={commitDraft}
            onKeyDown={(e) => e.key === 'Enter' && commitDraft()}
            className="w-20 shrink-0 rounded-lg border border-line px-2 py-1.5 text-right font-mono text-sm tabular focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {quick.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onCircles(q)}
              data-testid={`circles-${q === max ? 'all' : q}`}
              className={`rounded-md px-2 py-0.5 font-mono text-xs tabular transition-colors ${
                q === k ? 'bg-accent text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {q === max ? '전체' : q}
            </button>
          ))}
        </div>
      </Field>

      <Field label="성분 선택 방식">
        <Segmented<SelectionMode>
          label="성분 선택 방식"
          value={settings.selectionMode}
          onChange={onSelectionMode}
          options={[
            { value: 'amplitude', label: '진폭 큰 순서', title: '반지름이 큰 원부터 K개 사용 (같은 K에서 오차 최소)' },
            { value: 'frequency', label: '저주파부터', title: 'k = +1, −1, +2, −2, … 순서로 K개 사용' },
          ]}
        />
      </Field>

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
    </div>
  );
}
