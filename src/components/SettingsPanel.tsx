import { MAX_LINE_WIDTH, MIN_LINE_WIDTH, TRAIL_COLORS, type DisplaySettings, type LabSettings } from '../core/settings';
import { SAMPLE_COUNTS, type SampleCount } from '../math/path';
import type { ChainOrder } from '../math/selection';
import { Button, Field, Segmented, Slider } from './ui';

interface Props {
  settings: LabSettings;
  onSampleCount: (n: SampleCount) => void;
  onChainOrder: (o: ChainOrder) => void;
  onDisplay: (patch: Partial<DisplaySettings>) => void;
  onReset: () => void;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1 text-sm text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
      <span>{label}</span>
    </label>
  );
}

export function SettingsPanel({ settings, onSampleCount, onChainOrder, onDisplay, onReset }: Props) {
  const d = settings.display;
  return (
    <div className="space-y-5">
        <Field label="샘플 수 N">
          <Segmented<SampleCount>
            label="샘플 수"
            size="sm"
            value={settings.sampleCount}
            onChange={onSampleCount}
            options={SAMPLE_COUNTS.map((n) => ({ value: n, label: n.toLocaleString() }))}
          />
        </Field>

        <Field label="원을 잇는 순서">
          <Segmented<ChainOrder>
            label="원을 잇는 순서"
            size="sm"
            value={settings.chainOrder}
            onChange={onChainOrder}
            options={[
              { value: 'amplitude', label: '큰 원부터' },
              { value: 'frequency', label: '저주파부터' },
            ]}
          />
        </Field>

        <Field label="궤적 색상">
          <div className="flex gap-2" role="radiogroup" aria-label="궤적 색상">
            {TRAIL_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={d.trailColor === c.value}
                aria-label={c.name}
                title={c.name}
                onClick={() => onDisplay({ trailColor: c.value })}
                className={`h-7 w-7 rounded-full border-2 transition-transform ${d.trailColor === c.value ? 'scale-110 border-white ring-2 ring-slate-400' : 'border-white ring-1 ring-line'}`}
                style={{ background: c.value }}
              />
            ))}
          </div>
        </Field>

        <Field label="궤적 선 두께" hint={`${d.lineWidth.toFixed(1)} px`}>
          <Slider label="궤적 선 두께" min={MIN_LINE_WIDTH} max={MAX_LINE_WIDTH} step={0.5} value={d.lineWidth} onChange={(v) => onDisplay({ lineWidth: v })} />
        </Field>

        <div>
          <Toggle label="회전 방향별 색 구분" checked={d.directionColors} onChange={(v) => onDisplay({ directionColors: v })} />
          <Toggle label="격자 표시" checked={d.grid} onChange={(v) => onDisplay({ grid: v })} />
          <Toggle label="성능 정보 표시 (FPS)" checked={d.stats} onChange={(v) => onDisplay({ stats: v })} />
        </div>

        <Button variant="ghost" className="text-xs" onClick={onReset}>
          설정을 기본값으로
        </Button>
    </div>
  );
}
