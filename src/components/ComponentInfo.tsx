// Card describing the selected Fourier component (from a click on a circle or a spectrum bar).

import { useEffect, useRef } from 'react';
import type { Player } from '../core/player';
import { armAngle } from '../math/epicycles';
import type { Coefficient } from '../math/fourier';
import { CloseIcon } from './icons';

const deg = (rad: number) => (rad * 180) / Math.PI;
const signed = (k: number) => (k > 0 ? `+${k}` : String(k));
/** Fixed-point text without a "-0.0000" for tiny negative values. */
const fixed = (v: number, digits: number) => (Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v).toFixed(digits);

interface Props {
  coefficient: Coefficient;
  inUse: boolean;
  amplitudeRank: number | undefined;
  totalRotating: number;
  player: Player;
  onClose: () => void;
}

export function ComponentInfo({ coefficient: c, inUse, amplitudeRank, totalRotating, player, onClose }: Props) {
  const angleRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const update = (t: number) => {
      if (angleRef.current) angleRef.current.textContent = `${deg(armAngle(c.k, c.phase, t)).toFixed(1)}°`;
    };
    update(player.time);
    return player.onFrame(update);
  }, [c, player]);

  const direction = c.k > 0 ? '반시계 방향' : c.k < 0 ? '시계 방향' : '회전하지 않음';
  return (
    <div className="pointer-events-auto rounded-xl border border-amber-300 bg-white/95 p-3 text-xs shadow-sm backdrop-blur" data-testid="component-info">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-semibold text-ink">
          성분 <span className="font-mono">k = {signed(c.k)}</span>
        </span>
        <button type="button" aria-label="선택 해제" onClick={onClose} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-ink">
          <CloseIcon size={14} />
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-slate-600">
        <dt>회전</dt>
        <dd className="text-ink">
          {direction}
          {c.k !== 0 && `, 한 주기에 ${Math.abs(c.k)}바퀴`}
        </dd>
        <dt>반지름 |c<sub>k</sub>|</dt>
        <dd className="font-mono text-ink tabular">{c.amplitude.toPrecision(4)}</dd>
        <dt>초기 위상 arg c<sub>k</sub></dt>
        <dd className="font-mono text-ink tabular">
          {fixed(deg(c.phase), 1)}° ({fixed(c.phase, 3)} rad)
        </dd>
        <dt>현재 각도</dt>
        <dd className="font-mono text-ink tabular">
          <span ref={angleRef} />
        </dd>
        <dt>계수</dt>
        <dd className="font-mono text-ink tabular">
          {fixed(c.re, 4)} {c.im < 0 && fixed(c.im, 4) !== '0.0000' ? '−' : '+'} {fixed(Math.abs(c.im), 4)}i
        </dd>
        {amplitudeRank !== undefined && (
          <>
            <dt>크기 순위</dt>
            <dd className="text-ink tabular">
              {amplitudeRank} / {totalRotating}
            </dd>
          </>
        )}
      </dl>
      {!inUse && <p className="mt-1.5 text-amber-700">현재 K개 안에 포함되지 않은 성분이라 화면에 그려지지 않습니다.</p>}
    </div>
  );
}
