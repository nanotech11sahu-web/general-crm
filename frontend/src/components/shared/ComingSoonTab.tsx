import type { LucideIcon } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';

export function ComingSoonTab({ icon, label }: { icon: LucideIcon; label: string }) {
  return <EmptyState icon={icon} title={`${label} is coming in a later phase`} description="This tab lights up once its owning module ships." />;
}
