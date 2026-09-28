import type { HTMLAttributes } from 'react';
import clsx from 'clsx';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'hot' | 'warm' | 'cold';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]',
  success: 'bg-[var(--color-success)]/10 text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
  hot: 'bg-[var(--color-hot)]/10 text-[var(--color-hot)]',
  warm: 'bg-[var(--color-warm)]/10 text-[var(--color-warm)]',
  cold: 'bg-[var(--color-cold)]/10 text-[var(--color-cold)]',
};

export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  );
}
