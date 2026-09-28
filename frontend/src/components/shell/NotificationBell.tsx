import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { listNotifications, markNotificationRead, markAllNotificationsRead, type NotificationDoc } from '../../lib/api/notifications';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: listNotifications,
    refetchInterval: 30000,
  });

  const readMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const readAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  function handleClick(notification: NotificationDoc) {
    if (!notification.read) readMutation.mutate(notification._id);
    setOpen(false);
    if (notification.link) navigate(notification.link);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
      >
        <Bell className="h-5 w-5" />
        {Boolean(data?.unreadCount) && (
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-[var(--color-primary)] px-1 text-[10px] font-semibold text-white">
            {data!.unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-40 w-80 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {Boolean(data?.unreadCount) && (
              <button type="button" className="text-xs text-[var(--color-primary)]" onClick={() => readAllMutation.mutate()}>
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data || data.notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-[var(--color-text-muted)]">You're all caught up.</p>
            ) : (
              data.notifications.map((n) => (
                <button
                  key={n._id}
                  type="button"
                  onClick={() => handleClick(n)}
                  className="flex w-full flex-col items-start gap-0.5 border-b border-[var(--color-border)] px-3 py-2.5 text-left last:border-b-0 hover:bg-[var(--color-surface-muted)]"
                >
                  <span className="flex w-full items-center gap-2 text-sm font-medium">
                    {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" aria-hidden />}
                    {n.title}
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">{n.message}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
