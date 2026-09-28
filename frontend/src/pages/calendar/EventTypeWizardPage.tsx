import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, AlertCircle, Copy, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { getEventType, updateEventType, publishEventType, deleteEventType } from '../../lib/api/eventTypes';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';
import type { AvailabilityWindow, BookingFormField, EventTypeDoc, LocationType } from '../../types/sales';

const STEPS = ['Calendar Details', 'Schedule & Availability', 'Staff & Team', 'Settings & Payment', 'Booking Form Fields', 'Review & Publish'] as const;

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const LOCATION_META: Record<LocationType, { label: string; note: string }> = {
  zoom: { label: 'Zoom', note: 'A unique Zoom link is generated per booking.' },
  google_meet: { label: 'Google Meet', note: 'A Google Meet link is generated per booking.' },
  phone: { label: 'Phone Call', note: 'Enter the number the staff member will call from.' },
  in_person: { label: 'In-Person', note: 'Enter the physical address for this meeting.' },
};

type FormState = Pick<
  EventTypeDoc,
  | 'name'
  | 'description'
  | 'durationMinutes'
  | 'locationType'
  | 'locationDetails'
  | 'availability'
  | 'bufferBeforeMinutes'
  | 'bufferAfterMinutes'
  | 'minNoticeHours'
  | 'dateRangeDays'
  | 'staffMembershipIds'
  | 'assignmentMethod'
  | 'requirePayment'
  | 'price'
  | 'currency'
  | 'requireApproval'
  | 'confirmationMessage'
  | 'bookingFormFields'
>;

export function EventTypeWizardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['event-type', id], queryFn: () => getEventType(id!), enabled: Boolean(id) });

  useEffect(() => {
    if (data?.eventType && !form) {
      const { name, description, durationMinutes, locationType, locationDetails, availability, bufferBeforeMinutes, bufferAfterMinutes, minNoticeHours, dateRangeDays, staffMembershipIds, assignmentMethod, requirePayment, price, currency, requireApproval, confirmationMessage, bookingFormFields } = data.eventType;
      setForm({ name, description, durationMinutes, locationType, locationDetails, availability, bufferBeforeMinutes, bufferAfterMinutes, minNoticeHours, dateRangeDays, staffMembershipIds, assignmentMethod, requirePayment, price, currency, requireApproval, confirmationMessage, bookingFormFields });
    }
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: () => updateEventType(id!, form!),
    onSuccess: (res) => {
      queryClient.setQueryData(['event-type', id], res);
      toast('Draft saved', { variant: 'success' });
    },
    onError: () => toast('Could not save draft', { variant: 'error' }),
  });

  const publishMutation = useMutation({
    mutationFn: () => publishEventType(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-type', id] });
      toast('Calendar published', { variant: 'success' });
    },
    onError: () => toast('Fix the issues above before publishing', { variant: 'error' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteEventType(id!),
    onSuccess: () => {
      toast('Draft deleted', { variant: 'success' });
      navigate('/calendar');
    },
  });

  if (isLoading || !form || !data) return <SkeletonList rows={6} />;

  const { eventType, issues } = data;
  const update = (patch: Partial<FormState>) => setForm((prev) => (prev ? { ...prev, ...patch } : prev));

  async function handleNext() {
    await saveMutation.mutateAsync();
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => navigate('/calendar')} className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <ArrowLeft className="h-4 w-4" /> Back to Calendar
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{eventType.name}</h1>
          <Badge tone={eventType.status === 'published' ? 'success' : 'neutral'}>{eventType.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            Save Draft
          </Button>
          <Button size="sm" variant="danger" className="gap-1.5" onClick={() => deleteMutation.mutate()}>
            <Trash2 className="h-3.5 w-3.5" /> Delete Draft
          </Button>
        </div>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">Changes autosave to your draft each time you move to the next step.</p>

      <nav aria-label="Wizard steps" className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(i)}
            className={clsx(
              'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium',
              i === step
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)]',
            )}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-surface-muted)] text-[10px]">{i + 1}</span>
            {label}
          </button>
        ))}
      </nav>

      <Card>
        {step === 0 && <CalendarDetailsStep form={form} update={update} />}
        {step === 1 && <ScheduleStep form={form} update={update} />}
        {step === 2 && <StaffStep form={form} update={update} />}
        {step === 3 && <SettingsStep form={form} update={update} />}
        {step === 4 && <BookingFieldsStep form={form} update={update} />}
        {step === 5 && <ReviewStep eventType={eventType} issues={issues} publicId={eventType.publicId} />}
      </Card>

      <div className="flex justify-between">
        <Button variant="secondary" disabled={step === 0} onClick={() => setStep((s) => Math.max(s - 1, 0))}>
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button loading={saveMutation.isPending} onClick={handleNext}>
            Save & Continue
          </Button>
        ) : (
          <Button
            loading={publishMutation.isPending}
            disabled={eventType.status === 'published' || issues.length > 0}
            className="gap-1.5"
            onClick={() => publishMutation.mutate()}
          >
            <Check className="h-4 w-4" /> {eventType.status === 'published' ? 'Published' : 'Publish'}
          </Button>
        )}
      </div>
    </div>
  );
}

