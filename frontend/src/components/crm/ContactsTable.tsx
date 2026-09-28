import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MoreHorizontal,
  Search,
  Users,
  Plus,
  Eye,
  Calendar,
  MessageCircle,
  Phone,
  Archive,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { listContacts, archiveContact, deleteContact } from '../../lib/api/contacts';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { SkeletonList } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { TemperatureBadge } from './TemperatureBadge';
import { AddContactModal } from './AddContactModal';
import { toast } from '../../stores/toastStore';

const AVATAR_PALETTE = ['#4F46E5', '#144BD6', '#45B369', '#FF9F29', '#8252E9', '#00B8F2'];

function avatarColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

const MAX_PAGE_BUTTONS = 5;

function pageWindow(current: number, total: number) {
  if (total <= MAX_PAGE_BUTTONS) return Array.from({ length: total }, (_, i) => i + 1);
  const half = Math.floor(MAX_PAGE_BUTTONS / 2);
  let start = Math.max(1, current - half);
  const end = Math.min(total, start + MAX_PAGE_BUTTONS - 1);
  start = Math.max(1, end - MAX_PAGE_BUTTONS + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function ContactsTable() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const limit = 25;

  useEffect(() => setPage(1), [search, archived]);

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', { search, archived, page, limit }],
    queryFn: () => listContacts({ search: search || undefined, archived, page, limit }),
    placeholderData: (prev) => prev,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const pageNumbers = pageWindow(page, totalPages);

  async function handleArchive(id: string) {
    await archiveContact(id);
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    toast('Contact archived', { variant: 'success' });
    setOpenMenuId(null);
  }

  async function handleDelete(id: string) {
    await deleteContact(id);
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    toast('Contact deleted', { variant: 'success', description: 'Moved to Recover (30-day retention)' });
    setOpenMenuId(null);
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <Input
              aria-label="Search contacts"
              placeholder="Search"
              className="h-10 pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="relative flex overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-1">
            {(['active', 'archived'] as const).map((option) => {
              const isActive = option === 'archived' ? archived : !archived;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setArchived(option === 'archived')}
                  className={`relative z-10 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium capitalize transition-colors duration-200 ${
                    isActive ? 'text-[var(--color-primary-fg)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-primary)]'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="contacts-filter-indicator"
                      className="absolute inset-0 -z-10 rounded-[var(--radius-sm)] bg-[var(--color-primary)]"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  {option}
                </button>
              );
            })}
          </div>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add New Lead
        </Button>
      </div>

      <div className="p-6">
        {isLoading && <SkeletonList rows={5} />}

        {!isLoading && data?.contacts.length === 0 && (
          <EmptyState
            icon={Users}
            title="No contacts found"
            description="Create your first contact to get started"
            actionLabel="Add Lead"
            onAction={() => setAddOpen(true)}
          />
        )}

        {!isLoading && data && data.contacts.length > 0 && (
          <div className="scrollbar-thin overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="bg-[var(--color-surface-muted)]">
                  <th className="px-4 py-3.5 text-left text-sm font-semibold text-[var(--color-text)]">Name</th>
                  <th className="px-4 py-3.5 text-left text-sm font-semibold text-[var(--color-text)]">Company</th>
                  <th className="px-4 py-3.5 text-left text-sm font-semibold text-[var(--color-text)]">Temperature</th>
                  <th className="px-4 py-3.5 text-left text-sm font-semibold text-[var(--color-text)]">Stage</th>
                  <th className="px-4 py-3.5 text-left text-sm font-semibold text-[var(--color-text)]">Lead Score</th>
                  <th className="px-4 py-3.5 text-center text-sm font-semibold text-[var(--color-text)]">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.contacts.map((contact, index) => (
                  <motion.tr
                    key={contact._id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, delay: Math.min(index, 12) * 0.02, ease: [0.22, 1, 0.36, 1] }}
                    className="table-row-hover border-t border-[var(--color-border)]"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                          style={{ backgroundColor: avatarColor(contact.name || contact.email || contact._id) }}
                        >
                          {initials(contact.name) || '•'}
                        </span>
                        <div>
                          <button
                            type="button"
                            className="font-medium text-[var(--color-text)] transition-colors hover:text-[var(--color-primary)]"
                            onClick={() => navigate(`/lead-management/contacts/${contact._id}`)}
                          >
                            {contact.name}
                          </button>
                          <p className="text-xs text-[var(--color-text-muted)]">{contact.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{contact.company || '—'}</td>
                    <td className="px-4 py-3">
                      <TemperatureBadge temperature={contact.temperature} />
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{contact.lifecycleStage}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--color-primary)] bg-[var(--color-primary-soft)] px-2.5 py-1 text-xs font-medium tabular-nums text-[var(--color-primary)]">
                        {contact.leadScore}
                      </span>
                    </td>
                    <td className="relative px-4 py-3">
                      <div className="flex items-center justify-center gap-2.5">
                        <button
                          type="button"
                          aria-label={`View ${contact.name}`}
                          className="icon-btn bg-[var(--color-info-surface)] text-[var(--color-info-text)]"
                          onClick={() => navigate(`/lead-management/contacts/${contact._id}`)}
                        >
                          <Eye className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`Archive ${contact.name}`}
                          className="icon-btn bg-[var(--color-warning-surface)] text-[var(--color-warning-text)]"
                          onClick={() => handleArchive(contact._id)}
                        >
                          <Archive className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${contact.name}`}
                          className="icon-btn bg-[var(--color-danger-surface)] text-[var(--color-danger-text)]"
                          onClick={() => handleDelete(contact._id)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`More actions for ${contact.name}`}
                          aria-haspopup="menu"
                          className="icon-btn bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                          onClick={() => setOpenMenuId(openMenuId === contact._id ? null : contact._id)}
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                      <AnimatePresence>
                        {openMenuId === contact._id && (
                          <motion.div
                            role="menu"
                            initial={{ opacity: 0, y: -4, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.98 }}
                            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                            className="absolute right-4 top-14 z-10 w-44 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 text-left shadow-[var(--shadow-pop)]"
                          >
                            <MenuItem icon={Calendar} label="Book Appointment" onClick={() => setOpenMenuId(null)} />
                            <MenuItem icon={MessageCircle} label="Send WhatsApp" onClick={() => setOpenMenuId(null)} />
                            <MenuItem icon={Phone} label="Call" onClick={() => setOpenMenuId(null)} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && data && data.total > 0 && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-[var(--color-text-muted)]">
              Showing {(data.page - 1) * data.limit + 1} to {Math.min(data.page * data.limit, data.total)} of {data.total} entries
            </span>
            <ul className="flex flex-wrap items-center justify-center gap-2">
              <li>
                <button
                  type="button"
                  aria-label="Previous page"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] text-sm font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary)] disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </li>
              {pageNumbers.map((num) => (
                <li key={num}>
                  <button
                    type="button"
                    onClick={() => setPage(num)}
                    aria-current={num === page ? 'page' : undefined}
                    className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-sm font-semibold transition-colors ${
                      num === page
                        ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]'
                        : 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]'
                    }`}
                  >
                    {num}
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  aria-label="Next page"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] text-sm font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary)] disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </li>
            </ul>
          </div>
        )}
      </div>

      <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  tone,
}: {
  icon: typeof Eye;
  label: string;
  onClick: () => void;
  tone?: 'danger';
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors duration-150 hover:bg-[var(--color-surface-muted)] ${
        tone === 'danger' ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]'
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}
