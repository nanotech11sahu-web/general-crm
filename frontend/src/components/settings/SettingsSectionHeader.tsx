import { motion } from 'framer-motion';
import type { ComponentType } from 'react';

export type SectionAccent = 'indigo' | 'blue' | 'violet' | 'pink' | 'teal' | 'cyan' | 'amber' | 'orange' | 'lime' | 'rose' | 'emerald' | 'slate';

const ACCENTS: Record<SectionAccent, { bg: string; icon: string }> = {
  indigo: { bg: '#E0E7FF', icon: '#4F46E5' },
  blue: { bg: '#DBEAFE', icon: '#2563EB' },
  violet: { bg: '#EDE9FE', icon: '#7C3AED' },
  pink: { bg: '#FCE7F3', icon: '#DB2777' },
  teal: { bg: '#CCFBF1', icon: '#0D9488' },
  cyan: { bg: '#CFFAFE', icon: '#0891B2' },
  amber: { bg: '#FEF3C7', icon: '#D97706' },
  orange: { bg: '#FFEDD5', icon: '#EA580C' },
  lime: { bg: '#ECFCCB', icon: '#65A30D' },
  rose: { bg: '#FFE4E6', icon: '#E11D48' },
  emerald: { bg: '#D1FAE5', icon: '#059669' },
  slate: { bg: '#E2E8F0', icon: '#475569' },
};

interface SettingsSectionHeaderProps {
  icon: ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  accent: SectionAccent;
  title: string;
  description: string;
}

export function SettingsSectionHeader({ icon: Icon, accent, title, description }: SettingsSectionHeaderProps) {
  const colors = ACCENTS[accent];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]"
    >
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: colors.bg }}
      >
        <Icon size={20} style={{ color: colors.icon }} />
      </span>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">{title}</h1>
        <p className="truncate text-sm text-[var(--color-text-muted)]">{description}</p>
      </div>
    </motion.div>
  );
}

export function SettingsSectionBody({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut', delay: 0.05 }}
      className="space-y-4"
    >
      {children}
    </motion.div>
  );
}
