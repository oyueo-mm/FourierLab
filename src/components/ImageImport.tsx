// "이미지" tab of the editor: upload → automatic contour extraction → preview → apply.
//
// The decoded raster and the extraction settings live here, and this component stays mounted while
// the editor is closed or on the other tab, so switching between drawing and image never loses
// either. Only the chosen contour (a plain stroke) is handed to the app.

import { useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { DEFAULT_CONTOUR_OPTIONS, extractContours, toMathPath, type ContourOptions } from '../image/contour';
import { ACCEPT_ATTR, ImageLoadError, loadImage, type LoadedImage } from '../image/load';
import type { Vec2 } from '../math/path';
import { COLORS } from '../render/scene';
import { ImageIcon } from './icons';
import { Button, Segmented, Slider, cx } from './ui';

export interface ImageRequest {
  file: File;
  /** Changes for every request, so the same file can be loaded twice. */
  id: number;
}

interface Props {
  request: ImageRequest | null;
  /** Hands the extracted stroke (math frame) to the app. */
  onApply: (points: Vec2[]) => void;
}

type View = 'overlay' | 'original' | 'contour';

const PREVIEW_SCALE = 2;

function drawLoop(ctx: CanvasRenderingContext2D, pts: readonly Vec2[], color: string, width: number) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export function ImageImport({ request, onApply }: Props) {
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [options, setOptions] = useState<ContourOptions>(DEFAULT_CONTOUR_OPTIONS);
  const [chosen, setChosen] = useState(0);
  const [view, setView] = useState<View>('overlay');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const token = useRef(0);

  const open = async (file: File) => {
    const mine = ++token.current;
    setBusy(true);
    setLoadError(null);
    try {
      const img = await loadImage(file);
      if (mine !== token.current) return; // a newer upload replaced this one
      setLoaded(img);
      setOptions(DEFAULT_CONTOUR_OPTIONS);
    } catch (e) {
      if (mine !== token.current) return;
      // The previously loaded image (and the running simulation) stay untouched.
      setLoadError(e instanceof ImageLoadError ? e.message : '이미지를 처리하지 못했습니다.');
    } finally {
      if (mine === token.current) setBusy(false);
    }
  };

  useEffect(() => {
    if (request) void open(request.file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);

  const liveOptions = useDeferredValue(options);
  const result = useMemo(() => (loaded ? extractContours(loaded, liveOptions) : null), [loaded, liveOptions]);
  const contours = useMemo(() => (result?.ok ? result.contours : []), [result]);
  useEffect(() => setChosen(0), [result]);
  const selected = contours[Math.min(chosen, contours.length - 1)] ?? null;

  // Preview.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    canvas.width = loaded.width * PREVIEW_SCALE;
    canvas.height = loaded.height * PREVIEW_SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(PREVIEW_SCALE, 0, 0, PREVIEW_SCALE, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, loaded.width, loaded.height);
    if (view !== 'contour') {
      ctx.globalAlpha = view === 'overlay' ? 0.5 : 1;
      ctx.drawImage(loaded.canvas, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (view === 'original') return;
    for (const c of contours) if (c !== selected) drawLoop(ctx, c.points, '#cbd5e1', 1);
    if (selected) {
      drawLoop(ctx, selected.points, COLORS.original, 2);
      const [sx, sy] = selected.points[0];
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#059669';
      ctx.fill();
    }
  }, [loaded, view, contours, selected]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) void open(f);
  };

  const errorText = loadError ?? (result && !result.ok ? result.error.message : null);
  const errorBox = errorText && (
    <p role="alert" data-testid="image-error" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {errorText}
    </p>
  );

  return (
    <div className="space-y-3" data-testid="image-import">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="hidden"
        data-testid="image-input"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void open(f);
        }}
      />

      {!loaded ? (
        <>
          <div
            data-testid="image-dropzone"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cx(
              'mx-auto flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
              dragOver ? 'border-accent bg-accent-soft' : 'border-line bg-slate-50',
            )}
            style={{ maxWidth: 'max(18rem, calc(100dvh - 16rem))' }}
          >
            <ImageIcon size={32} className="text-slate-400" />
            <div className="text-sm text-slate-600">이미지를 끌어다 놓거나 붙여넣기(Ctrl+V)</div>
            <Button variant="primary" className="h-11" onClick={() => inputRef.current?.click()} disabled={busy} data-testid="image-pick">
              {busy ? '분석 중…' : '이미지 선택'}
            </Button>
            <div className="text-xs text-muted">PNG · JPG · WebP</div>
          </div>
          {errorBox}
        </>
      ) : (
        <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop} className="space-y-3">
          <Segmented<View>
            label="미리보기 방식"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'overlay', label: '겹쳐 보기' },
              { value: 'original', label: '원본' },
              { value: 'contour', label: '윤곽선' },
            ]}
          />
          <div
            className="mx-auto flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-line bg-white"
            style={{ width: 'min(100%, max(18rem, calc(100dvh - 27rem)))' }}
          >
            <canvas ref={canvasRef} data-testid="image-preview" className="max-h-full max-w-full" aria-label="이미지 미리보기" />
          </div>

          {contours.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="윤곽선 후보">
              {contours.slice(0, 6).map((c, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={i === chosen}
                  data-testid={`image-candidate-${i}`}
                  onClick={() => setChosen(i)}
                  className={cx(
                    'h-9 rounded-full border px-3 text-xs font-medium transition-colors',
                    i === chosen ? 'border-accent bg-accent text-white' : 'border-line bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  윤곽선 {i + 1}
                  {c.hole ? ' (구멍)' : ''}
                </button>
              ))}
            </div>
          )}

          <details className="rounded-lg border border-line px-3 py-2">
            <summary className="cursor-pointer list-none text-sm font-medium text-slate-700 select-none [&::-webkit-details-marker]:hidden">추출 설정</summary>
            <div className="mt-2 space-y-2">
              <label className="block text-xs text-slate-500">
                임계값
                <Slider
                  label="임계값"
                  min={-0.4}
                  max={0.4}
                  step={0.01}
                  value={options.thresholdOffset}
                  onChange={(v) => setOptions((o) => ({ ...o, thresholdOffset: v }))}
                  testId="image-threshold"
                />
              </label>
              <label className="block text-xs text-slate-500">
                단순화
                <Slider
                  label="단순화"
                  min={0}
                  max={4}
                  step={0.1}
                  value={options.simplify}
                  onChange={(v) => setOptions((o) => ({ ...o, simplify: v }))}
                  testId="image-simplify"
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={options.invert}
                  onChange={(e) => setOptions((o) => ({ ...o, invert: e.currentTarget.checked }))}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                  data-testid="image-invert"
                />
                밝기 반전
              </label>
            </div>
          </details>

          {errorBox}
          <p className="text-xs text-muted" data-testid="image-note">
            선택한 윤곽선 하나만 재구성합니다. 색과 채움은 반영되지 않습니다.
          </p>

          <div className="sticky bottom-0 -mx-1 grid grid-cols-[1fr_1.6fr] gap-2 bg-white px-1 pt-2 pb-1">
            <Button className="h-11" onClick={() => inputRef.current?.click()} disabled={busy} data-testid="image-replace">
              다른 이미지
            </Button>
            <Button variant="primary" className="h-11" disabled={!selected} onClick={() => selected && onApply(toMathPath(selected.points))} data-testid="image-apply">
              이 윤곽선으로 재구성
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
