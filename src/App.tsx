import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { registerDebug } from './core/debug';
import { Player } from './core/player';
import { createProject, MAX_PROJECT_BYTES, parseProject, serializeProject } from './core/project';
import { DEFAULT_SETTINGS, clampCircles, type DisplaySettings, type LabSettings } from './core/settings';
import { loadAutosave, saveAutosave } from './core/storage';
import { useAnalysis } from './hooks/useAnalysis';
import { chainTip } from './math/epicycles';
import { preparePath, type PathMode, type Vec2 } from './math/path';
import { DEFAULT_PRESET, getPreset, type PresetId } from './math/presets';
import { downloadBlob, downloadCanvas, renderExport, type ExportKind } from './render/export';
import type { SceneData } from './render/scene';
import { CircleControls } from './components/CircleControls';
import { ComponentInfo } from './components/ComponentInfo';
import type { StrokeEvent } from './components/DrawingCanvas';
import { DrawingPanel, type Notice } from './components/DrawingPanel';
import { ErrorChart } from './components/ErrorChart';
import { Header } from './components/Header';
import { LearnPanel } from './components/LearnPanel';
import { PlaybackControls } from './components/PlaybackControls';
import { SettingsPanel } from './components/SettingsPanel';
import { SpectrumChart } from './components/SpectrumChart';
import { Visualizer, type VisualizerHandle } from './components/Visualizer';
import { Panel, Segmented, cx } from './components/ui';

interface Drawing {
  points: Vec2[] | null;
  /** Preset id, "user" or "file". */
  source: string;
}

interface Analyzed {
  points: Vec2[];
  source: string;
  /** Increments on every new analysis; re-fits the view. */
  id: number;
}

type Tab = 'spectrum' | 'error' | 'learn';

const presetDrawing = (id: PresetId): Drawing & { points: Vec2[] } => ({ points: getPreset(id)!.points, source: id });

