import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Phone, Mail, MessageCircle, Video, Sparkles, RefreshCw, Ban } from 'lucide-react';
import clsx from 'clsx';
import {
  getContact,
  listContactNotes,
  addContactNote,
  listContactTimeline,
  listContactOpportunities,
  getLeadScore,
  recalculateLeadScore,
  updateContact,
  getNextBestAction,
} from '../../lib/api/contacts';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { TemperatureBadge } from '../../components/crm/TemperatureBadge';
import { toast } from '../../stores/toastStore';
import type { Contact, LifecycleStage, Temperature } from '../../types/crm';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { Inbox, Calendar as CalendarIcon, Wallet, MoreHorizontal } from 'lucide-react';
import { listAppointments } from '../../lib/api/appointments';
import { listInvoices, listSubscriptions } from '../../lib/api/finance';
import { ComingSoonTab } from '../../components/shared/ComingSoonTab';

const TABS = [
  'Profile',
  'Overview',
  'Opportunities',
  'Fields',
  'UTM Tracking',
  'Timeline',
  'Appointments',
  'Conversations',
  'Finance',
  'Lead Scoring',
  'More',
] as const;
type Tab = (typeof TABS)[number];

export function ContactProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('Profile');

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', id],
    queryFn: () => getContact(id!),
    enabled: Boolean(id),
  });

  if (isLoading) return <SkeletonList rows={6} />;
  if (!contact) return <EmptyState icon={Inbox} title="Contact not found" />;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <Card className="flex flex-wrap items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-primary)] text-xl font-semibold text-[var(--color-primary-fg)]">
          {contact.name[0]?.toUpperCase()}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{contact.name}</h1>
            <TemperatureBadge temperature={contact.temperature} />
            {contact.isDemo && <Badge>Demo</Badge>}
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">
            {contact.jobTitle ? `${contact.jobTitle} at ` : ''}
            {contact.company ?? '—'}
          </p>
        </div>
        <div className="flex gap-1.5">
          <QuickAction icon={Phone} label="Call" />
          <QuickAction icon={Mail} label="Email" />
          <QuickAction icon={MessageCircle} label="Chat" />
          <QuickAction icon={Video} label="Meet" />
        </div>
      </Card>

      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]" aria-label="Contact profile tabs">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(
              'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t
                ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'Profile' && <ProfileTab contact={contact} />}
      {tab === 'Overview' && <OverviewTab contact={contact} />}
      {tab === 'Opportunities' && <OpportunitiesTab contactId={contact._id} />}
      {tab === 'Fields' && <FieldsTab contact={contact} />}
      {tab === 'UTM Tracking' && <UtmTab contact={contact} />}
      {tab === 'Timeline' && <TimelineTab contactId={contact._id} />}
      {tab === 'Appointments' && <AppointmentsTab contactId={contact._id} />}
      {tab === 'Conversations' && <ComingSoonTab icon={Inbox} label="Conversations" />}
      {tab === 'Finance' && <FinanceTab contactId={contact._id} />}
      {tab === 'Lead Scoring' && <LeadScoringTab contactId={contact._id} />}
      {tab === 'More' && <ComingSoonTab icon={MoreHorizontal} label="More" />}
    </div>
  );
}

