import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Rocket } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { Card } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';

interface OnboardingTask {
  _id: string;
  label: string;
  completed: boolean;
}

export function OnboardingBanner() {
  const { data, isLoading } = useQuery({
    queryKey: ['onboarding'],
    queryFn: async () => (await api.get('/workspaces/onboarding')).data as { tasks: OnboardingTask[]; completed: number; total: number },
  });

  if (isLoading) {
    return (
      <Card>
        <Skeleton className="h-6 w-64" />
        <Skeleton className="mt-3 h-2 w-full" />
      </Card>
    );
  }

  if (!data) return null;
  const percent = data.total ? Math.round((data.completed / data.total) * 100) : 0;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Rocket className="h-5 w-5 text-[var(--color-primary)]" aria-hidden />
        <h2 className="font-semibold">Finish your setup</h2>
        <span className="ml-auto text-sm text-[var(--color-text-muted)]">
          {data.completed} of {data.total} tasks complete
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
        <motion.div
          className="h-full rounded-full bg-[var(--color-primary)]"
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
    </Card>
  );
}
