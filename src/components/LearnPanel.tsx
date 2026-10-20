// Short Korean explanations, each tied to what is on screen right now.

import type { ReactNode } from 'react';
import type { Coefficient } from '../math/fourier';
import type { PathMode } from '../math/path';

interface Props {
  n: number;
  k: number;
  rmse: number;
  scale: number;
  largest: Coefficient[];
  mode: PathMode;
  endGap: number;
  onTry: (action: 'one' | 'many' | 'open' | 'select') => void;
}

const signed = (k: number) => (k > 0 ? `+${k}` : String(k));

function Topic({ title, children, defaultOpen }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group border-b border-line py-3 last:border-0">
      <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <span className="text-slate-400 transition-transform group-open:rotate-45" aria-hidden="true">
          +
        </span>
      </summary>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </details>
  );
}

const Formula = ({ children }: { children: ReactNode }) => (
  <div className="overflow-x-auto rounded-lg bg-slate-50 px-3 py-2 font-mono text-[13px] whitespace-nowrap text-ink">{children}</div>
);

const Try = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent hover:bg-blue-100">
    {children}
  </button>
);

export function LearnPanel({ n, k, rmse, scale, largest, mode, endGap, onTry }: Props) {
  const top = largest[0];
  const second = largest[1];
  return (
    <div className="text-sm">
      <Topic title="푸리에 급수란?" defaultOpen>
        <p>
          주기적으로 반복되는 신호는 일정한 속도로 회전하는 여러 원(정현파)의 합으로 나타낼 수 있습니다. 이것이 푸리에 급수입니다. 이 실험실에서는 그림을 한 바퀴 따라가는
          점의 움직임을 하나의 주기 신호로 보고, 그것을 회전하는 원들로 분해합니다.
        </p>
        <Formula>ẑ(t) = Σ c_k · e^(i·2πkt),  0 ≤ t &lt; 1</Formula>
        <p>
          지금 화면에서는 <b>{k}</b>개의 원(그리고 고정된 중심 이동 c₀)으로 그림을 다시 그리고 있습니다.
        </p>
      </Topic>

      <Topic title="왜 2차원 좌표를 복소수로 표현할까?">
        <p>
          점 (x, y)를 복소수 z = x + iy 하나로 쓰면, 평면 위의 움직임 전체가 하나의 복소수 신호 z(t)가 됩니다. 그리고 e^(iθ)는 길이 1인 화살표를 각도 θ만큼 돌려 놓은
          것이므로, 회전을 곱셈 하나로 표현할 수 있습니다. 그래서 x, y를 따로 다루지 않고 한 번의 변환으로 모든 원을 구할 수 있습니다.
        </p>
        <p>화면 Canvas는 y축이 아래로 향하지만, 계산은 y축이 위로 향하는 수학 좌표계에서 하고 그릴 때만 뒤집습니다.</p>
      </Topic>

      <Topic title="주파수 k의 의미와 회전 방향">
        <p>
          k는 그림을 한 번 그리는 동안 그 원이 몇 바퀴 도는지를 뜻합니다. k = +3인 원은 한 주기에 반시계 방향으로 3바퀴, k = −3인 원은 시계 방향으로 3바퀴 돕니다.
        </p>
        <p>
          실수 신호와 달리 그림은 복소수 신호이므로 +k와 −k의 크기가 서로 다릅니다. 스펙트럼 그래프에서 남색은 반시계(+), 청록색은 시계(−) 방향 원입니다.
        </p>
      </Topic>

      <Topic title="원의 크기와 진폭, 위상">
        <p>
          원의 반지름은 계수의 크기 |c<sub>k</sub>|(진폭)이고, t = 0일 때 화살표가 가리키는 각도는 arg c<sub>k</sub>(위상)입니다. 시간이 흐르면 각도는 2πkt + arg c
          <sub>k</sub>로 변합니다.
        </p>
        {top && (
          <p>
            지금 그림에서 가장 큰 원은 <b className="font-mono">k = {signed(top.k)}</b>, 반지름 <b className="font-mono">{top.amplitude.toFixed(3)}</b>
            {second && (
              <>
                , 두 번째는 <b className="font-mono">k = {signed(second.k)}</b>(반지름 {second.amplitude.toFixed(3)})
              </>
            )}
            입니다. <Try onClick={() => onTry('select')}>가장 큰 원 강조하기</Try>
          </p>
        )}
      </Topic>

      <Topic title="원을 많이 사용하면 왜 더 정교해질까?">
        <p>
          큰 원은 그림의 전체적인 윤곽을, 빠르게 도는 작은 원은 모서리 같은 세밀한 부분을 담당합니다. 원을 하나 더할 때마다 빠진 성분의 에너지가 줄어들기 때문에 오차는
          작아지기만 합니다(파세발 정리).
        </p>
        <Formula>RMSE(K)² = Σ_(사용하지 않은 k) |c_k|²</Formula>
        <p>
          현재 RMSE는 <b className="font-mono">{rmse.toPrecision(3)}</b>(곡선 크기 대비 {((rmse / scale) * 100).toPrecision(3)}%)입니다. N = {n}개의 원을 모두 사용하면
          원본 샘플이 반올림 오차 수준으로 정확히 복원됩니다.
        </p>
        <div className="flex flex-wrap gap-2">
          <Try onClick={() => onTry('one')}>원 1개로 보기</Try>
          <Try onClick={() => onTry('many')}>원 100개로 보기</Try>
        </div>
      </Topic>

      <Topic title="열린 곡선에서는 왜 연결선이나 진동이 생길까?">
        <p>
          푸리에 급수는 같은 모양이 끝없이 반복된다고 가정합니다. 시작점과 끝점이 떨어진 선은 반복할 때 끝점에서 시작점으로 순간 이동해야 하므로, 이 불연속을 매끄러운 원들로
          흉내 내다 보면 그 근처가 출렁입니다(깁스 현상).
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>닫힌 경로</b>(기본): 끝점과 시작점을 직선으로 이어 연속인 폐곡선으로 만듭니다. 점선이 추가된 연결선입니다.
          </li>
          <li>
            <b>왕복 경로</b>: 선을 따라갔다가 되돌아옵니다. 새 선분은 없지만 모든 부분을 두 번 그립니다.
          </li>
          <li>
            <b>열린 경로</b>: 불연속을 그대로 둡니다. 원 개수가 적을 때 끝부분의 진동을 관찰할 수 있습니다.
          </li>
        </ul>
        <p>
          현재 그림의 끝점과 시작점 사이 거리는 <b className="font-mono">{endGap.toFixed(3)}</b>, 처리 방식은{' '}
          <b>{mode === 'closed' ? '닫힌 경로' : mode === 'retrace' ? '왕복 경로' : '열린 경로'}</b>입니다.{' '}
          <Try onClick={() => onTry('open')}>나선 예제로 비교하기</Try>
        </p>
      </Topic>

      <Topic title="DFT와 FFT의 차이">
        <p>
          사용자가 그린 선은 호 길이 기준으로 같은 간격의 N = {n}개 점 z<sub>n</sub>으로 다시 샘플링됩니다. 그 점들에 이산 푸리에 변환(DFT)을 적용해 계수를 얻습니다.
        </p>
        <Formula>c_k = (1/N) Σ_(n=0..N−1) z_n · e^(−i·2πkn/N)</Formula>
        <p>
          식 그대로 계산하면 N² = {(n * n).toLocaleString()}번의 곱셈이 필요합니다. 고속 푸리에 변환(FFT)은 같은 결과를 대칭성을 이용해 약 N·log₂N ={' '}
          {(n * Math.log2(n)).toLocaleString()}번 수준으로 계산합니다. FourierLab은 직접 구현한 기수-2 FFT를 사용하고, 느린 DFT 참조 구현과 결과를 비교해 검증합니다.
        </p>
      </Topic>
    </div>
  );
}
