import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Search, Users, Plus, Eye, Calendar, MessageCircle, Phone, Archive, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { listContacts, archiveContact, deleteContact } from '../../lib/api/contacts';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { SkeletonList } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { TemperatureBadge } from './TemperatureBadge';
import { AddContactModal } from './AddContactModal';
import { toast } from '../../stores/toastStore';

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
        <div className="flex overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => setArchived(false)}
            className={`px-3 py-2 text-sm font-medium ${!archived ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]' : 'text-[var(--color-text-muted)]'}`}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => setArchived(true)}
            className={`px-3 py-2 text-sm font-medium ${archived ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]' : 'text-[var(--color-text-muted)]'}`}
          >
            Archived
          </button>
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
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-[var(--color-surface-muted)] text-left text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Temperature</th>
                <th className="px-3 py-2 font-medium">Stage</th>
                <th className="px-3 py-2 font-medium">Lead Score</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.contacts.map((contact) => (
                <tr key={contact._id} className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="font-medium text-[var(--color-text)] hover:text-[var(--color-primary)]"
                      onClick={() => navigate(`/lead-management/contacts/${contact._id}`)}
                    >
                      {contact.name}
                    </button>
                    <p className="text-xs text-[var(--color-text-muted)]">{contact.email}</p>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">{contact.company || '—'}</td>
                  <td className="px-3 py-2">
                    <TemperatureBadge temperature={contact.temperature} />
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">{contact.lifecycleStage}</td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">{contact.leadScore}</td>
                  <td className="relative px-3 py-2 text-right">
                    <button
                      type="button"
                      aria-label={`Actions for ${contact.name}`}
                      aria-haspopup="menu"
                      className="rounded-[var(--radius-sm)] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
                      onClick={() => setOpenMenuId(openMenuId === contact._id ? null : contact._id)}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {openMenuId === contact._id && (
                      <div
                        role="menu"
                        className="absolute right-3 top-9 z-10 w-44 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 text-left shadow-[var(--shadow-card)]"
                      >
                        <MenuItem icon={Eye} label="View Profile" onClick={() => navigate(`/lead-management/contacts/${contact._id}`)} />
                        <MenuItem icon={Calendar} label="Book Appointment" onClick={() => setOpenMenuId(null)} />
                        <MenuItem icon={MessageCircle} label="Send WhatsApp" onClick={() => setOpenMenuId(null)} />
                        <MenuItem icon={Phone} label="Call" onClick={() => setOpenMenuId(null)} />
                        <MenuItem icon={Archive} label="Archive" onClick={() => handleArchive(contact._id)} />
                        <MenuItem icon={Trash2} label="Delete" tone="danger" onClick={() => handleDelete(contact._id)} />
                      </div>
                    )}
                  </td>
                </tr>
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
      className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-surface-muted)] ${
        tone === 'danger' ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]'
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}
