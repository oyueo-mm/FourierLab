import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import { registerDebug } from './core/debug';
import { Player } from './core/player';
import { createProject, MAX_PROJECT_BYTES, parseProject, serializeProject } from './core/project';
import { DEFAULT_SETTINGS, clampCircles, type DisplaySettings, type LabSettings } from './core/settings';
import { loadAutosave, saveAutosave } from './core/storage';
import { useAnalysis } from './hooks/useAnalysis';
import { chainTip } from './math/epicycles';
import { preparePath, type PathMode, type Vec2 } from './math/path';
import { DEFAULT_PRESET, getPreset, type PresetId } from './math/presets';
import type { SelectionMode } from './math/selection';
import { downloadBlob, downloadCanvas, renderExport, type ExportKind } from './render/export';
import type { SceneData } from './render/scene';
import { checkFile } from './image/load';
import { ComponentInfo } from './components/ComponentInfo';
import type { StrokeEvent } from './components/DrawingCanvas';
import { EditDrawer, type EditorTab, type Notice } from './components/EditDrawer';
import { Header } from './components/Header';
import { PauseIcon, PlayIcon, ReplayIcon, StepBackIcon, StepForwardIcon } from './components/icons';
import type { ImageRequest } from './components/ImageImport';
import { Sidebar } from './components/Sidebar';
import { Toast, type ToastMessage } from './components/Toast';
import { Visualizer, type VisualizerHandle } from './components/Visualizer';
import { Button, IconButton, cx } from './components/ui';

interface Drawing {
  points: Vec2[] | null;
  /** Preset id, "user" or "file". */
  source: string;
  /** How the stroke is closed when it is analysed; chosen in the editor together with the stroke. */
  mode: PathMode;
}

interface Analyzed {
  points: Vec2[];
  source: string;
  /** Increments on every new analysis; re-fits the view. */
  id: number;
}

const presetDrawing = (id: PresetId): Drawing & { points: Vec2[] } => {
  const preset = getPreset(id)!;
  return { points: preset.points, source: id, mode: preset.mode };
};

function initialState() {
  const saved = loadAutosave();
  if (saved) {
    const analyzed = { points: saved.project.path as Vec2[], source: saved.project.source, id: 1 };
    const drawing: Drawing = saved.draft
      ? { points: saved.draft.points, source: 'user', mode: saved.draft.mode }
      : { ...analyzed, mode: saved.project.settings.pathMode };
    return { settings: saved.project.settings, analyzed, drawing };
  }
  const d = presetDrawing(DEFAULT_PRESET);
  return { settings: DEFAULT_SETTINGS, analyzed: { points: d.points, source: d.source, id: 1 }, drawing: d as Drawing };
}

