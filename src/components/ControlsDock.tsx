// The control area under the animation.
//
// Phones and tablets: one column — transport, timeline, circle count, then a "더보기" group
// (speed, component selection, display options) that is collapsed by default.
// Desktop (lg+): three columns, everything visible. The group wrapper uses `display: contents`
// there, so its children are placed directly in the grid.

import { useState } from 'react';
import type { Player } from '../core/player';
import type { DisplaySettings, LabSettings } from '../core/settings';
import type { SelectionMode } from '../math/selection';
import { CircleCountControl, DisplayChips, SelectionControl } from './CircleControls';
import { ChevronIcon } from './icons';
import { SpeedRow, TimelineRow, TransportRow } from './PlaybackControls';
import { cx } from './ui';

interface Props {
  player: Player;
  settings: LabSettings;
  onSpeed: (s: number) => void;
  onLoop: (loop: boolean) => void;
  onCirclePreview: (k: number) => void;
  onCircleCommit: (k: number) => void;
  onSelectionMode: (m: SelectionMode) => void;
  onDisplay: (patch: Partial<DisplaySettings>) => void;
}

export function ControlsDock({ player, settings, onSpeed, onLoop, onCirclePreview, onCircleCommit, onSelectionMode, onDisplay }: Props) {
  const [more, setMore] = useState(false);
  return (
    <section
      aria-label="재생 및 원 개수 조절"
      data-testid="controls-dock"
      className="rounded-2xl border border-line bg-white px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_1px_2px_rgb(15_23_42/0.04)] sm:px-4 sm:pt-4 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:gap-y-3 lg:grid-cols-3 lg:grid-rows-[auto_auto_auto]">
        <TransportRow player={player} loop={settings.loop} sampleCount={settings.sampleCount} onLoop={onLoop} className="lg:col-start-1 lg:row-start-1" />
        <div className="lg:col-start-1 lg:row-start-2">
          <TimelineRow player={player} speed={settings.speed} />
        </div>
        <div className="lg:col-start-2 lg:row-span-3 lg:row-start-1">
          <CircleCountControl sampleCount={settings.sampleCount} count={settings.circleCount} onPreview={onCirclePreview} onCommit={onCircleCommit} />
        </div>

        <div id="dock-more" className={cx(more ? 'contents' : 'hidden', 'lg:contents')}>
          <div className="lg:col-start-1 lg:row-start-3">
            <SpeedRow speed={settings.speed} onSpeed={onSpeed} />
          </div>
          <div className="lg:col-start-3 lg:row-start-1">
            <SelectionControl value={settings.selectionMode} onChange={onSelectionMode} />
          </div>
          <div className="lg:col-start-3 lg:row-span-2 lg:row-start-2">
            <DisplayChips display={settings.display} onDisplay={onDisplay} />
          </div>
        </div>
      </div>

      <button
        type="button"
        aria-expanded={more}
        aria-controls="dock-more"
        data-testid="dock-more-toggle"
        onClick={() => setMore((m) => !m)}
        className="flex h-11 w-full items-center justify-center gap-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 lg:hidden"
      >
        {more ? '접기' : `속도 ${settings.speed.toFixed(1)}× · 성분 선택 · 표시 옵션`}
        <ChevronIcon className={cx('transition-transform', more && 'rotate-180')} />
      </button>
    </section>
  );
}
