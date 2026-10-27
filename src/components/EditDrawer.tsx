// Drawing editor as a modal drawer: full screen on phones, a ~36 rem panel on larger screens.
//
// The drawer stays mounted while closed (hidden with `visibility` + `inert`), so its canvas keeps
// its size and the drawing state lives in App: opening/closing never recomputes anything and a
// stroke that was drawn but not applied survives closing.

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { PathMode, Vec2 } from '../math/path';
import { PRESETS, type PresetId } from '../math/presets';
import { DrawingCanvas, type StrokeEvent } from './DrawingCanvas';
import { CloseIcon, EraseIcon, RedoIcon, SparkIcon, UndoIcon } from './icons';
import { ImageImport, type ImageRequest } from './ImageImport';
import { Button, IconButton, Segmented, cx } from './ui';

export type EditorTab = 'draw' | 'image';

export interface Notice {
  kind: 'error' | 'warning' | 'info';
  text: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Element that gets the focus back when the drawer closes. */
  returnFocus: () => HTMLElement | null;
  points: readonly Vec2[] | null;
  source: string;
  mode: PathMode;
  /** The drawing differs from what the animation currently shows. */
  pending: boolean;
  tab: EditorTab;
  onTab: (tab: EditorTab) => void;
  /** Latest image handed over by the header, a drop or a paste. */
  imageRequest: ImageRequest | null;
  onImageApply: (points: Vec2[]) => void;
  notice: Notice | null;
  canUndo: boolean;
  canRedo: boolean;
  onMode: (m: PathMode) => void;
  onPreset: (id: PresetId) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onReset: () => void;
  /** "재구성 다시 시작": apply the drawing and keep the drawer open. */
  onRestart: () => void;
  /** "편집 완료 · 재구성": apply the drawing and close the drawer. */
  onApply: () => void;
  onStrokeStart: () => void;
  onStrokeEnd: (e: StrokeEvent) => void;
  onStrokeCancel: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal behaviour: focus moves in, Tab wraps, Esc closes, focus returns, page scroll is locked. */
function useModal(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, returnFocus: () => HTMLElement | null) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const returnRef = useRef(returnFocus);
  returnRef.current = returnFocus;

  useEffect(() => {
    if (!open) return;
    const root = ref.current;
    if (!root) return;
    const items = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
    // Start on the close button (first control): a screen-reader user hears the title first.
    items()[0]?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const list = items();
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active || !root.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      returnRef.current()?.focus();
    };
  }, [open, ref]);
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500">{children}</div>;
}