function CalendarDetailsStep({ form, update }: { form: FormState; update: (p: Partial<FormState>) => void }) {
  return (
    <div className="space-y-4">
      <Input label="Name" value={form.name} onChange={(e) => update({ name: e.target.value })} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Description</span>
        <textarea
          className="min-h-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm"
          value={form.description ?? ''}
          onChange={(e) => update({ description: e.target.value })}
        />
      </label>
      <Input
        label="Duration (minutes)"
        type="number"
        min={5}
        value={form.durationMinutes}
        onChange={(e) => update({ durationMinutes: Number(e.target.value) })}
      />
      <div className="space-y-2">
        <p className="text-sm font-medium">Location</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(LOCATION_META) as LocationType[]).map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => update({ locationType: loc })}
              className={clsx(
                'rounded-[var(--radius-md)] border p-2 text-sm',
                form.locationType === loc ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10' : 'border-[var(--color-border)]',
              )}
            >
              {LOCATION_META[loc].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">{LOCATION_META[form.locationType].note}</p>
        {(form.locationType === 'phone' || form.locationType === 'in_person') && (
          <Input
            label={form.locationType === 'phone' ? 'Phone Number' : 'Address'}
            value={form.locationDetails ?? ''}
            onChange={(e) => update({ locationDetails: e.target.value })}
          />
        )}
      </div>
    </div>
  );
}

function ScheduleStep({ form, update }: { form: FormState; update: (p: Partial<FormState>) => void }) {
  function updateDay(day: number, patch: Partial<AvailabilityWindow>) {
    update({ availability: form.availability.map((w) => (w.day === day ? { ...w, ...patch } : w)) });
  }
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        {form.availability.map((window) => (
          <div key={window.day} className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex w-28 items-center gap-2">
              <input type="checkbox" checked={window.enabled} onChange={(e) => updateDay(window.day, { enabled: e.target.checked })} />
              {DAY_LABELS[window.day]}
            </label>
            <input
              type="time"
              disabled={!window.enabled}
              value={window.startTime}
              onChange={(e) => updateDay(window.day, { startTime: e.target.value })}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 disabled:opacity-40"
            />
            <span className="text-[var(--color-text-muted)]">to</span>
            <input
              type="time"
              disabled={!window.enabled}
              value={window.endTime}
              onChange={(e) => updateDay(window.day, { endTime: e.target.value })}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 disabled:opacity-40"
            />
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Buffer before (min)" type="number" min={0} value={form.bufferBeforeMinutes} onChange={(e) => update({ bufferBeforeMinutes: Number(e.target.value) })} />
        <Input label="Buffer after (min)" type="number" min={0} value={form.bufferAfterMinutes} onChange={(e) => update({ bufferAfterMinutes: Number(e.target.value) })} />
        <Input label="Minimum notice (hours)" type="number" min={0} value={form.minNoticeHours} onChange={(e) => update({ minNoticeHours: Number(e.target.value) })} />
      </div>
      <Input label="Bookable how many days out?" type="number" min={1} value={form.dateRangeDays} onChange={(e) => update({ dateRangeDays: Number(e.target.value) })} />
    </div>
  );
}

function StaffStep({ form, update }: { form: FormState; update: (p: Partial<FormState>) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-text-muted)]">Staff assignment across the workspace's team is available once Staff management ships in Settings.</p>
      <div className="space-y-2">
        {(['round_robin', 'all_staff', 'specific'] as const).map((method) => (
          <label key={method} className="flex items-center gap-2 text-sm">
            <input type="radio" checked={form.assignmentMethod === method} onChange={() => update({ assignmentMethod: method })} />
            {method === 'round_robin' ? 'Round Robin' : method === 'all_staff' ? 'All Staff' : 'Specific Staff'}
          </label>
        ))}
      </div>
    </div>
  );
}

