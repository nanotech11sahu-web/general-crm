import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { listProjects, createProject, updateProject } from '../../lib/api/projects';
import { listContacts } from '../../lib/api/contacts';
import { PROJECT_STATUSES, PROJECT_PRIORITIES, type ProjectStatus } from '../../types/operations';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const PRIORITY_TONE: Record<string, 'neutral' | 'warning' | 'danger'> = { Low: 'neutral', Medium: 'neutral', High: 'warning', Urgent: 'danger' };

function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<(typeof PROJECT_PRIORITIES)[number]>('Medium');
  const [category, setCategory] = useState('');
  const [deadline, setDeadline] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [selectedContact, setSelectedContact] = useState<{ _id: string; name: string } | null>(null);

  const { data: contactResults } = useQuery({
    queryKey: ['contact-search', contactSearch],
    queryFn: () => listContacts({ search: contactSearch, limit: 5 }),
    enabled: contactSearch.length > 1,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createProject({
        title,
        description,
        priority,
        category: category || undefined,
        contactId: selectedContact?._id,
        deadline: deadline || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast('Project created', { variant: 'success' });
      setTitle('');
      setDescription('');
      setCategory('');
      setDeadline('');
      setSelectedContact(null);
      setContactSearch('');
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="New Project">
      <div className="space-y-3">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Redesign homepage" />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Description</label>
          <textarea
            className="min-h-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm outline-none focus:border-[var(--color-primary)]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What needs to happen?"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="link-to-contact">
            Link to Contact
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              id="link-to-contact"
              className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] pl-9 pr-3 text-sm outline-none focus:border-[var(--color-primary)]"
              value={selectedContact ? selectedContact.name : contactSearch}
              onChange={(e) => {
                setSelectedContact(null);
                setContactSearch(e.target.value);
              }}
              placeholder="Search CRM contacts…"
            />
          </div>
          {!selectedContact && contactResults && contactResults.contacts.length > 0 && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)]">
              {contactResults.contacts.map((c) => (
                <button
                  key={c._id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-muted)]"
                  onClick={() => {
                    setSelectedContact({ _id: c._id, name: c.name });
                    setContactSearch('');
                  }}
                >
                  {c.name} {c.email ? `· ${c.email}` : ''}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Priority</label>
            <select
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              value={priority}
              onChange={(e) => setPriority(e.target.value as (typeof PROJECT_PRIORITIES)[number])}
            >
              {PROJECT_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <Input label="Category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Design, Engineering…" />
        </div>
        <Input label="Deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
            <Plus className="h-4 w-4" /> Create Project
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ProjectsTab() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const { data: projects, isLoading } = useQuery({ queryKey: ['projects'], queryFn: () => listProjects() });

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProjectStatus }) => updateProject(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  if (isLoading) return <SkeletonList rows={4} />;

  const byStatus = (status: ProjectStatus) => (projects ?? []).filter((p) => p.status === status);
  const counts = PROJECT_STATUSES.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s]: byStatus(s).length }), {});

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 text-sm text-[var(--color-text-muted)]">
          <Badge>{(projects ?? []).length} total</Badge>
          {PROJECT_STATUSES.map((s) => (
            <Badge key={s} tone="neutral">
              {s}: {counts[s]}
            </Badge>
          ))}
        </div>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" /> New Project
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {PROJECT_STATUSES.map((status) => (
          <div key={status} className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--color-text-muted)]">
              {status} <span className="text-xs">({counts[status]})</span>
            </h3>
            <div className="space-y-2">
              {byStatus(status).length === 0 && <Card className="text-xs text-[var(--color-text-muted)]">No projects</Card>}
              {byStatus(status).map((project) => (
                <Card key={project._id} className="space-y-2">
                  <p className="text-sm font-medium">{project.title}</p>
                  {typeof project.contactId === 'object' && project.contactId && <p className="text-xs text-[var(--color-text-muted)]">Linked: {project.contactId.name}</p>}
                  <div className="flex items-center justify-between">
                    <Badge tone={PRIORITY_TONE[project.priority]}>{project.priority}</Badge>
                    <select
                      aria-label={`Move ${project.title}`}
                      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-xs"
                      value={project.status}
                      onChange={(e) => moveMutation.mutate({ id: project._id, status: e.target.value as ProjectStatus })}
                    >
                      {PROJECT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