export function EditDrawer(p: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useModal(panelRef, p.open, p.onClose, p.returnFocus);
  // Reopening always starts at the canvas, not wherever the list was scrolled to last time.
  useEffect(() => {
    if (p.open && bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [p.open]);

  return (
    <div
      // Opening is instant (so focus can move in at once); closing keeps the panel visible while it slides out.
      className={cx('fixed inset-x-0 top-0 z-40 h-dvh', p.open ? 'visible' : 'invisible transition-[visibility] duration-200 motion-reduce:duration-0')}
      data-testid="edit-drawer-root"
    >
      <div
        aria-hidden="true"
        onClick={p.onClose}
        data-testid="edit-backdrop"
        className={cx('absolute inset-0 bg-slate-900/40 transition-opacity duration-200 motion-reduce:transition-none', p.open ? 'opacity-100' : 'opacity-0')}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-title"
        inert={!p.open}
        data-testid="edit-drawer"
        data-open={p.open}
        className={cx(
          'absolute inset-y-0 left-0 flex w-full flex-col bg-white shadow-2xl sm:w-[min(36rem,100vw)]',
          'transition-transform duration-200 ease-out motion-reduce:transition-none',
          p.open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
          <h2 id="edit-title" className="text-base font-semibold text-ink">
            그림 편집
          </h2>
          <IconButton label="그림 편집 닫기 (Esc)" data-testid="edit-close" onClick={p.onClose}>
            <CloseIcon />
          </IconButton>
        </header>

        <div ref={bodyRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          <Segmented<EditorTab>
            label="입력 방식"
            value={p.tab}
            onChange={p.onTab}
            options={[
              { value: 'draw', label: '직접 그리기' },
              { value: 'image', label: '이미지' },
            ]}
          />

          {/* Both panes stay mounted: switching never discards the stroke or the uploaded image. */}
          <div hidden={p.tab !== 'image'}>
            <ImageImport request={p.imageRequest} onApply={p.onImageApply} />
          </div>

          <div hidden={p.tab !== 'draw'} className="space-y-4">
          <div
            className="relative mx-auto aspect-square overflow-hidden rounded-xl border border-line bg-white"
            style={{ width: 'min(100%, max(18rem, calc(100dvh - 16rem)))' }}
            data-testid="drawing-frame"
          >
            <DrawingCanvas points={p.points} mode={p.mode} onStrokeStart={p.onStrokeStart} onStrokeEnd={p.onStrokeEnd} onStrokeCancel={p.onStrokeCancel} />
            {!p.points && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-400">
                여기에 선을 그리세요
              </div>
            )}
            <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-white/85 px-1.5 py-0.5 text-[11px] text-slate-500">
              <i className="h-2 w-2 rounded-full bg-emerald-600" /> 시작점
            </div>
          </div>

          <div className="flex items-center justify-center gap-2">
            <IconButton large label="실행 취소 (Ctrl+Z)" data-testid="undo" onClick={p.onUndo} disabled={!p.canUndo}>
              <UndoIcon />
            </IconButton>
            <IconButton large label="다시 실행 (Ctrl+Y)" data-testid="redo" onClick={p.onRedo} disabled={!p.canRedo}>
              <RedoIcon />
            </IconButton>
            <Button className="h-11" onClick={p.onClear} disabled={!p.points} data-testid="clear">
              <EraseIcon size={16} />
              지우기
            </Button>
            <Button variant="ghost" className="h-11" onClick={p.onReset} data-testid="reset-all">
              전체 초기화
            </Button>
          </div>

          <div>
            <SectionLabel>예제</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  data-testid={`preset-${x.id}`}
                  onClick={() => p.onPreset(x.id)}
                  aria-pressed={p.source === x.id}
                  className={cx(
                    'h-10 rounded-full border px-3.5 text-sm font-medium transition-colors',
                    p.source === x.id ? 'border-accent bg-accent text-white' : 'border-line bg-white text-slate-600 hover:border-slate-300 hover:text-ink',
                  )}
                >
                  {x.name}
                </button>
              ))}
            </div>
          </div>
          </div>

          {p.notice && (
            <p
              role={p.notice.kind === 'error' ? 'alert' : 'status'}
              data-testid="notice"
              className={cx(
                'rounded-lg px-3 py-2 text-sm leading-relaxed',
                p.notice.kind === 'error' && 'bg-rose-50 text-rose-700',
                p.notice.kind === 'warning' && 'bg-amber-50 text-amber-800',
                p.notice.kind === 'info' && 'bg-slate-100 text-slate-700',
              )}
            >
              {p.notice.text}
            </p>
          )}
          {p.pending && p.points && p.notice?.kind !== 'error' && (
            <p data-testid="pending-note" className="rounded-lg bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-800">
              아직 적용하지 않은 그림입니다.
            </p>
          )}

          <div>
            <SectionLabel>경로 처리 방식</SectionLabel>
            <Segmented<PathMode>
              label="경로 처리 방식"
              value={p.mode}
              onChange={p.onMode}
              options={[
                { value: 'closed', label: '닫힌 경로' },
                { value: 'retrace', label: '왕복 경로' },
                { value: 'open', label: '열린 경로' },
              ]}
            />
          </div>
        </div>

        <footer hidden={p.tab === 'image'} className="grid shrink-0 grid-cols-[1fr_1.4fr] gap-2 border-t border-line bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button className="h-12" onClick={p.onRestart} disabled={!p.points} data-testid="run">
            재구성 다시 시작
          </Button>
          <Button variant="primary" className="h-12" onClick={p.onApply} data-testid="apply-close">
            <SparkIcon />
            편집 완료 · 재구성
          </Button>
        </footer>
      </aside>
    </div>
  );
}