function SettingsStep({ form, update }: { form: FormState; update: (p: Partial<FormState>) => void }) {
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.requirePayment} onChange={(e) => update({ requirePayment: e.target.checked })} />
        Require payment at booking
      </label>
      {form.requirePayment && (
        <div className="grid grid-cols-2 gap-3">
          <Input label="Price" type="number" min={0} value={form.price} onChange={(e) => update({ price: Number(e.target.value) })} />
          <Input label="Currency" value={form.currency} onChange={(e) => update({ currency: e.target.value })} />
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.requireApproval} onChange={(e) => update({ requireApproval: e.target.checked })} />
        Require manual approval before confirming
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Confirmation Message</span>
        <textarea
          className="min-h-16 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm"
          value={form.confirmationMessage ?? ''}
          onChange={(e) => update({ confirmationMessage: e.target.value })}
        />
      </label>
    </div>
  );
}

function BookingFieldsStep({ form, update }: { form: FormState; update: (p: Partial<FormState>) => void }) {
  function addField() {
    const field: BookingFormField = { key: `field_${Date.now()}`, label: 'Custom Field', type: 'text', required: false };
    update({ bookingFormFields: [...form.bookingFormFields, field] });
  }
  function updateField(key: string, patch: Partial<BookingFormField>) {
    update({ bookingFormFields: form.bookingFormFields.map((f) => (f.key === key ? { ...f, ...patch } : f)) });
  }
  function removeField(key: string) {
    update({ bookingFormFields: form.bookingFormFields.filter((f) => f.key !== key) });
  }
  return (
    <div className="space-y-3">
      {form.bookingFormFields.map((field) => (
        <div key={field.key} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
          <Input aria-label="Field label" value={field.label} onChange={(e) => updateField(field.key, { label: e.target.value })} className="w-40" />
          <select
            aria-label="Field type"
            className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
            value={field.type}
            onChange={(e) => updateField(field.key, { type: e.target.value as BookingFormField['type'] })}
          >
            {['text', 'email', 'phone', 'textarea', 'select'].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={field.required} onChange={(e) => updateField(field.key, { required: e.target.checked })} />
            Required
          </label>
          {!['name', 'email'].includes(field.key) && (
            <Button size="sm" variant="ghost" aria-label={`Remove ${field.label}`} onClick={() => removeField(field.key)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={addField}>
        Add Field
      </Button>
    </div>
  );
}

function ReviewStep({ eventType, issues, publicId }: { eventType: EventTypeDoc; issues: string[]; publicId: string }) {
  const bookingUrl = `${window.location.origin}/book/${publicId}`;
  return (
    <div className="space-y-4">
      {issues.length > 0 ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-danger)]">
            <AlertCircle className="h-4 w-4" /> Issues — {issues.length} error{issues.length > 1 ? 's' : ''}
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm text-[var(--color-danger)]">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-[var(--color-success)]">
          <Check className="h-4 w-4" /> Ready to publish
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-[var(--color-text-muted)]">Name</dt>
          <dd>{eventType.name}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-muted)]">Duration</dt>
          <dd>{eventType.durationMinutes} min</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-muted)]">Location</dt>
          <dd className="capitalize">{eventType.locationType.replace('_', ' ')}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-muted)]">Payment</dt>
          <dd>{eventType.requirePayment ? `${eventType.currency} ${eventType.price}` : 'Not required'}</dd>
        </div>
      </dl>

      <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-2 text-sm">
        <span className="truncate">{bookingUrl}</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto gap-1"
          onClick={() => {
            navigator.clipboard?.writeText(bookingUrl);
            toast('Booking link copied', { variant: 'success' });
          }}
        >
          <Copy className="h-3.5 w-3.5" /> Copy
        </Button>
      </div>
    </div>
  );
}
