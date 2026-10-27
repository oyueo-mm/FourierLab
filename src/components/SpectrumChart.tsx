import { memo, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Spectrum } from '../math/fourier';
import { COLORS } from '../render/scene';
import { Segmented } from './ui';

const UNUSED = '#cbd5e1';
const DC = '#94a3b8';

interface Props {
  spectrum: Spectrum;
  used: Set<number>;
  selectedK: number | null;
  onSelect: (k: number | null) => void;
}

interface Row {
  k: number;
  amp: number;
  /** Value plotted (amplitude, floored for the log scale). */
  y: number;
  phase: number;
  used: boolean;
}

const WINDOWS = [20, 50, 100, 200] as const;

export const SpectrumChart = memo(function SpectrumChart({ spectrum, used, selectedK, onSelect }: Props) {
  const [win, setWin] = useState<number>(50);
  const [log, setLog] = useState(false);
  const half = Math.min(win, Math.floor(spectrum.n / 2));

  const rows = useMemo(() => {
    const maxAmp = Math.max(...spectrum.coefficients.filter((c) => c.k !== 0).map((c) => c.amplitude), 1e-12);
    const floor = maxAmp * 1e-6;
    const out: Row[] = [];
    for (let k = -half; k <= half; k++) {
      const i = spectrum.indexOf(k);
      const c = spectrum.coefficients[i];
      if (!c) continue;
      out.push({ k, amp: c.amplitude, y: log ? Math.max(c.amplitude, floor) : c.amplitude, phase: c.phase, used: k === 0 || used.has(k) });
    }
    return { out, floor };
  }, [spectrum, used, half, log]);

  const fill = (r: Row) => (r.k === 0 ? DC : !r.used ? UNUSED : r.k > 0 ? COLORS.circlePositive : COLORS.circleNegative);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS.circlePositive }} /> k &gt; 0 반시계 (사용 중)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS.circleNegative }} /> k &lt; 0 시계 (사용 중)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm" style={{ background: UNUSED }} /> 사용하지 않음
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-sm" style={{ background: DC }} /> k = 0 (중심 위치)
        </span>
        <div className="ml-auto flex w-full gap-2">
          <div className="min-w-0 flex-1">
            <Segmented
              label="표시 범위"
              size="sm"
              value={win}
              onChange={setWin}
              options={WINDOWS.map((w) => ({ value: w, label: `±${w}` }))}
            />
          </div>
          <div className="w-28 shrink-0">
            <Segmented
              label="세로축 눈금"
              size="sm"
              value={log ? 'log' : 'lin'}
              onChange={(v) => setLog(v === 'log')}
              options={[
                { value: 'lin', label: '선형' },
                { value: 'log', label: '로그' },
              ]}
            />
          </div>
        </div>
      </div>
      <div className="h-64 w-full" data-testid="spectrum-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows.out}
            margin={{ top: 8, right: 8, bottom: 16, left: 4 }}
            barCategoryGap={1}
            onClick={(state) => {
              const idx = state?.activeTooltipIndex;
              const row = idx === undefined || idx === null ? undefined : rows.out[Number(idx)];
              if (row && row.k !== 0) onSelect(row.k === selectedK ? null : row.k);
            }}
            style={{ cursor: 'pointer' }}
          >
            <CartesianGrid vertical={false} stroke="#eef1f5" />
            <XAxis
              dataKey="k"
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickLine={false}
              axisLine={{ stroke: '#cbd5e1' }}
              interval="preserveStartEnd"
              minTickGap={18}
              label={{ value: '주파수 k', position: 'insideBottom', offset: -10, fontSize: 11, fill: '#64748b' }}
            />
            <YAxis
              scale={log ? 'log' : 'linear'}
              domain={log ? [rows.floor, 'auto'] : [0, 'auto']}
              allowDataOverflow
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => (v === 0 ? '0' : v < 0.01 ? v.toExponential(0) : v.toFixed(2))}
            />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.15)' }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const r = active && payload?.[0]?.payload as Row | undefined;
                if (!r) return null;
                return (
                  <div className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs shadow-sm">
                    <div className="font-semibold text-ink">k = {r.k > 0 ? `+${r.k}` : r.k}</div>
                    <div className="text-slate-600">
                      진폭 <span className="font-mono text-ink">{r.amp.toPrecision(4)}</span>
                    </div>
                    <div className="text-slate-600">
                      위상 <span className="font-mono text-ink">{((r.phase * 180) / Math.PI).toFixed(1)}°</span>
                    </div>
                    <div className="text-muted">{r.k === 0 ? '고정된 중심 이동' : r.used ? '사용 중 · 클릭하면 강조' : '현재 사용하지 않음'}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="y" isAnimationActive={false} radius={[2, 2, 0, 0]}>
              {rows.out.map((r) => (
                <Cell
                  key={r.k}
                  fill={fill(r)}
                  stroke={r.k === selectedK ? COLORS.selected : undefined}
                  strokeWidth={r.k === selectedK ? 2 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        막대 높이는 원의 반지름 |c<sub>k</sub>|입니다. 그려진 곡선은 일반적인 복소수 신호이므로 +k와 −k의 크기가 서로 다릅니다.
        막대를 클릭하면 해당 원이 애니메이션에서 강조됩니다.
      </p>
    </div>
  );
});
