// Right-hand settings sidebar.
//
// Desktop (lg+): an in-flow column that shares the work area with the canvas; its width animates
// between 0 and 22.5 rem. Below lg it is an overlay panel sliding in from the right (full width
// on phones) with a backdrop. The content stays mounted when closed (hidden with `inert`), so
// opening or closing never touches the player or any setting.

import { useDeferredValue, useState, type ReactNode } from 'react';
import type { Player } from '../core/player';
import type { DisplaySettings, LabSettings } from '../core/settings';
import type { Analysis } from '../hooks/useAnalysis';
import type { SampleCount } from '../math/path';
import type { ChainOrder, SelectionMode } from '../math/selection';
import { CircleCountControl, DisplayChips, SelectionControl } from './CircleControls';
import { ErrorChart } from './ErrorChart';
import { ChevronIcon, CloseIcon } from './icons';
import { SpeedRow, TimelineRow, TransportRow } from './PlaybackControls';
import { SettingsPanel } from './SettingsPanel';
import { SpectrumChart } from './SpectrumChart';
import { IconButton, Segmented, cx } from './ui';

type AnalysisTab = 'spectrum' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
  player: Player;
  settings: LabSettings;
  analysis: Analysis | null;
  selectedK: number | null;
  onSelectK: (k: number | null) => void;
  onSpeed: (s: number) => void;
  onLoop: (loop: boolean) => void;
  onCirclePreview: (k: number) => void;
  onCircleCommit: (k: number) => void;
  onSelectionMode: (m: SelectionMode) => void;
  onDisplay: (patch: Partial<DisplaySettings>) => void;
  onSampleCount: (n: SampleCount) => void;
  onChainOrder: (o: ChainOrder) => void;
  onResetSettings: () => void;
  advancedOpen: boolean;
  onAdvancedOpen: (open: boolean) => void;
  analysisOpen: boolean;
  onAnalysisOpen: (open: boolean) => void;
}

function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('space-y-3 border-b border-line px-4 py-4', className)}>{children}</section>;
}

function Disclosure({ title, open, onOpenChange, testId, id, children }: { title: string; open: boolean; onOpenChange: (o: boolean) => void; testId?: string; id: string; children: ReactNode }) {
  return (
    <section className="border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        data-testid={testId}
        onClick={() => onOpenChange(!open)}
        className="flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left text-sm font-semibold text-ink hover:bg-slate-50"
      >
        {title}
        <ChevronIcon className={cx('text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div id={id} className="px-4 pt-1 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}

export function Sidebar(p: Props) {
  const { analysis, settings } = p;
  const [tab, setTab] = useState<AnalysisTab>('spectrum');
  // Charts follow slider changes at low priority so the animation responds first.
  const chartUsed = useDeferredValue(analysis?.selection.frequencies);
  const chartCircles = useDeferredValue(settings.circleCount);
  const chartMode = useDeferredValue(settings.selectionMode);

  return (
    <>
      <div
        aria-hidden="true"
        onClick={p.onClose}
        data-testid="sidebar-backdrop"
        className={cx(
          'fixed inset-0 z-30 bg-slate-900/40 transition-opacity duration-200 lg:hidden',
          p.open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        id="sidebar"
        aria-label="설정"
        inert={!p.open}
        data-testid="sidebar"
        data-open={p.open}
        className={cx(
          'bg-white',
          // lg+: in-flow column, width animates.
          'lg:relative lg:shrink-0 lg:overflow-hidden lg:transition-[width] lg:duration-200 lg:ease-out',
          p.open ? 'lg:w-[22.5rem] lg:border-l lg:border-line' : 'lg:w-0',
          // < lg: overlay from the right.
          'max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-[min(24rem,100vw)] max-lg:transition-transform max-lg:duration-200 max-lg:ease-out',
          p.open ? 'max-lg:translate-x-0 max-lg:shadow-2xl' : 'max-lg:translate-x-full',
        )}
      >
        {/* Fixed inner width: the content does not reflow while the column animates. */}
        <div className="flex h-full w-full flex-col lg:w-[22.5rem]">
          <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-4 pt-[env(safe-area-inset-top)] max-lg:h-[calc(3rem+env(safe-area-inset-top))]">
            <h2 className="text-sm font-semibold text-ink">설정</h2>
            <IconButton label="사이드바 닫기" data-testid="sidebar-close" onClick={p.onClose}>
              <CloseIcon />
            </IconButton>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
            <Section>
              <TransportRow player={p.player} loop={settings.loop} sampleCount={settings.sampleCount} onLoop={p.onLoop} />
              <TimelineRow player={p.player} speed={settings.speed} />
              <SpeedRow speed={settings.speed} onSpeed={p.onSpeed} />
            </Section>

            <Section>
              <CircleCountControl sampleCount={settings.sampleCount} count={settings.circleCount} onPreview={p.onCirclePreview} onCommit={p.onCircleCommit} />
              <SelectionControl value={settings.selectionMode} onChange={p.onSelectionMode} />
            </Section>

            <Section>
              <DisplayChips display={settings.display} onDisplay={p.onDisplay} />
            </Section>

            <Disclosure title="고급 설정" id="advanced-body" open={p.advancedOpen} onOpenChange={p.onAdvancedOpen} testId="advanced-toggle">
              <SettingsPanel
                settings={settings}
                onSampleCount={p.onSampleCount}
                onChainOrder={p.onChainOrder}
                onDisplay={p.onDisplay}
                onReset={p.onResetSettings}
              />
            </Disclosure>

            <Disclosure title="수학적 분석" id="analysis-body" open={p.analysisOpen} onOpenChange={p.onAnalysisOpen} testId="analysis-toggle">
              {analysis && (
                <div className="space-y-3">
                  <Segmented<AnalysisTab>
                    label="분석 보기"
                    size="sm"
                    value={tab}
                    onChange={setTab}
                    options={[
                      { value: 'spectrum', label: '주파수 스펙트럼' },
                      { value: 'error', label: '원 개수와 오차' },
                    ]}
                  />
                  <div className="min-h-[18rem]">
                    {tab === 'spectrum' ? (
                      <SpectrumChart spectrum={analysis.spectrum} used={chartUsed ?? analysis.selection.frequencies} selectedK={p.selectedK} onSelect={p.onSelectK} />
                    ) : (
                      <ErrorChart errors={analysis.errors} scale={analysis.scale} circleCount={chartCircles} mode={chartMode} />
                    )}
                  </div>
                </div>
              )}
            </Disclosure>
          </div>
        </div>
      </aside>
    </>
  );
}
