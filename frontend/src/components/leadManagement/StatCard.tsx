import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import clsx from 'clsx';
import { Card } from '../ui/Card';

export type StatTone = 'violet' | 'emerald' | 'amber' | 'rose' | 'blue' | 'cyan';

const TONE_CLASSES: Record<StatTone, { badge: string; spark: string; trendUp: string; trendDown: string }> = {
  violet: {
    badge: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300',
    spark: '#7c3aed',
    trendUp: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300',
    trendDown: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  },
  emerald: {
    badge: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    spark: '#059669',
    trendUp: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    trendDown: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  },
  amber: {
    badge: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
    spark: '#d97706',
    trendUp: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    trendDown: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  },
  rose: {
    badge: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
    spark: '#e11d48',
    trendUp: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    trendDown: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  },
  blue: {
    badge: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300',
    spark: '#2563eb',
    trendUp: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    trendDown: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  },
  cyan: {
    badge: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-300',
    spark: '#0891b2',
    trendUp: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
    trendDown: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  },
};

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const width = 72;
  const height = 26;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface StatCardProps {
  icon: LucideIcon;
  tone: StatTone;
  label: string;
  value: string | number;
  trend?: { direction: 'up' | 'down'; label: string };
  sparkline?: number[];
  onViewAll?: () => void;
}

export function StatCard({ icon: Icon, tone, label, value, trend, sparkline, onViewAll }: StatCardProps) {
  const colors = TONE_CLASSES[tone];
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className={clsx('flex h-11 w-11 items-center justify-center rounded-2xl', colors.badge)}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        {sparkline && sparkline.length > 1 && <Sparkline values={sparkline} color={colors.spark} />}
      </div>
      <div>
        <p className="text-sm text-[var(--color-text-muted)]">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </div>
      <div className="flex items-center justify-between">
        {onViewAll ? (
          <button type="button" onClick={onViewAll} className="text-sm font-medium text-[var(--color-primary)] hover:underline">
            View All &rarr;
          </button>
        ) : (
          <span />
        )}
        {trend && (
          <span
            className={clsx(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              trend.direction === 'up' ? colors.trendUp : colors.trendDown,
            )}
          >
            {trend.direction === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {trend.label}
          </span>
        )}
      </div>
    </Card>
  );
}
