import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, ExternalLink, Copy } from 'lucide-react';
import clsx from 'clsx';
import { getForm, updateForm, getFormSubmissions, getFormAnalytics } from '../../lib/api/forms';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { Inbox } from 'lucide-react';
import { toast } from '../../stores/toastStore';
import type { FormField, FormFieldType } from '../../types/leadgen';

const TABS = ['Edit', 'Settings', 'Submissions', 'Analytics'] as const;
type Tab = (typeof TABS)[number];

export function FormBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('Edit');

  const { data: form, isLoading } = useQuery({ queryKey: ['form', id], queryFn: () => getForm(id!), enabled: Boolean(id) });

  const publishMutation = useMutation({
    mutationFn: () => updateForm(id!, { status: form?.status === 'published' ? 'draft' : 'published' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form', id] });
      toast(form?.status === 'published' ? 'Form unpublished' : 'Form published', { variant: 'success' });
    },
  });

  if (isLoading) return <SkeletonList rows={5} />;
  if (!form) return null;

  const publicUrl = `${window.location.origin}/f/${form._id}`;

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{form.name}</h1>
          <Badge tone={form.status === 'published' ? 'success' : 'neutral'}>{form.status}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <code className="rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] px-2 py-1 text-xs">{publicUrl}</code>
          <button
            type="button"
            aria-label="Copy public URL"
            onClick={() => {
              navigator.clipboard.writeText(publicUrl);
              toast('Link copied', { variant: 'success' });
            }}
          >
            <Copy className="h-4 w-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" />
          </button>
          <a href={`/f/${form._id}`} target="_blank" rel="noreferrer" aria-label="Open public form">
            <ExternalLink className="h-4 w-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" />
          </a>
          <Button size="sm" loading={publishMutation.isPending} onClick={() => publishMutation.mutate()}>
            {form.status === 'published' ? 'Unpublish' : 'Publish'}
          </Button>
        </div>
      </div>

      <nav className="flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'Edit' && <EditTab formId={form._id} fields={form.fields} />}
      {tab === 'Settings' && <SettingsTab formId={form._id} settings={form.settings} />}
      {tab === 'Submissions' && <SubmissionsTab formId={form._id} />}
      {tab === 'Analytics' && <AnalyticsTab formId={form._id} />}
    </div>
  );
}

const FIELD_TYPES: FormFieldType[] = ['short_text', 'long_text', 'email', 'phone', 'name', 'dropdown'];

function EditTab({ formId, fields }: { formId: string; fields: FormField[] }) {
  const queryClient = useQueryClient();
  const [localFields, setLocalFields] = useState(fields);

  const mutation = useMutation({
    mutationFn: () => updateForm(formId, { fields: localFields }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form', formId] });
      toast('Fields saved', { variant: 'success' });
    },
  });

  function addField(type: FormFieldType) {
    setLocalFields((prev) => [
      ...prev.slice(0, -1),
      { id: `field-${Date.now()}`, type, label: type.replace('_', ' '), required: false, options: [] },
      prev[prev.length - 1],
    ]);
  }

  function removeField(id: string) {
    setLocalFields((prev) => prev.filter((f) => f.id !== id));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="space-y-2 lg:col-span-1">
        <h3 className="font-semibold">Field Library</h3>
        {FIELD_TYPES.map((type) => (
          <Button key={type} variant="secondary" size="sm" className="w-full justify-start gap-1.5" onClick={() => addField(type)}>
            <Plus className="h-4 w-4" /> {type.replace('_', ' ')}
          </Button>
        ))}
      </Card>

      <Card className="space-y-2 lg:col-span-2">
        <h3 className="font-semibold">Fields</h3>
        {localFields.map((field) => (
          <div key={field.id} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
            <Badge>{field.type}</Badge>
            <Input aria-label="Field label" value={field.label} className="flex-1" onChange={(e) => setLocalFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, label: e.target.value } : f)))} />
            {field.type !== 'submit' && (
              <button type="button" aria-label="Remove field" onClick={() => removeField(field.id)} className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)]">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        <Button size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Save
        </Button>
      </Card>
    </div>
  );
}

