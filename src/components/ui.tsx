// Small shared UI primitives.
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ComponentProps, type CSSProperties, type ReactNode } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost';

export function Button({
  variant = 'secondary',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition-colors select-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'primary' && 'bg-accent px-4 py-2.5 text-white shadow-sm hover:bg-accent-strong',
        variant === 'secondary' && 'border border-line bg-white px-3 py-2 text-slate-700 hover:border-slate-300 hover:bg-slate-50',
        variant === 'ghost' && 'px-2 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-ink',
        className,
      )}
      {...rest}
    />
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  large,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; large?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-lg border transition-colors',
        // 44 px touch targets on phones/tablets, compact on desktop (large keeps 44 px everywhere).
        large ? 'h-11 w-11' : 'h-11 w-11 sm:h-9 sm:w-9',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35',
        active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-white text-slate-600 hover:bg-slate-50 hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  size = 'md',
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-lg border border-line bg-slate-50 p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex-1 rounded-md font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-accent',
              size === 'sm' ? 'px-2 py-2 text-xs sm:py-1' : 'px-2.5 py-2.5 text-sm sm:py-1.5',
              on ? 'bg-white text-accent shadow-sm ring-1 ring-line' : 'text-slate-600 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({
  on,
  onToggle,
  swatch,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  swatch?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cx(
        'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors sm:min-h-0 sm:px-2.5',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        on ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line bg-white text-slate-500 hover:text-ink',
      )}
    >
      {swatch}
      {children}
    </button>
  );
}

/**
 * Range slider that also paints its filled part. `value` is in slider units.
 *
 * `onChange` reports every value while the thumb moves (use it for a live preview).
 * `onCommit` reports the final value once: when the pointer is released (or cancelled) after a
 * drag, or immediately for changes that do not come from a pointer drag (keyboard, assistive
 * technology, programmatic input). Without `onCommit` it behaves like a plain range input.
 */
export function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  onCommit,
  className,
  valueText,
  testId,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  className?: string;
  valueText?: string;
  testId?: string;
}) {
  const dragging = useRef(false);
  const dirty = useRef(false);
  const latest = useRef(value);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    const end = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (dirty.current) {
        dirty.current = false;
        commitRef.current?.(latest.current);
      }
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  const fill = `${((value - min) / (max - min || 1)) * 100}%`;
  return (
    <input
      type="range"
      aria-label={label}
      aria-valuetext={valueText}
      data-testid={testId}
      className={cx('slider w-full', className)}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ '--fill': fill } as CSSProperties}
      onPointerDown={() => {
        dragging.current = true;
        dirty.current = false;
      }}
      onChange={(e) => {
        const v = Number(e.currentTarget.value);
        latest.current = v;
        onChange(v);
        if (dragging.current) dirty.current = true;
        else commitRef.current?.(v);
      }}
    />
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5" role="group" aria-labelledby={id}>
      <div className="flex items-baseline justify-between gap-2">
        <span id={id} className="text-xs font-semibold tracking-wide text-slate-500">
          {label}
        </span>
        {hint && <span className="text-xs text-muted tabular">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function Panel({ className, children, ...rest }: ComponentProps<'section'>) {
  return (
    <section className={cx('rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgb(15_23_42/0.04)]', className)} {...rest}>
      {children}
    </section>
  );
}

export { cx };
