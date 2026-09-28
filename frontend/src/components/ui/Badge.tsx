import type { HTMLAttributes } from 'react';
import clsx from 'clsx';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'hot' | 'warm' | 'cold';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] border-[var(--color-border)]',
  success: 'bg-[var(--color-success-surface)] text-[var(--color-success-text)] border-[var(--color-success-main)]',
  warning: 'bg-[var(--color-warning-surface)] text-[var(--color-warning-text)] border-[var(--color-warning-main)]',
  danger: 'bg-[var(--color-danger-surface)] text-[var(--color-danger-text)] border-[var(--color-danger-main)]',
  info: 'bg-[var(--color-info-surface)] text-[var(--color-info-text)] border-[var(--color-info-main)]',
  hot: 'bg-[var(--color-danger-surface)] text-[var(--color-hot)] border-[var(--color-danger-main)]',
  warm: 'bg-[var(--color-warning-surface)] text-[var(--color-warm)] border-[var(--color-warning-main)]',
  cold: 'bg-[var(--color-info-surface)] text-[var(--color-cold)] border-[var(--color-info-main)]',
};

export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  );
}