function SettingsTab({ formId, settings }: { formId: string; settings: import('../../types/leadgen').FormDoc['settings'] }) {
  const queryClient = useQueryClient();
  const [local, setLocal] = useState(settings);

  const mutation = useMutation({
    mutationFn: () => updateForm(formId, { settings: local }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['form', formId] });
      toast('Settings saved', { variant: 'success' });
    },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3">
        <h3 className="font-semibold">On Submit Action</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={local.onSubmitAction === 'message'} onChange={() => setLocal({ ...local, onSubmitAction: 'message' })} />
          Show a message
        </label>
        {local.onSubmitAction === 'message' && (
          <Input aria-label="Submit message" value={local.onSubmitMessage} onChange={(e) => setLocal({ ...local, onSubmitMessage: e.target.value })} />
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={local.onSubmitAction === 'redirect'} onChange={() => setLocal({ ...local, onSubmitAction: 'redirect' })} />
          Redirect to a URL
        </label>
        {local.onSubmitAction === 'redirect' && (
          <Input aria-label="Redirect URL" value={local.redirectUrl ?? ''} onChange={(e) => setLocal({ ...local, redirectUrl: e.target.value })} />
        )}
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold">Contact Handling</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={local.autoCreateContact} onChange={(e) => setLocal({ ...local, autoCreateContact: e.target.checked })} />
          Auto-create/update contact on submit
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={local.skipContactCreation} onChange={(e) => setLocal({ ...local, skipContactCreation: e.target.checked })} />
          Skip contact creation for this form
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>Lifecycle stage on submit</span>
          <select
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
            value={local.lifecycleStageOnSubmit}
            onChange={(e) => setLocal({ ...local, lifecycleStageOnSubmit: e.target.value })}
          >
            {['Lead', 'MQL', 'SQL'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold">Compliance & Security</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={local.gdprConsent} onChange={(e) => setLocal({ ...local, gdprConsent: e.target.checked })} />
          Require GDPR consent checkbox
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={local.requireCaptcha} onChange={(e) => setLocal({ ...local, requireCaptcha: e.target.checked })} />
          Require "I'm not a robot" checkbox
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>Rate limit (submissions / hour / IP)</span>
          <input
            type="number"
            className="h-8 w-20 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
            value={local.rateLimitPerHour}
            onChange={(e) => setLocal({ ...local, rateLimitPerHour: Number(e.target.value) })}
          />
        </label>
        <p className="text-xs text-[var(--color-text-muted)]">UTM, referrer, device, and session are captured automatically on every submission.</p>
      </Card>

      <div>
        <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Save Settings
        </Button>
      </div>
    </div>
  );
}

function SubmissionsTab({ formId }: { formId: string }) {
  const { data: submissions, isLoading } = useQuery({ queryKey: ['form-submissions', formId], queryFn: () => getFormSubmissions(formId) });
  if (isLoading) return <SkeletonList rows={3} />;
  if (!submissions?.length) return <EmptyState icon={Inbox} title="No submissions yet" description="Share the public form link to start collecting responses." />;
  return (
    <div className="space-y-2">
      {submissions.map((s) => (
        <Card key={s._id}>
          <p className="text-xs text-[var(--color-text-muted)]">{new Date(s.createdAt).toLocaleString()}</p>
          <pre className="mt-1 whitespace-pre-wrap text-sm">{JSON.stringify(s.data, null, 2)}</pre>
        </Card>
      ))}
    </div>
  );
}

function AnalyticsTab({ formId }: { formId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['form-analytics', formId], queryFn: () => getFormAnalytics(formId) });
  if (isLoading) return <SkeletonList rows={2} />;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <p className="text-sm text-[var(--color-text-muted)]">Total Submissions</p>
        <p className="text-2xl font-semibold">{data?.totalSubmissions ?? 0}</p>
      </Card>
      <Card>
        <p className="text-sm text-[var(--color-text-muted)]">Contacts Created</p>
        <p className="text-2xl font-semibold">{data?.contactsCreated ?? 0}</p>
      </Card>
    </div>
  );
}