function QuickAction({ icon: Icon, label }: { icon: typeof Phone; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function AppointmentsTab({ contactId }: { contactId: string }) {
  const { data: appointments, isLoading } = useQuery({
    queryKey: ['contact-appointments', contactId],
    queryFn: () => listAppointments({ contactId }),
  });
  if (isLoading) return <SkeletonList rows={3} />;
  if (!appointments?.length) {
    return <EmptyState icon={CalendarIcon} title="No appointments yet" description="Bookings made through this contact's Calendar links will show up here." />;
  }
  return (
    <div className="space-y-2">
      {appointments.map((appt) => (
        <Card key={appt._id} className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{new Date(appt.startAt).toLocaleString()}</p>
            <p className="text-xs text-[var(--color-text-muted)]">Ends {new Date(appt.endAt).toLocaleTimeString()}</p>
          </div>
          <Badge tone={appt.status === 'Cancelled' || appt.status === 'No Show' ? 'danger' : appt.status === 'Booked' || appt.status === 'Show Up' ? 'success' : 'neutral'}>
            {appt.status}
          </Badge>
        </Card>
      ))}
    </div>
  );
}

function FinanceTab({ contactId }: { contactId: string }) {
  const { data: invoicesData, isLoading: invoicesLoading } = useQuery({
    queryKey: ['contact-invoices', contactId],
    queryFn: () => listInvoices({ contactId }),
  });
  const { data: subscriptions, isLoading: subsLoading } = useQuery({
    queryKey: ['contact-subscriptions', contactId],
    queryFn: () => listSubscriptions({ contactId }),
  });

  if (invoicesLoading || subsLoading) return <SkeletonList rows={3} />;

  const invoices = invoicesData?.invoices ?? [];
  if (!invoices.length && !subscriptions?.length) {
    return <EmptyState icon={Wallet} title="No billing history yet" description="Invoices and subscriptions created for this contact in Finance will show up here." />;
  }

  return (
    <div className="space-y-4">
      {Boolean(subscriptions?.length) && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Subscriptions</h3>
          <div className="space-y-2">
            {subscriptions!.map((s) => (
              <Card key={s._id} className="flex items-center justify-between">
                <p className="text-sm">
                  ₹{s.price.toLocaleString()} / {s.billingCycle}
                </p>
                <Badge tone={s.status === 'active' ? 'success' : s.status === 'overdue' ? 'danger' : 'neutral'}>{s.status}</Badge>
              </Card>
            ))}
          </div>
        </div>
      )}
      {Boolean(invoices.length) && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Invoices</h3>
          <div className="space-y-2">
            {invoices.map((inv) => (
              <Card key={inv._id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{inv.receiptNumber}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">₹{inv.totalAmount.toLocaleString()} · due {new Date(inv.dueAt).toLocaleDateString()}</p>
                </div>
                <Badge tone={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'danger' : inv.status === 'cancelled' ? 'neutral' : 'warning'}>{inv.status}</Badge>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type ContactData = Contact;

function ProfileTab({ contact }: { contact: ContactData }) {
  const queryClient = useQueryClient();
  const [noteBody, setNoteBody] = useState('');

  const { data: notes } = useQuery({ queryKey: ['contact-notes', contact._id], queryFn: () => listContactNotes(contact._id) });

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<ContactData>) => updateContact(contact._id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact', contact._id] });
      toast('Contact updated', { variant: 'success' });
    },
  });

  const noteMutation = useMutation({
    mutationFn: () => addContactNote(contact._id, noteBody),
    onSuccess: () => {
      setNoteBody('');
      queryClient.invalidateQueries({ queryKey: ['contact-notes', contact._id] });
      queryClient.invalidateQueries({ queryKey: ['contact-timeline', contact._id] });
      toast('Note added', { variant: 'success' });
    },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="space-y-2 lg:col-span-1">
        <h3 className="font-semibold">Contact Info</h3>
        <InfoRow label="Email" value={contact.email} />
        <InfoRow label="Phone" value={contact.phone} />
        <InfoRow label="City" value={contact.city} />
        <InfoRow label="Country" value={contact.country} />
        <h3 className="pt-2 font-semibold">Tags</h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          {contact.tagIds?.length ? `${contact.tagIds.length} tag(s) assigned` : 'No tags assigned'}
        </p>
      </Card>

      <Card className="space-y-3 lg:col-span-1">
        <h3 className="font-semibold">Lead Details</h3>
        <LabeledSelect
          label="Lifecycle Stage"
          value={contact.lifecycleStage}
          options={['Lead', 'MQL', 'SQL', 'Opportunity', 'Customer', 'Evangelist']}
          onChange={(v) => updateMutation.mutate({ lifecycleStage: v as LifecycleStage })}
        />
        <LabeledSelect
          label="Temperature"
          value={contact.temperature}
          options={['Hot', 'Warm', 'Cold']}
          onChange={(v) => updateMutation.mutate({ temperature: v as Temperature })}
        />
        <InfoRow label="Contact Type" value={contact.contactType} />
        <InfoRow label="Lead Value" value={contact.leadValue ? `₹${contact.leadValue.toLocaleString()}` : 'Not set'} />
        <InfoRow label="Assigned Closers" value={contact.assignedCloserIds?.length ? `${contact.assignedCloserIds.length} assigned` : 'Unassigned'} />
        <div className="flex items-center gap-2 pt-1">
          <Ban className="h-4 w-4 text-[var(--color-text-muted)]" />
          <span className="text-sm text-[var(--color-text-muted)]">
            {contact.dnd?.blockAll ? 'All channels blocked' : 'No channel restrictions'}
          </span>
        </div>
      </Card>

      <Card className="space-y-3 lg:col-span-1">
        <h3 className="font-semibold">Notes</h3>
        <div className="flex gap-2">
          <Input
            aria-label="Add a note"
            placeholder="Add a note..."
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
          />
          <Button size="sm" disabled={!noteBody} loading={noteMutation.isPending} onClick={() => noteMutation.mutate()}>
            Add
          </Button>
        </div>
        <div className="max-h-56 space-y-2 overflow-y-auto">
          {!notes?.length && <p className="text-sm text-[var(--color-text-muted)]">No notes yet.</p>}
          {notes?.map((note) => (
            <div key={note._id} className="rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-2 text-sm">
              {note.body}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span>{value || '—'}</span>
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <select
        className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function OverviewTab({ contact }: { contact: ContactData }) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const nbaMutation = useMutation({
    mutationFn: () => getNextBestAction(contact._id),
    onSuccess: (res) => setSuggestion(res.suggestion),
    onError: () => toast('Could not reach the AI gateway (check the workspace wallet balance)', { variant: 'error' }),
  });

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-[var(--color-primary)]" />
        <h3 className="font-semibold">AI Pulse</h3>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-3xl font-bold">{contact.aiPulseScore}</div>
        <p className="text-sm text-[var(--color-text-muted)]">Engagement score (0–100)</p>
      </div>
      <Button variant="secondary" size="sm" className="gap-1.5" loading={nbaMutation.isPending} onClick={() => nbaMutation.mutate()}>
        <Sparkles className="h-4 w-4" /> Get AI Next Best Action
      </Button>
      {suggestion && <p className="rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-3 text-sm">{suggestion}</p>}
    </Card>
  );
}

function OpportunitiesTab({ contactId }: { contactId: string }) {
  const { data: opportunities, isLoading } = useQuery({
    queryKey: ['contact-opportunities', contactId],
    queryFn: () => listContactOpportunities(contactId),
  });
  if (isLoading) return <SkeletonList rows={3} />;
  if (!opportunities?.length) {
    return <EmptyState icon={Sparkles} title="No opportunities yet" description="This contact isn't in any pipeline yet." />;
  }
  return (
    <div className="space-y-2">
      {opportunities.map((opp) => (
        <Card key={opp._id} className="flex items-center justify-between">
          <div>
            <p className="font-medium">{opp.name}</p>
            <p className="text-sm text-[var(--color-text-muted)]">{opp.productInterest}</p>
          </div>
          <Badge>{opp.stageKey}</Badge>
        </Card>
      ))}
    </div>
  );
}

function FieldsTab({ contact }: { contact: ContactData }) {
  const entries = Object.entries(contact.customFieldValues ?? {});
  return (
    <Card>
      <p className="mb-3 text-sm text-[var(--color-text-muted)]">
        {entries.length ? `${entries.length} additional field(s) answered` : 'No additional fields answered yet'}
      </p>
      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map(([key, value]) => (
            <InfoRow key={key} label={key} value={String(value)} />
          ))}
        </div>
      )}
    </Card>
  );
}

function UtmTab({ contact }: { contact: ContactData }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <h3 className="mb-2 font-semibold">First Attribution</h3>
        <InfoRow label="Source" value={contact.attributionFirst?.source} />
        <InfoRow label="Medium" value={contact.attributionFirst?.medium} />
        <InfoRow label="Campaign" value={contact.attributionFirst?.campaign} />
        <InfoRow label="Date" value={contact.attributionFirst?.date?.slice(0, 10)} />
      </Card>
      <Card>
        <h3 className="mb-2 font-semibold">Latest Attribution</h3>
        <InfoRow label="Source" value={contact.attributionLatest?.source} />
        <InfoRow label="Medium" value={contact.attributionLatest?.medium} />
        <InfoRow label="Campaign" value={contact.attributionLatest?.campaign} />
        <InfoRow label="Date" value={contact.attributionLatest?.date?.slice(0, 10)} />
      </Card>
    </div>
  );
}

function TimelineTab({ contactId }: { contactId: string }) {
  const { data: events, isLoading } = useQuery({
    queryKey: ['contact-timeline', contactId],
    queryFn: () => listContactTimeline(contactId),
  });
  if (isLoading) return <SkeletonList rows={4} />;
  if (!events?.length) return <EmptyState icon={Inbox} title="No timeline events yet" />;
  return (
    <div className="space-y-2">
      {events.map((event) => (
        <Card key={event._id} className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm">{event.message}</p>
            <p className="text-xs text-[var(--color-text-muted)]">{new Date(event.createdAt).toLocaleString()}</p>
          </div>
          <Badge>{event.type.replace('_', ' ')}</Badge>
        </Card>
      ))}
    </div>
  );
}

function LeadScoringTab({ contactId }: { contactId: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['lead-score', contactId], queryFn: () => getLeadScore(contactId) });

  const recalc = useMutation({
    mutationFn: () => recalculateLeadScore(contactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-score', contactId] });
      toast('Lead score recalculated', { variant: 'success' });
    },
  });

  if (isLoading) return <SkeletonList rows={3} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4">
        <div>
          <p className="text-sm text-[var(--color-text-muted)]">Current score</p>
          <p className="text-3xl font-bold">{data.score}</p>
        </div>
        <p className="text-sm text-[var(--color-text-muted)]">
          {data.updatedAt ? `Last updated ${new Date(data.updatedAt).toLocaleString()}` : 'Never updated'}
        </p>
        <Button size="sm" className="ml-auto gap-1.5" loading={recalc.isPending} onClick={() => recalc.mutate()}>
          <RefreshCw className="h-4 w-4" /> Recalculate Now
        </Button>
      </Card>

      {data.trend.length > 1 && (
        <Card>
          <h3 className="mb-3 font-semibold">Score Trend</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data.trend.map((t) => ({ ...t, at: new Date(t.at).toLocaleDateString() }))}>
              <XAxis dataKey="at" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="score" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card>
        <h3 className="mb-3 font-semibold">Why is this score {data.score}?</h3>
        {data.signals.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No signals recorded yet.</p>}
        <div className="space-y-1.5">
          {data.signals.map((signal) => (
            <div key={signal.key} className="flex items-center justify-between text-sm">
              <span>{signal.label}</span>
              <span className={signal.weight >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}>
                {signal.weight >= 0 ? '+' : ''}
                {signal.weight}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
