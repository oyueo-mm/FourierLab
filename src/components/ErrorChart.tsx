import { memo, useMemo } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SelectionMode } from '../math/selection';

const SERIES: Record<SelectionMode, { name: string; color: string }> = {
  amplitude: { name: '진폭 큰 순서', color: '#1d4ed8' },
  frequency: { name: '저주파부터', color: '#d97706' },
};

interface Props {
  errors: { frequency: Float64Array; amplitude: Float64Array };
  scale: number;
  circleCount: number;
  mode: SelectionMode;
}

interface Row {
  k: number;
  amplitude: number;
  frequency: number;
}

const MAX_POINTS = 400;

export const ErrorChart = memo(function ErrorChart({ errors, scale, circleCount, mode }: Props) {
  const maxK = errors.amplitude.length - 1;
  // Show at least 0–200 circles, and always a margin past the current K.
  const xMax = Math.min(maxK, Math.max(200, Math.ceil(circleCount * 1.5)));
  const floor = Math.max(scale * 1e-8, 1e-12);

  const data = useMemo(() => {
    const stride = Math.max(1, Math.ceil(xMax / MAX_POINTS));
    const ks = new Set<number>();
    for (let k = 0; k <= xMax; k += stride) ks.add(k);
    ks.add(xMax);
    ks.add(Math.min(circleCount, xMax));
    return [...ks]
      .sort((a, b) => a - b)
      .map((k): Row => ({ k, amplitude: Math.max(errors.amplitude[k], floor), frequency: Math.max(errors.frequency[k], floor) }));
  }, [errors, xMax, circleCount, floor]);

  // Lower end of the log axis: just below the smallest value actually plotted.
  const yMin = useMemo(() => {
    let m = Infinity;
    for (const r of data) m = Math.min(m, r.amplitude, r.frequency);
    return Math.max(floor, m / 2);
  }, [data, floor]);
  const current = errors[mode][Math.min(circleCount, maxK)];
  const pct = (v: number) => `${((v / scale) * 100).toPrecision(3)}%`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span className="text-slate-600">
          현재 K = <b className="font-mono text-ink tabular">{circleCount}</b>
        </span>
        <span className="text-slate-600">
          RMSE <b className="font-mono text-ink tabular" data-testid="rmse-value">{current.toPrecision(4)}</b>
        </span>
        <span className="text-slate-600">
          상대 오차 <b className="font-mono text-ink tabular">{pct(current)}</b>
        </span>
      </div>
      <div className="h-64 w-full" data-testid="error-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 16, left: 4 }}>
            <CartesianGrid stroke="#eef1f5" />
            <XAxis
              dataKey="k"
              type="number"
              domain={[0, xMax]}
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickLine={false}
              axisLine={{ stroke: '#cbd5e1' }}
              label={{ value: '사용한 원의 개수 K', position: 'insideBottom', offset: -10, fontSize: 11, fill: '#64748b' }}
            />
            <YAxis
              scale="log"
              domain={[yMin, 'auto']}
              allowDataOverflow
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v: number) => v.toExponential(0)}
            />
            <Tooltip
              isAnimationActive={false}
              content={({ active, payload }) => {
                const r = active && (payload?.[0]?.payload as Row | undefined);
                if (!r) return null;
                return (
                  <div className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs shadow-sm">
                    <div className="font-semibold text-ink">K = {r.k}</div>
                    {(['amplitude', 'frequency'] as const).map((m) => (
                      <div key={m} className="flex items-center gap-1.5 text-slate-600">
                        <i className="h-0.5 w-3" style={{ background: SERIES[m].color }} />
                        {SERIES[m].name}: <span className="font-mono text-ink">{r[m].toPrecision(3)}</span>
                        <span className="text-muted">({pct(r[m])})</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <Legend verticalAlign="top" height={24} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine x={Math.min(circleCount, xMax)} stroke="#94a3b8" strokeDasharray="4 4" />
            {(['amplitude', 'frequency'] as const).map((m) => (
              <Line
                key={m}
                dataKey={m}
                name={SERIES[m].name}
                stroke={SERIES[m].color}
                strokeWidth={m === mode ? 2.25 : 1.5}
                strokeOpacity={m === mode ? 1 : 0.55}
                dot={false}
                isAnimationActive={false}
              />
            ))}
            {circleCount <= xMax && (
              <ReferenceDot x={circleCount} y={Math.max(current, yMin)} r={4.5} fill={SERIES[mode].color} stroke="#fff" strokeWidth={2} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        RMSE는 원본 샘플 z<sub>n</sub>과 재구성 ẑ(n/N)을 같은 매개변수 위치에서 비교한 값으로, 단위는 그리기 캔버스 반폭(= 1)입니다. 파세발 정리에 따라
        RMSE(K)² = (사용하지 않은 성분들의 |c<sub>k</sub>|² 합)이므로 원을 추가할수록 오차는 절대 커지지 않으며, 진폭 순서가 같은 K에서 항상 최소 오차를 줍니다.
        상대 오차는 RMSE를 곡선의 RMS 반지름({scale.toPrecision(3)})으로 나눈 값입니다. {floor.toExponential(0)} 미만의 값은 그래프 바닥에 표시됩니다.
      </p>
    </div>
  );
});
