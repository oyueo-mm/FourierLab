import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ExportKind } from '../render/export';
import { ACCEPT_ATTR } from '../image/load';
import { DownloadIcon, ImageIcon, MoreIcon, PencilIcon, SaveIcon, SidebarIcon, UploadIcon } from './icons';
import { Button, cx } from './ui';

interface Props {
  editorOpen: boolean;
  /** A drawing was edited but not applied yet. */
  pending: boolean;
  onEdit: () => void;
  onExport: (kind: ExportKind) => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  onImage: (file: File) => void;
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
}

interface MenuItem {
  key: string;
  label: string;
  hint?: string;
  onSelect: () => void;
}

/** Small popover menu: closes on outside press, Esc, and after choosing an item. */
function Menu({ trigger, items, align = 'right', testId }: { trigger: (props: { open: boolean; toggle: () => void }) => ReactNode; items: MenuItem[]; align?: 'left' | 'right'; testId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div role="menu" data-testid={testId} className={cx('absolute z-30 mt-1 w-60 rounded-xl border border-line bg-white p-1 shadow-lg', align === 'right' ? 'right-0' : 'left-0')}>
          {items.map((x) => (
            <button
              key={x.key}
              type="button"
              role="menuitem"
              data-testid={x.key}
              onClick={() => {
                setOpen(false);
                x.onSelect();
              }}
              className="block min-h-11 w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50"
            >
              <span className="block text-sm font-medium text-ink">{x.label}</span>
              {x.hint && <span className="block text-xs text-muted">{x.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Header({ editorOpen, pending, onEdit, onExport, onSave, onLoad, onImage, sidebarOpen, onSidebarToggle }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const exportItems: MenuItem[] = [
    { key: 'export-current', label: '현재 화면', hint: '회전하는 원과 궤적 포함', onSelect: () => onExport('current') },
    { key: 'export-reconstruction', label: '재구성 결과', hint: '전체 근사 곡선 (1600×1600)', onSelect: () => onExport('reconstruction') },
    { key: 'export-original', label: '원본 그림', hint: '입력한 선만', onSelect: () => onExport('original') },
  ];
  const moreItems: MenuItem[] = [
    ...exportItems.map((x) => ({ ...x, key: `m-${x.key}`, label: `PNG · ${x.label}` })),
    { key: 'm-save-project', label: '프로젝트 저장 (JSON)', onSelect: onSave },
    { key: 'm-load-project', label: '프로젝트 불러오기', onSelect: () => fileRef.current?.click() },
  ];

  return (
    <header className="h-14 shrink-0 border-b border-line bg-white">
      <div className="mx-auto flex h-full max-w-[1920px] items-center gap-2 px-3 sm:px-4">
        <a href="./" className="flex min-w-0 items-center gap-2.5" aria-label="FourierLab 홈">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width={34} height={34} className="shrink-0 rounded-lg" />
          <div className="min-w-0">
            <h1 className="hidden truncate text-lg leading-tight font-bold tracking-tight text-ink sm:block">FourierLab</h1>
          </div>
        </a>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="primary"
            id="open-editor"
            data-testid="open-editor"
            aria-haspopup="dialog"
            aria-expanded={editorOpen}
            className="relative h-11 px-4 sm:h-10"
            onClick={onEdit}
          >
            <PencilIcon size={16} />
            <span className="hidden sm:inline">그림 편집</span>
            <span className="sm:hidden">편집</span>
            {pending && !editorOpen && (
              <span data-testid="pending-dot" aria-label="적용하지 않은 편집 내용 있음" className="absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-white bg-amber-400" />
            )}
          </Button>

          <Button onClick={() => imageRef.current?.click()} data-testid="header-image" aria-label="이미지 업로드" className="h-11 sm:h-10">
            <ImageIcon size={16} />
            <span className="hidden lg:inline">이미지 업로드</span>
          </Button>

          {/* ≥ md: individual buttons */}
          <div className="hidden items-center gap-1.5 md:flex">
            <Menu
              testId="export-menu-list"
              items={exportItems}
              trigger={({ open, toggle }) => (
                <Button onClick={toggle} aria-expanded={open} aria-haspopup="menu" data-testid="export-menu" className="h-10">
                  <DownloadIcon size={16} />
                  PNG
                </Button>
              )}
            />
            <Button onClick={onSave} data-testid="save-project" title="그림과 설정을 JSON 파일로 저장" className="h-10">
              <SaveIcon size={16} />
              <span className="hidden lg:inline">저장</span>
            </Button>
            <Button onClick={() => fileRef.current?.click()} title="저장한 JSON 프로젝트 불러오기" className="h-10" data-testid="load-button">
              <UploadIcon size={16} />
              <span className="hidden lg:inline">불러오기</span>
            </Button>
          </div>

          {/* < md: one overflow menu */}
          <div className="md:hidden">
            <Menu
              testId="more-menu-list"
              items={moreItems}
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  aria-label="더보기: 저장, 불러오기, PNG"
                  aria-expanded={open}
                  aria-haspopup="menu"
                  data-testid="more-menu"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-white text-slate-600 hover:bg-slate-50"
                >
                  <MoreIcon />
                </button>
              )}
            />
          </div>

          <button
            type="button"
            onClick={onSidebarToggle}
            aria-label={sidebarOpen ? '설정 사이드바 닫기' : '설정 사이드바 열기'}
            aria-expanded={sidebarOpen}
            aria-controls="sidebar"
            data-testid="sidebar-toggle"
            className={cx(
              'inline-flex h-11 w-11 items-center justify-center rounded-lg border transition-colors sm:h-10 sm:w-10',
              sidebarOpen ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            <SidebarIcon size={18} />
          </button>

          <input
            ref={imageRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            data-testid="header-image-input"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) onImage(f);
            }}
          />
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
        </div>
      </div>
    </header>
  );
}
