import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { MoreHorizontal, Search, Users, Plus, Eye, Calendar, MessageCircle, Phone, Archive, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { listContacts, archiveContact, deleteContact } from '../../lib/api/contacts';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { SkeletonList } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { TemperatureBadge } from './TemperatureBadge';
import { AddContactModal } from './AddContactModal';
import { toast } from '../../stores/toastStore';

const AVATAR_PALETTE = ['#6366f1', '#0891b2', '#d97706', '#16a34a', '#e11d48', '#7c3aed'];

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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <Input
            aria-label="Search contacts"
            placeholder="Search contacts..."
            className="pl-9"
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
                  isActive ? 'text-[var(--color-primary-fg)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="contacts-filter-indicator"
                    className="absolute inset-0 -z-10 rounded-[var(--radius-sm)] bg-[image:var(--gradient-primary)] shadow-sm"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                {option}
              </button>
            );
          })}
        </div>
        <Button size="sm" className="ml-auto gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add Lead
        </Button>
      </div>

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
        <div className="scrollbar-thin overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-[var(--color-surface-muted)] text-left text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium">Company</th>
                <th className="px-3 py-2.5 font-medium">Temperature</th>
                <th className="px-3 py-2.5 font-medium">Stage</th>
                <th className="px-3 py-2.5 font-medium">Lead Score</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {data.contacts.map((contact, index) => (
                <motion.tr
                  key={contact._id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: Math.min(index, 12) * 0.02, ease: [0.22, 1, 0.36, 1] }}
                  className="group border-t border-[var(--color-border)] transition-colors duration-150 hover:bg-[var(--color-surface-muted)]"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
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
                  <td className="px-3 py-2.5 text-[var(--color-text-muted)]">{contact.company || '—'}</td>
                  <td className="px-3 py-2.5">
                    <TemperatureBadge temperature={contact.temperature} />
                  </td>
                  <td className="px-3 py-2.5 text-[var(--color-text-muted)]">{contact.lifecycleStage}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center rounded-full bg-[var(--color-primary-soft)] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--color-primary)]">
                      {contact.leadScore}
                    </span>
                  </td>
                  <td className="relative px-3 py-2.5 text-right">
                    <button
                      type="button"
                      aria-label={`Actions for ${contact.name}`}
                      aria-haspopup="menu"
                      className="rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-muted)] opacity-0 transition-all duration-150 hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => setOpenMenuId(openMenuId === contact._id ? null : contact._id)}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    <AnimatePresence>
                      {openMenuId === contact._id && (
                        <motion.div
                          role="menu"
                          initial={{ opacity: 0, y: -4, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.98 }}
                          transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                          className="absolute right-3 top-9 z-10 w-44 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 text-left shadow-[var(--shadow-pop)]"
                        >
                          <MenuItem icon={Eye} label="View Profile" onClick={() => navigate(`/lead-management/contacts/${contact._id}`)} />
                          <MenuItem icon={Calendar} label="Book Appointment" onClick={() => setOpenMenuId(null)} />
                          <MenuItem icon={MessageCircle} label="Send WhatsApp" onClick={() => setOpenMenuId(null)} />
                          <MenuItem icon={Phone} label="Call" onClick={() => setOpenMenuId(null)} />
                          <MenuItem icon={Archive} label="Archive" onClick={() => handleArchive(contact._id)} />
                          <MenuItem icon={Trash2} label="Delete" tone="danger" onClick={() => handleDelete(contact._id)} />
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

      {!isLoading && data && data.total > data.limit && (
        <div className="flex items-center justify-between text-sm text-[var(--color-text-muted)]">
          <p>
            Page {data.page} of {totalPages} · {data.total} contacts
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

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
