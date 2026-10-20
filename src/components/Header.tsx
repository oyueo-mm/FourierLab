import { useEffect, useRef, useState } from 'react';
import type { ExportKind } from '../render/export';
import { DownloadIcon, HelpIcon, SaveIcon, UploadIcon } from './icons';
import { Button } from './ui';

interface Props {
  onExport: (kind: ExportKind) => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  onHelp: () => void;
}

const EXPORTS: { kind: ExportKind; label: string; hint: string }[] = [
  { kind: 'current', label: '현재 화면', hint: '회전하는 원과 궤적 포함' },
  { kind: 'reconstruction', label: '재구성 결과', hint: '전체 근사 곡선 (원본 겹쳐 표시)' },
  { kind: 'original', label: '원본 그림', hint: '입력한 선만' },
];

export function Header({ onExport, onSave, onLoad, onHelp }: Props) {
  const [menu, setMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <a href="./" className="flex items-center gap-2.5" aria-label="FourierLab 홈">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width={36} height={36} className="rounded-lg" />
          <div>
            <h1 className="text-lg leading-tight font-bold tracking-tight text-ink">FourierLab</h1>
            <p className="hidden text-xs text-muted sm:block">그림을 회전하는 원으로 다시 그리는 푸리에 급수 실험실</p>
          </div>
        </a>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div className="relative" ref={menuRef}>
            <Button onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu" data-testid="export-menu">
              <DownloadIcon size={16} />
              PNG
            </Button>
            {menu && (
              <div role="menu" className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-line bg-white p-1 shadow-lg">
                {EXPORTS.map((x) => (
                  <button
                    key={x.kind}
                    type="button"
                    role="menuitem"
                    data-testid={`export-${x.kind}`}
                    onClick={() => {
                      setMenu(false);
                      onExport(x.kind);
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="block text-sm font-medium text-ink">{x.label}</span>
                    <span className="block text-xs text-muted">{x.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button onClick={onSave} data-testid="save-project" title="그림과 설정을 JSON 파일로 저장">
            <SaveIcon size={16} />
            <span className="hidden sm:inline">저장</span>
          </Button>
          <Button onClick={() => fileRef.current?.click()} title="저장한 JSON 프로젝트 불러오기">
            <UploadIcon size={16} />
            <span className="hidden sm:inline">불러오기</span>
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-testid="load-project"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) onLoad(f);
            }}
          />
          <Button variant="ghost" onClick={onHelp} aria-label="수학 원리 설명 보기">
            <HelpIcon size={18} />
            <span className="hidden md:inline">원리</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