const isDesktop = () => typeof matchMedia === 'function' && matchMedia('(min-width: 1024px)').matches;

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function App() {
  const [init] = useState(initialState);
  const [settings, setSettings] = useState<LabSettings>(init.settings);
  const [history, setHistory] = useState<{ entries: Drawing[]; index: number }>({ entries: [init.drawing], index: 0 });
  const [analyzed, setAnalyzed] = useState<Analyzed>(init.analyzed);
  const [selectedK, setSelectedK] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<EditorTab>('draw');
  const [imageRequest, setImageRequest] = useState<ImageRequest | null>(null);
  const [player] = useState(() => new Player({ speed: init.settings.speed, loop: init.settings.loop }));
  const vizRef = useRef<VisualizerHandle>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const drawing = history.entries[history.index];
  /** The editor holds a drawing (or a path mode) that the animation does not show yet. */
  const dirty = drawing.points !== analyzed.points || drawing.mode !== settings.pathMode;
  const pending = dirty && drawing.points !== null;
  const result = useAnalysis(analyzed.points, settings);
  const analysis = result.ok ? result.analysis : null;

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

  // Best-effort autosave (debounced) so a reload restores the same state, including an unapplied stroke.
  useEffect(() => {
    const id = setTimeout(
      () => saveAutosave(analyzed.points, settings, analyzed.source, pending && drawing.points ? { points: drawing.points, mode: drawing.mode } : null),
      400,
    );
    return () => clearTimeout(id);
  }, [analyzed, settings, pending, drawing.points, drawing.mode]);

  const updateSettings = useCallback((patch: Partial<LabSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const updateDisplay = useCallback((patch: Partial<DisplaySettings>) => setSettings((s) => ({ ...s, display: { ...s.display, ...patch } })), []);
  const showToast = useCallback((kind: ToastMessage['kind'], text: string) => setToast({ id: Date.now(), kind, text }), []);
  const dismissToast = useCallback(() => setToast(null), []);

  const pushDrawing = useCallback((d: Drawing) => {
    setHistory((h) => ({ entries: [...h.entries.slice(0, h.index + 1), d].slice(-100), index: Math.min(h.index + 1, 99) }));
  }, []);

  // ── circle count / component selection: every committed change redraws from t = 0 ──
  // FFT results are reused: only `selected` in useAnalysis reruns.
  const previewCircles = useCallback(
    (k: number) => updateSettings({ circleCount: clampCircles(k, settings.sampleCount) }),
    [updateSettings, settings.sampleCount],
  );
  const commitCircles = useCallback(
    (k: number) => {
      updateSettings({ circleCount: clampCircles(k, settings.sampleCount) });
      player.restart();
    },
    [player, updateSettings, settings.sampleCount],
  );
  const changeSelectionMode = useCallback(
    (selectionMode: SelectionMode) => {
      updateSettings({ selectionMode });
      player.restart();
    },
    [player, updateSettings],
  );
  const changeSampleCount = useCallback(
    (n: LabSettings['sampleCount']) => {
      updateSettings({ sampleCount: n, circleCount: clampCircles(settings.circleCount, n) });
      player.restart();
    },
    [player, updateSettings, settings.circleCount],
  );

  /** Analyse `points` and play from the start. Returns false (and shows why) for unusable input. */
  const analyze = useCallback(
    (points: Vec2[], source: string, mode: PathMode) => {
      const check = preparePath(points, mode, settings.sampleCount);
      if (!check.ok) {
        setNotice({ kind: 'error', text: check.error.message });
        return false;
      }
      setAnalyzed((a) => ({ points, source, id: a.id + 1 }));
      updateSettings({ pathMode: mode });
      setSelectedK(null);
      player.restart();
      player.play();
      return true;
    },
    [player, settings.sampleCount, updateSettings],
  );

  const closeEditor = useCallback(() => setEditorOpen(false), []);
  const openEditor = useCallback(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    setNotice(null);
    setEditorOpen(true);
  }, []);
  const returnFocus = useCallback(() => {
    const el = openerRef.current;
    return el && el !== document.body && document.contains(el) ? el : document.getElementById('open-editor');
  }, []);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((o) => !o), []);

  /** An image arrived (header button, drop or paste): open the editor on the image tab. */
  const requestImage = useCallback(
    (file: File) => {
      const problem = checkFile(file);
      if (problem) {
        setToast({ id: Date.now(), kind: 'error', text: problem });
        return;
      }
      setImageRequest((r) => ({ file, id: (r?.id ?? 0) + 1 }));
      setEditorTab('image');
      openEditor();
    },
    [openEditor],
  );

  // Pasting an image anywhere (outside text fields) loads it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        requestImage(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [requestImage]);

  const onStageDrop = (e: DragEvent) => {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    requestImage(file);
  };

  /** Apply the editor's drawing to the animation. */
  const applyDrawing = useCallback(
    (close: boolean) => {
      if (analyze(drawing.points ?? [], drawing.source, drawing.mode)) {
        setNotice(null);
        if (close) closeEditor();
      }
    },
    [analyze, drawing.points, drawing.source, drawing.mode, closeEditor],
  );

  const loadPreset = useCallback(
    (id: PresetId, patch: Partial<LabSettings> = {}) => {
      const d = presetDrawing(id);
      if (patch.pathMode) d.mode = patch.pathMode;
      pushDrawing(d);
      setNotice(null);
      const { pathMode: _mode, ...rest } = patch;
      updateSettings(rest);
      analyze(d.points, id, d.mode);
    },
    [analyze, pushDrawing, updateSettings],
  );

  /** The contour chosen in the image tab becomes the drawing and is analysed like any hand-drawn stroke. */
  const applyImagePath = useCallback(
    (points: Vec2[]) => {
      pushDrawing({ points, source: 'image', mode: drawing.mode });
      if (analyze(points, 'image', drawing.mode)) {
        setNotice(null);
        closeEditor();
      }
    },
    [analyze, closeEditor, drawing.mode, pushDrawing],
  );

  const onStrokeEnd = useCallback(
    ({ points, truncated }: StrokeEvent) => {
      const check = preparePath(points, drawing.mode, settings.sampleCount);
      if (!check.ok) {
        setNotice({ kind: 'error', text: check.error.message });
        return;
      }
      const replaced = drawing.points !== null;
      pushDrawing({ points: check.path.stroke, source: 'user', mode: drawing.mode });
      if (truncated) setNotice({ kind: 'warning', text: '입력 좌표가 너무 많아 그 지점에서 선을 끝냈습니다.' });
      else if (replaced)
        setNotice({
          kind: 'info',
          text: '한 번에 하나의 이어진 선만 사용합니다. 새 선으로 교체했으며, 이전 그림은 실행 취소로 되돌릴 수 있습니다.',
        });
      else setNotice(null);
    },
    [drawing.mode, drawing.points, pushDrawing, settings.sampleCount],
  );

  const setDrawingMode = useCallback(
    (mode: PathMode) => setHistory((h) => ({ ...h, entries: h.entries.map((e, i) => (i === h.index ? { ...e, mode } : e)) })),
    [],
  );
  const undo = useCallback(() => setHistory((h) => ({ ...h, index: Math.max(0, h.index - 1) })), []);
  const redo = useCallback(() => setHistory((h) => ({ ...h, index: Math.min(h.entries.length - 1, h.index + 1) })), []);

  const resetAll = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    player.setSpeed(DEFAULT_SETTINGS.speed);
    const d = presetDrawing(DEFAULT_PRESET);
    pushDrawing(d);
    setNotice(null);
    setAnalyzed((a) => ({ points: d.points, source: d.source, id: a.id + 1 }));
    setSelectedK(null);
    player.restart();
    player.play();
  }, [player, pushDrawing]);

  // Keyboard: Space = play/pause (not while the editor is open), Ctrl+Z / Ctrl+Y = undo / redo of the drawing (editor only).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"]') || (e.key === ' ' && target.closest('button, summary')))) return;
      if (e.key === 'Escape' && sidebarOpen && !editorOpen && !isDesktop()) {
        setSidebarOpen(false);
      } else if (e.key === ' ' && !editorOpen) {
        e.preventDefault();
        player.toggle();
      } else if (editorOpen && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (editorOpen && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player, undo, redo, editorOpen, sidebarOpen]);

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
        restarts: player.restarts,
        circleCount: settings.circleCount,
        sampleCount: settings.sampleCount,
        selectionMode: settings.selectionMode,
        pathMode: settings.pathMode,
        display: settings.display,
        source: analyzed.source,
        analysisId: analyzed.id,
        pending,
        editorOpen,
        sidebarOpen,
        editorTab,
        drawingMode: drawing.mode,
        rmse: analysis?.rmse ?? null,
        relativeRmse: analysis ? analysis.rmse / analysis.scale : null,
        usedFrequencies: analysis ? [...analysis.selection.frequencies].sort((a, b) => a - b) : null,
        selectedK,
        strokePoints: analyzed.points.length,
        drawingPoints: drawing.points?.length ?? 0,
        // ẑ(t) straight from the math module, to compare with the tip drawn on screen.
        tipWorld: analysis ? chainTip(analysis.chain, player.time) : null,
      })),
    [player, settings, analyzed, pending, editorOpen, sidebarOpen, editorTab, drawing, analysis, selectedK],
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
      showToast('error', `PNG를 만들지 못했습니다: ${(e as Error).message}`);
    }
  };

  const saveProject = () => {
    const project = createProject(analyzed.points, settings, analyzed.source);
    downloadBlob(new Blob([serializeProject(project)], { type: 'application/json' }), 'fourierlab-project.json');
  };

  const loadProject = async (file: File) => {
    if (file.size > MAX_PROJECT_BYTES) {
      showToast('error', '파일이 너무 큽니다(최대 5MB).');
      return;
    }
    const r = parseProject(await file.text());
    if (!r.ok) {
      showToast('error', `프로젝트를 불러오지 못했습니다: ${r.error}`);
      return;
    }
    const points = r.project.path as Vec2[];
    const check = preparePath(points, r.project.settings.pathMode, r.project.settings.sampleCount);
    if (!check.ok) {
      showToast('error', `프로젝트의 경로를 사용할 수 없습니다: ${check.error.message}`);
      return;
    }
    setSettings(r.project.settings);
    pushDrawing({ points, source: 'file', mode: r.project.settings.pathMode });
    setAnalyzed((a) => ({ points, source: 'file', id: a.id + 1 }));
    setSelectedK(null);
    showToast('info', `"${file.name}" 프로젝트를 불러왔습니다.`);
    player.restart();
    player.play();
  };

  const selectedCoefficient = analysis && selectedK !== null ? analysis.spectrum.coefficients[analysis.spectrum.indexOf(selectedK)] : null;
  const rel = analysis ? (analysis.rmse / analysis.scale) * 100 : 0;

  const stat = (label: string, value: string, testId?: string, className?: string) => (
    <span className={cx('rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] text-slate-500 shadow-[0_0_0_1px_rgb(226_232_240)] sm:px-2 sm:py-1 sm:text-xs', className)}>
      {label}{' '}
      <b className="font-mono font-semibold text-ink tabular" data-testid={testId}>
        {value}
      </b>
    </span>
  );

  return (
    <div className="h-dvh overflow-hidden">
      {/* The page behind the modal drawer is inert: no focus, no clicks, hidden from assistive tech. */}
      <div inert={editorOpen} className="flex h-dvh flex-col">
        <Header
          editorOpen={editorOpen}
          pending={dirty}
          onEdit={openEditor}
          onExport={exportPng}
          onSave={saveProject}
          onLoad={loadProject}
          onImage={requestImage}
          sidebarOpen={sidebarOpen}
          onSidebarToggle={toggleSidebar}
        />

        <main className="flex min-h-0 flex-1">
          <section
            aria-label="푸리에 시각화"
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2 sm:p-3"
            onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
            onDrop={onStageDrop}
          >
            <div className="relative min-h-0 flex-1 rounded-xl border border-line bg-white" data-testid="stage">
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
                      {stat('N', String(settings.sampleCount), undefined, 'hidden sm:inline')}
                      {pending && (
                        <button
                          type="button"
                          data-testid="apply-pending"
                          onClick={() => applyDrawing(false)}
                          className="pointer-events-auto min-h-8 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 shadow-[0_0_0_1px_rgb(253_230_138)] hover:bg-amber-100"
                        >
                          편집한 그림 적용 →
                        </button>
                      )}
                    </>
                  }
                  overlay={
                    selectedCoefficient ? (
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

            {/* Phones and tablets: the sidebar is an overlay, so the essentials stay one tap away. */}
            <MobileBar player={player} onToggleSidebar={toggleSidebar} sidebarOpen={sidebarOpen} sampleCount={settings.sampleCount} />
          </section>

          <Sidebar
            open={sidebarOpen}
            onClose={closeSidebar}
            player={player}
            settings={settings}
            analysis={analysis}
            selectedK={selectedK}
            onSelectK={setSelectedK}
            onSpeed={(speed) => updateSettings({ speed })}
            onLoop={(loop) => updateSettings({ loop })}
            onCirclePreview={previewCircles}
            onCircleCommit={commitCircles}
            onSelectionMode={changeSelectionMode}
            onDisplay={updateDisplay}
            onSampleCount={changeSampleCount}
            onChainOrder={(chainOrder) => updateSettings({ chainOrder })}
            onResetSettings={() => setSettings((s) => ({ ...DEFAULT_SETTINGS, pathMode: s.pathMode }))}
            advancedOpen={advancedOpen}
            onAdvancedOpen={setAdvancedOpen}
            analysisOpen={analysisOpen}
            onAnalysisOpen={setAnalysisOpen}
          />
        </main>
      </div>

      <EditDrawer
        open={editorOpen}
        onClose={closeEditor}
        returnFocus={returnFocus}
        points={drawing.points}
        source={drawing.source}
        mode={drawing.mode}
        pending={pending}
        tab={editorTab}
        onTab={setEditorTab}
        imageRequest={imageRequest}
        onImageApply={applyImagePath}
        notice={notice}
        canUndo={history.index > 0}
        canRedo={history.index < history.entries.length - 1}
        onMode={setDrawingMode}
        onPreset={(id) => loadPreset(id)}
        onUndo={undo}
        onRedo={redo}
        onClear={() => {
          pushDrawing({ points: null, source: 'user', mode: drawing.mode });
          setNotice(null);
        }}
        onReset={resetAll}
        onRestart={() => applyDrawing(false)}
        onApply={() => applyDrawing(true)}
        onStrokeStart={() => setNotice(null)}
        onStrokeEnd={onStrokeEnd}
        onStrokeCancel={() => setNotice({ kind: 'warning', text: '입력이 중간에 취소되어 그리던 선을 버렸습니다. 다시 그려 주세요.' })}
      />

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

/** Compact transport under the canvas on screens where the sidebar is an overlay. */
function MobileBar({ player, onToggleSidebar, sidebarOpen, sampleCount }: { player: Player; onToggleSidebar: () => void; sidebarOpen: boolean; sampleCount: number }) {
  const { playing } = useSyncExternalStore(player.subscribe, player.getState);
  const step = 1 / sampleCount;
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 lg:hidden" role="group" aria-label="재생 컨트롤" data-testid="mobile-bar">
      <IconButton
        large
        label="처음부터 다시 재생"
        onClick={() => {
          player.restart();
          player.play();
        }}
      >
        <ReplayIcon />
      </IconButton>
      <IconButton large label="한 단계 뒤로" onClick={() => player.step(-step)}>
        <StepBackIcon />
      </IconButton>
      <button
        type="button"
        data-testid="mobile-play-toggle"
        aria-label={playing ? '일시정지' : '재생'}
        onClick={() => player.toggle()}
        className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-sm hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
      </button>
      <IconButton large label="한 단계 진행" onClick={() => player.step(step)}>
        <StepForwardIcon />
      </IconButton>
      <Button
        className={cx('h-11', sidebarOpen && 'border-accent/40 bg-accent-soft text-accent')}
        onClick={onToggleSidebar}
        aria-expanded={sidebarOpen}
        aria-controls="sidebar"
        data-testid="mobile-settings"
      >
        설정
      </Button>
    </div>
  );
}
