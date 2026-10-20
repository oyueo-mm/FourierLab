// App-level message (export/import results). Drawer-specific messages stay inside the drawer.

import { useEffect } from 'react';
import { CloseIcon } from './icons';
import { cx } from './ui';

export interface ToastMessage {
  id: number;
  kind: 'error' | 'info';
  text: string;
}

export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(onDismiss, toast.kind === 'error' ? 9000 : 5000);
    return () => clearTimeout(id);
  }, [toast, onDismiss]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))]" aria-live="polite">
      {toast && (
        <div
          role={toast.kind === 'error' ? 'alert' : 'status'}
          data-testid="toast"
          className={cx(
            'pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg',
            toast.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-line bg-white text-slate-700',
          )}
        >
          <span className="leading-relaxed">{toast.text}</span>
          <button type="button" aria-label="메시지 닫기" onClick={onDismiss} className="-mr-1 shrink-0 rounded p-1 text-slate-400 hover:bg-black/5 hover:text-ink">
            <CloseIcon size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