function initialState() {
  const saved = loadAutosave();
  if (saved) {
    const analyzed = { points: saved.project.path as Vec2[], source: saved.project.source, id: 1 };
    const drawing: Drawing = saved.draft ? { points: saved.draft, source: 'user' } : analyzed;
    return { settings: saved.project.settings, analyzed, drawing };
  }
  const d = presetDrawing(DEFAULT_PRESET);
  return { settings: DEFAULT_SETTINGS, analyzed: { ...d, id: 1 }, drawing: d as Drawing };
}

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function App() {
  const [init] = useState(initialState);
  const [settings, setSettings] = useState<LabSettings>(init.settings);
  const [history, setHistory] = useState<{ entries: Drawing[]; index: number }>({ entries: [init.drawing], index: 0 });
  const [analyzed, setAnalyzed] = useState<Analyzed>(init.analyzed);
  const [selectedK, setSelectedK] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [tab, setTab] = useState<Tab>('spectrum');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [player] = useState(() => new Player({ speed: init.settings.speed, loop: init.settings.loop }));
  const vizRef = useRef<VisualizerHandle>(null);
  const analysisRef = useRef<HTMLElement>(null);

  const drawing = history.entries[history.index];
  const pending = drawing.points !== analyzed.points;
  const result = useAnalysis(analyzed.points, settings);
  const analysis = result.ok ? result.analysis : null;
  // Charts follow slider changes at low priority so the animation responds first.
  const chartUsed = useDeferredValue(analysis?.selection.frequencies);
  const chartCircles = useDeferredValue(settings.circleCount);
  const chartMode = useDeferredValue(settings.selectionMode);

  // Settings → player.
  useEffect(() => player.setSpeed(settings.speed), [player, settings.speed]);
  useEffect(() => player.setLoop(settings.loop), [player, settings.loop]);

  // Start playing on load (unless the user prefers reduced motion); stop on unmount.
  useEffect(() => {
    if (!prefersReducedMotion()) player.play();
    const onVisible = () => player.resetClock();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      player.pause();
    };
  }, [player]);

  // Best-effort autosave (debounced) so a reload restores the same state.
  useEffect(() => {
    const id = setTimeout(() => saveAutosave(analyzed.points, settings, analyzed.source, pending ? drawing.points : null), 400);
    return () => clearTimeout(id);
  }, [analyzed, settings, pending, drawing.points]);

  const updateSettings = useCallback((patch: Partial<LabSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const updateDisplay = useCallback((patch: Partial<DisplaySettings>) => setSettings((s) => ({ ...s, display: { ...s.display, ...patch } })), []);

  const pushDrawing = useCallback((d: Drawing) => {
    setHistory((h) => ({ entries: [...h.entries.slice(0, h.index + 1), d].slice(-100), index: Math.min(h.index + 1, 99) }));
  }, []);

  /** Analyse `points` and play from the start. Returns false (and shows why) for unusable input. */
  const analyze = useCallback(
    (points: Vec2[], source: string, mode: PathMode = settings.pathMode) => {
      const check = preparePath(points, mode, settings.sampleCount);
      if (!check.ok) {
        setNotice({ kind: 'error', text: check.error.message });
        return false;
      }
      setAnalyzed((a) => ({ points, source, id: a.id + 1 }));
      setSelectedK(null);
      player.seek(0);
      player.play();
      return true;
    },
    [player, settings.pathMode, settings.sampleCount],
  );

  const loadPreset = useCallback(
    (id: PresetId, patch: Partial<LabSettings> = {}) => {
      const d = presetDrawing(id);
      const preset = getPreset(id)!;
      pushDrawing(d);
      setNotice(null);
      updateSettings({ pathMode: preset.mode, ...patch });
      analyze(d.points, id, patch.pathMode ?? preset.mode);
    },
    [analyze, pushDrawing, updateSettings],
  );

  const onStrokeEnd = useCallback(
    ({ points, truncated }: StrokeEvent) => {
      const check = preparePath(points, settings.pathMode, settings.sampleCount);
      if (!check.ok) {
        setNotice({ kind: 'error', text: check.error.message });
        return;
      }
      const replaced = drawing.points !== null;
      pushDrawing({ points: check.path.stroke, source: 'user' });
      if (truncated) setNotice({ kind: 'warning', text: '입력 좌표가 너무 많아 그 지점에서 선을 끝냈습니다.' });
      else if (replaced)
        setNotice({
          kind: 'info',
          text: '한 번에 하나의 이어진 선만 사용합니다. 새 선으로 교체했으며, 이전 그림은 실행 취소로 되돌릴 수 있습니다.',
        });
      else setNotice(null);
    },
    [drawing.points, pushDrawing, settings.pathMode, settings.sampleCount],
  );

  const undo = useCallback(() => setHistory((h) => ({ ...h, index: Math.max(0, h.index - 1) })), []);
  const redo = useCallback(() => setHistory((h) => ({ ...h, index: Math.min(h.entries.length - 1, h.index + 1) })), []);

  const resetAll = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    player.setSpeed(DEFAULT_SETTINGS.speed);
    const d = presetDrawing(DEFAULT_PRESET);
    pushDrawing(d);
    setNotice(null);
    setAnalyzed((a) => ({ ...d, id: a.id + 1 }));
    setSelectedK(null);
    player.seek(0);
    player.play();
  }, [player, pushDrawing]);

  // Keyboard: Space = play/pause, Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) = undo / redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"]') || (e.key === ' ' && target.closest('button, summary')))) return;
      if (e.key === ' ') {
        e.preventDefault();
        player.toggle();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player, undo, redo]);

  const scene = useMemo(
    (): SceneData => ({
      stroke: analysis?.prepared.stroke ?? null,
      mode: settings.pathMode,
      endGap: analysis?.prepared.endGap ?? 0,
      curve: analysis?.curve ?? null,
      chain: analysis?.chain ?? null,
      selectedK,
      display: settings.display,
    }),
    [analysis, settings.pathMode, settings.display, selectedK],
  );

  useEffect(
    () =>
      registerDebug('app', () => ({
        t: player.time,
        playing: player.getState().playing,
        speed: player.getState().speed,
        loop: player.getState().loop,
        circleCount: settings.circleCount,
        sampleCount: settings.sampleCount,
        selectionMode: settings.selectionMode,
        pathMode: settings.pathMode,
        display: settings.display,
        source: analyzed.source,
        analysisId: analyzed.id,
        pending,
        rmse: analysis?.rmse ?? null,
        relativeRmse: analysis ? analysis.rmse / analysis.scale : null,
        selectedK,
        strokePoints: analyzed.points.length,
        drawingPoints: drawing.points?.length ?? 0,
        // ẑ(t) straight from the math module, to compare with the tip drawn on screen.
        tipWorld: analysis ? chainTip(analysis.chain, player.time) : null,
      })),
    [player, settings, analyzed, pending, analysis, selectedK, drawing.points],
  );

  const exportPng = async (kind: ExportKind) => {
    if (!analysis) return;
    try {
      const canvas = renderExport(
        kind,
        scene,
        { caption: `FourierLab · 원 ${settings.circleCount}개 · N = ${settings.sampleCount} · RMSE ${analysis.rmse.toPrecision(3)}` },
        vizRef.current?.layers() ?? null,
      );
      await downloadCanvas(canvas, `fourierlab-${kind === 'current' ? 'view' : kind}.png`);
    } catch (e) {
      setNotice({ kind: 'error', text: `PNG를 만들지 못했습니다: ${(e as Error).message}` });
    }
  };

  const saveProject = () => {
    const project = createProject(analyzed.points, settings, analyzed.source);
    downloadBlob(new Blob([serializeProject(project)], { type: 'application/json' }), 'fourierlab-project.json');
  };

  const loadProject = async (file: File) => {
    if (file.size > MAX_PROJECT_BYTES) {
      setNotice({ kind: 'error', text: '파일이 너무 큽니다(최대 5MB).' });
      return;
    }
    const r = parseProject(await file.text());
    if (!r.ok) {
      setNotice({ kind: 'error', text: `프로젝트를 불러오지 못했습니다: ${r.error}` });
      return;
    }
    const points = r.project.path as Vec2[];
    const check = preparePath(points, r.project.settings.pathMode, r.project.settings.sampleCount);
    if (!check.ok) {
      setNotice({ kind: 'error', text: `프로젝트의 경로를 사용할 수 없습니다: ${check.error.message}` });
      return;
    }
    setSettings(r.project.settings);
    pushDrawing({ points, source: 'file' });
    setAnalyzed((a) => ({ points, source: 'file', id: a.id + 1 }));
    setSelectedK(null);
    setNotice({ kind: 'info', text: `"${file.name}" 프로젝트를 불러왔습니다.` });
    player.seek(0);
    player.play();
  };

  const showLearn = () => {
    setTab('learn');
    analysisRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };

  const selectedCoefficient = analysis && selectedK !== null ? analysis.spectrum.coefficients[analysis.spectrum.indexOf(selectedK)] : null;
  const rel = analysis ? (analysis.rmse / analysis.scale) * 100 : 0;

  const stat = (label: string, value: string, testId?: string) => (
    <span className="rounded-md bg-white/90 px-2 py-1 text-xs text-slate-500 shadow-[0_0_0_1px_rgb(226_232_240)]">
      {label}{' '}
      <b className="font-mono font-semibold text-ink tabular" data-testid={testId}>
        {value}
      </b>
    </span>
  );

  return (
    <div className="min-h-screen">
      <Header onExport={exportPng} onSave={saveProject} onLoad={loadProject} onHelp={showLearn} />

      <main className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[minmax(300px,370px)_minmax(0,1fr)]">
        <Panel className="p-4 lg:col-start-1 lg:row-start-1" aria-label="그림 입력">
          <DrawingPanel
            points={drawing.points}
            source={drawing.source}
            mode={settings.pathMode}
            pending={pending}
            notice={notice}
            canUndo={history.index > 0}
            canRedo={history.index < history.entries.length - 1}
            onMode={(m) => updateSettings({ pathMode: m })}
            onPreset={(id) => loadPreset(id)}
            onUndo={undo}
            onRedo={redo}
            onClear={() => {
              pushDrawing({ points: null, source: 'user' });
              setNotice(null);
            }}
            onReset={resetAll}
            onRun={() => {
              if (drawing.points && analyze(drawing.points, drawing.source)) setNotice(null);
            }}
            onStrokeStart={() => setNotice(null)}
            onStrokeEnd={onStrokeEnd}
            onStrokeCancel={() => setNotice({ kind: 'warning', text: '입력이 중간에 취소되어 그리던 선을 버렸습니다. 다시 그려 주세요.' })}
          />
        </Panel>

        <Panel className="flex flex-col gap-4 p-3 sm:p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1" aria-label="푸리에 시각화">
          <div className="flex items-center justify-between gap-2 px-1">
            <h2 className="text-sm font-semibold text-ink">
              <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] text-white">2</span>
              회전하는 원으로 다시 그리기
            </h2>
            <div className="hidden items-center gap-3 text-[11px] text-slate-500 sm:flex" aria-hidden="true">
              <span className="inline-flex items-center gap-1">
                <i className="h-2 w-2 rounded-full bg-[#e11d48]" /> 펜 끝
              </span>
              <span className="inline-flex items-center gap-1">
                <i className="h-0.5 w-3" style={{ background: settings.display.trailColor }} /> 재구성 궤적
              </span>
              <span className="inline-flex items-center gap-1">
                <i className="h-0.5 w-3 bg-[#a3adbb]" /> 원본
              </span>
            </div>
          </div>
          <div className="relative h-[64vh] max-h-[860px] min-h-[340px] rounded-xl border border-line">
            {analysis ? (
              <Visualizer
                ref={vizRef}
                scene={scene}
                player={player}
                fitKey={String(analyzed.id)}
                onSelect={setSelectedK}
                stats={
                  <>
                    {stat('원', `${settings.circleCount}개`, 'stat-circles')}
                    {stat('RMSE', `${analysis.rmse.toPrecision(3)} (${rel < 0.01 ? rel.toExponential(1) : rel.toPrecision(3)}%)`, 'stat-rmse')}
                    {stat('N', String(settings.sampleCount))}
                    {pending && drawing.points && (
                      <span className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 shadow-[0_0_0_1px_rgb(253_230_138)]">
                        새 그림이 있습니다 → 「재구성 시작」
                      </span>
                    )}
                  </>
                }
                overlay={
                  selectedCoefficient && analysis ? (
                    <ComponentInfo
                      coefficient={selectedCoefficient}
                      inUse={analysis.selection.frequencies.has(selectedCoefficient.k)}
                      amplitudeRank={analysis.amplitudeRank.get(selectedCoefficient.k)}
                      totalRotating={analysis.spectrum.n - 1}
                      player={player}
                      onClose={() => setSelectedK(null)}
                    />
                  ) : undefined
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-sm text-rose-700">{result.ok ? null : result.error}</div>
            )}
          </div>
          <div className="grid gap-x-8 gap-y-5 px-1 xl:grid-cols-2">
            <PlaybackControls
              player={player}
              speed={settings.speed}
              loop={settings.loop}
              sampleCount={settings.sampleCount}
              onSpeed={(speed) => updateSettings({ speed })}
              onLoop={(loop) => updateSettings({ loop })}
            />
            <CircleControls
              settings={settings}
              onCircles={(k) => updateSettings({ circleCount: clampCircles(k, settings.sampleCount) })}
              onSelectionMode={(selectionMode) => updateSettings({ selectionMode })}
              onDisplay={updateDisplay}
            />
          </div>
        </Panel>

        <Panel className="self-start p-4 lg:col-start-1 lg:row-start-2">
          <SettingsPanel
            settings={settings}
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            onSampleCount={(n) => updateSettings({ sampleCount: n, circleCount: clampCircles(settings.circleCount, n) })}
            onChainOrder={(chainOrder) => updateSettings({ chainOrder })}
            onDisplay={updateDisplay}
            onReset={() => setSettings((s) => ({ ...DEFAULT_SETTINGS, pathMode: s.pathMode }))}
          />
        </Panel>

        <Panel ref={analysisRef} className="scroll-mt-4 p-4 lg:col-span-2" aria-label="수학적 분석">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink">
              <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] text-white">3</span>
              수학적 분석
            </h2>
            <div className="w-full sm:w-auto sm:min-w-[22rem]">
              <Segmented<Tab>
                label="분석 보기"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'spectrum', label: '주파수 스펙트럼' },
                  { value: 'error', label: '원 개수와 오차' },
                  { value: 'learn', label: '수학 원리' },
                ]}
              />
            </div>
          </div>
          {analysis && (
            <div className={cx(tab !== 'learn' && 'min-h-[20rem]')}>
              {tab === 'spectrum' && (
                <SpectrumChart spectrum={analysis.spectrum} used={chartUsed ?? analysis.selection.frequencies} selectedK={selectedK} onSelect={setSelectedK} />
              )}
              {tab === 'error' && (
                <ErrorChart errors={analysis.errors} scale={analysis.scale} circleCount={chartCircles} mode={chartMode} />
              )}
              {tab === 'learn' && (
                <LearnPanel
                  n={settings.sampleCount}
                  k={settings.circleCount}
                  rmse={analysis.rmse}
                  scale={analysis.scale}
                  largest={analysis.ranked.amplitude.slice(0, 2)}
                  mode={settings.pathMode}
                  endGap={analysis.prepared.endGap}
                  onTry={(action) => {
                    if (action === 'one') updateSettings({ circleCount: 1 });
                    else if (action === 'many') updateSettings({ circleCount: clampCircles(100, settings.sampleCount) });
                    else if (action === 'select') setSelectedK(analysis.ranked.amplitude[0]?.k ?? null);
                    else if (action === 'open') loadPreset('spiral', { pathMode: 'open', circleCount: 20, selectionMode: 'frequency' });
                  }}
                />
              )}
            </div>
          )}
        </Panel>
      </main>

      <footer className="mx-auto max-w-[1600px] px-4 pt-2 pb-8 text-xs text-muted">
        FourierLab · 모든 계산은 브라우저에서 이루어집니다 ·{' '}
        <a className="underline underline-offset-2 hover:text-ink" href="https://github.com/oyueo-mm/FourierLab">
          GitHub
        </a>
      </footer>
    </div>
  );
}
