import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { listAppointments } from '../../lib/api/appointments';
import { listEventTypes } from '../../lib/api/eventTypes';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { CalendarDays } from 'lucide-react';
import type { AppointmentStatus } from '../../types/sales';

const STATUS_TONE: Record<AppointmentStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  Booked: 'success',
  'Awaiting Payment': 'warning',
  Cancelled: 'danger',
  'Show Up': 'success',
  'No Show': 'danger',
  Rescheduled: 'neutral',
};

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function buildMonthGrid(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

export function CalendarViewTab() {
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(new Date());
  const [staffFilter, setStaffFilter] = useState('all');

  const { data: appointments, isLoading } = useQuery({ queryKey: ['appointments'], queryFn: () => listAppointments() });
  const { data: eventTypes } = useQuery({ queryKey: ['event-types'], queryFn: listEventTypes });

  const days = useMemo(() => buildMonthGrid(anchor), [anchor]);
  const filtered = useMemo(
    () => (appointments ?? []).filter((a) => staffFilter === 'all' || a.staffMembershipId === staffFilter),
    [appointments, staffFilter],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const appt of filtered) {
      const key = new Date(appt.startAt).toDateString();
      map.set(key, [...(map.get(key) ?? []), appt]);
    }
    return map;
  }, [filtered]);

  const staffIds = useMemo(() => Array.from(new Set((eventTypes ?? []).flatMap((e) => e.staffMembershipIds))), [eventTypes]);

  if (isLoading) return <EmptyState icon={CalendarDays} title="Loading calendar…" />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" aria-label="Previous month" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="w-40 text-center font-semibold">{anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
          <Button size="sm" variant="secondary" aria-label="Next month" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
        </div>
        <select
          aria-label="Filter by staff"
          className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
          value={staffFilter}
          onChange={(e) => setStaffFilter(e.target.value)}
        >
          <option value="all">All Staff</option>
          {staffIds.map((id) => (
            <option key={id} value={id}>
              {id.slice(-6)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        {(Object.keys(STATUS_TONE) as AppointmentStatus[]).map((status) => (
          <div key={status} className="flex items-center gap-1.5">
            <Badge tone={STATUS_TONE[status]}>{status}</Badge>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-border)] text-xs">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="bg-[var(--color-surface-muted)] p-1.5 text-center font-medium text-[var(--color-text-muted)]">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const inMonth = day.getMonth() === anchor.getMonth();
          const dayAppointments = byDay.get(day.toDateString()) ?? [];
          return (
            <div
              key={day.toISOString()}
              className={clsx('group relative min-h-[84px] bg-[var(--color-surface)] p-1.5', !inMonth && 'opacity-40')}
            >
              <p className="text-[11px] text-[var(--color-text-muted)]">{day.getDate()}</p>
              <div className="mt-1 space-y-0.5">
                {dayAppointments.slice(0, 2).map((appt) => (
                  <div key={appt._id} className="truncate rounded bg-[var(--color-surface-muted)] px-1 py-0.5">
                    {new Date(appt.startAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </div>
                ))}
                {dayAppointments.length > 2 && <p className="text-[10px] text-[var(--color-text-muted)]">+{dayAppointments.length - 2} more</p>}
              </div>
              <button
                type="button"
                aria-label={`Create appointment on ${day.toDateString()}`}
                onClick={() => navigate('/calendar', { state: { tab: 'Create/Edit' } })}
                className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-fg)] group-hover:flex"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {!appointments?.length && (
        <EmptyState icon={CalendarDays} title="No appointments yet" description="Publish an Event Type and share its booking link to start collecting bookings." />
      )}
    </div>
  );
}
