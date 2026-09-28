import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, CalendarX, Clock3, Users } from 'lucide-react';
import { listAppointments } from '../../lib/api/appointments';
import { listEventTypes } from '../../lib/api/eventTypes';
import { Card } from '../../components/ui/Card';
import { SkeletonList } from '../../components/ui/Skeleton';

export function CalendarDashboardTab() {
  const { data: appointments, isLoading } = useQuery({ queryKey: ['appointments'], queryFn: () => listAppointments() });
  const { data: eventTypes } = useQuery({ queryKey: ['event-types'], queryFn: listEventTypes });

  if (isLoading) return <SkeletonList rows={4} />;

  const upcoming = (appointments ?? []).filter((a) => new Date(a.startAt) > new Date() && a.status === 'Booked').length;
  const cancelled = (appointments ?? []).filter((a) => a.status === 'Cancelled').length;
  const noShows = (appointments ?? []).filter((a) => a.status === 'No Show').length;
  const published = (eventTypes ?? []).filter((e) => e.status === 'published').length;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Card>
        <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
          <CalendarCheck className="h-4 w-4" /> <p className="text-sm">Upcoming Bookings</p>
        </div>
        <p className="mt-1 text-2xl font-semibold">{upcoming}</p>
      </Card>
      <Card>
        <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
          <CalendarX className="h-4 w-4" /> <p className="text-sm">Cancelled</p>
        </div>
        <p className="mt-1 text-2xl font-semibold">{cancelled}</p>
      </Card>
      <Card>
        <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
          <Clock3 className="h-4 w-4" /> <p className="text-sm">No Shows</p>
        </div>
        <p className="mt-1 text-2xl font-semibold">{noShows}</p>
      </Card>
      <Card>
        <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
          <Users className="h-4 w-4" /> <p className="text-sm">Published Calendars</p>
        </div>
        <p className="mt-1 text-2xl font-semibold">{published}</p>
      </Card>
    </div>
  );
}
