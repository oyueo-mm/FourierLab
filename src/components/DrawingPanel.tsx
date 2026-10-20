import type { PathMode, Vec2 } from '../math/path';
import { PRESETS, type PresetId } from '../math/presets';
import { DrawingCanvas, type StrokeEvent } from './DrawingCanvas';
import { EraseIcon, RedoIcon, SparkIcon, UndoIcon } from './icons';
import { Button, IconButton, Segmented, cx } from './ui';

export interface Notice {
  kind: 'error' | 'warning' | 'info';
  text: string;
}

interface Props {
  points: readonly Vec2[] | null;
  source: string;
  mode: PathMode;
  pending: boolean;
  notice: Notice | null;
  canUndo: boolean;
  canRedo: boolean;
  onMode: (m: PathMode) => void;
  onPreset: (id: PresetId) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onReset: () => void;
  onRun: () => void;
  onStrokeStart: () => void;
  onStrokeEnd: (e: StrokeEvent) => void;
  onStrokeCancel: () => void;
}

const MODE_HELP: Record<PathMode, string> = {
  closed: '끝점과 시작점을 직선(점선 표시)으로 이어 폐곡선으로 만듭니다.',
  retrace: '선을 따라갔다가 같은 길로 되돌아옵니다. 연결선은 없지만 모든 부분을 두 번 그립니다.',
  open: '끝점에서 시작점으로 순간 이동하는 불연속이 생깁니다. 그 근처에서 진동(깁스 현상)을 관찰할 수 있습니다.',
};

export function DrawingPanel(p: Props) {
  const preset = PRESETS.find((x) => x.id === p.source);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] text-white">1</span>
          그림 그리기
        </h2>
        <div className="flex gap-1">
          <IconButton label="실행 취소 (Ctrl+Z)" onClick={p.onUndo} disabled={!p.canUndo}>
            <UndoIcon />
          </IconButton>
          <IconButton label="다시 실행 (Ctrl+Y)" onClick={p.onRedo} disabled={!p.canRedo}>
            <RedoIcon />
          </IconButton>
          <IconButton label="지우기" onClick={p.onClear} disabled={!p.points}>
            <EraseIcon />
          </IconButton>
        </div>
      </div>

      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-line bg-white">
        <DrawingCanvas points={p.points} mode={p.mode} onStrokeStart={p.onStrokeStart} onStrokeEnd={p.onStrokeEnd} onStrokeCancel={p.onStrokeCancel} />
        {!p.points && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-400">
            여기에 한 번에 이어지는 선을 그려 보세요.
            <br />
            손을 떼면 하나의 선이 완성됩니다.
          </div>
        )}
        <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-white/85 px-1.5 py-0.5 text-[11px] text-slate-500">
          <i className="h-2 w-2 rounded-full bg-emerald-600" /> 시작점
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-500">예제</div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((x) => (
            <button
              key={x.id}
              type="button"
              data-testid={`preset-${x.id}`}
              onClick={() => p.onPreset(x.id)}
              aria-pressed={p.source === x.id}
              className={cx(
                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                p.source === x.id ? 'border-accent bg-accent text-white' : 'border-line bg-white text-slate-600 hover:border-slate-300 hover:text-ink',
              )}
            >
              {x.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-500">경로 처리 방식</div>
        <Segmented<PathMode>
          label="경로 처리 방식"
          size="sm"
          value={p.mode}
          onChange={p.onMode}
          options={[
            { value: 'closed', label: '닫힌 경로' },
            { value: 'retrace', label: '왕복 경로' },
            { value: 'open', label: '열린 경로' },
          ]}
        />
        <p className="mt-1.5 text-xs leading-relaxed text-muted">{MODE_HELP[p.mode]}</p>
      </div>

      {p.notice && (
        <p
          role={p.notice.kind === 'error' ? 'alert' : 'status'}
          data-testid="notice"
          className={cx(
            'rounded-lg px-3 py-2 text-xs leading-relaxed',
            p.notice.kind === 'error' && 'bg-rose-50 text-rose-700',
            p.notice.kind === 'warning' && 'bg-amber-50 text-amber-800',
            p.notice.kind === 'info' && 'bg-slate-100 text-slate-700',
          )}
        >
          {p.notice.text}
        </p>
      )}
      {!p.notice && preset?.note && <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs leading-relaxed text-slate-700">{preset.note}</p>}

      <Button
        variant="primary"
        className={cx('w-full', p.pending && p.points && 'ring-4 ring-accent/20')}
        onClick={p.onRun}
        disabled={!p.points}
        data-testid="run"
      >
        <SparkIcon />
        {p.pending ? '푸리에 변환 · 재구성 시작' : '재구성 다시 시작'}
      </Button>
      <div className="flex justify-end">
        <button type="button" onClick={p.onReset} className="text-xs text-slate-500 underline-offset-2 hover:text-ink hover:underline">
          전체 초기화
        </button>
      </div>
    </div>
  );
}
