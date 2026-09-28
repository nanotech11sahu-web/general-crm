import { EmptyState } from '../components/ui/EmptyState';
import { Construction } from 'lucide-react';

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <EmptyState
      icon={Construction}
      title={`${title} is coming in a later phase`}
      description="This module's screens ship in the phase that owns it, per the PMC Demo build plan."
    />
  );
}
