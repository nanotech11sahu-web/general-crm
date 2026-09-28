import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock, MapPin, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/apiClient';
import type { BookingFormField, LocationType } from '../../types/sales';

interface PublicEventType {
  id: string;
  name: string;
  description?: string;
  durationMinutes: number;
  locationType: LocationType;
  locationDetails?: string;
  timezone: string;
  requirePayment: boolean;
  price: number;
  currency: string;
  bookingFormFields: BookingFormField[];
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function PublicBookingPage() {
  const { publicId } = useParams<{ publicId: string }>();
  const [date, setDate] = useState(todayStr());
  const [selectedSlot, setSelectedSlot] = useState<{ startAt: string; endAt: string } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-booking', publicId],
    queryFn: async () => (await api.get(`/public/booking/${publicId}`)).data.eventType as PublicEventType,
  });

  const { data: slots, isFetching: slotsLoading } = useQuery({
    queryKey: ['public-booking-slots', publicId, date],
    queryFn: async () => (await api.get(`/public/booking/${publicId}/slots`, { params: { date } })).data.slots as { startAt: string; endAt: string }[],
    enabled: Boolean(publicId && date),
  });

  const dateOptions = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  }), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot) return;
    setError('');
    try {
      await api.post(`/public/booking/${publicId}/book`, {
        startAt: selectedSlot.startAt,
        endAt: selectedSlot.endAt,
        formResponses: values,
      });
      setConfirmed(true);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Something went wrong. Please try again.';
      setError(message);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading booking page…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Booking page not available</h1>
        <p className="text-slate-500">This calendar hasn't been published yet.</p>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          <p className="mt-3 text-lg font-medium text-slate-900">You're booked!</p>
          <p className="mt-1 text-sm text-slate-500">A confirmation has been sent. See you soon.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="grid w-full max-w-3xl grid-cols-1 gap-0 overflow-hidden rounded-xl bg-white shadow md:grid-cols-2">
        <div className="border-b border-slate-100 p-6 md:border-b-0 md:border-r">
          <h1 className="text-xl font-semibold text-slate-900">{data.name}</h1>
          {data.description && <p className="mt-1 text-sm text-slate-500">{data.description}</p>}
          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <p className="flex items-center gap-2">
              <Clock className="h-4 w-4" /> {data.durationMinutes} minutes
            </p>
            <p className="flex items-center gap-2">
              <MapPin className="h-4 w-4" /> {data.locationType.replace('_', ' ')}
            </p>
            <p className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> {data.timezone}
            </p>
            {data.requirePayment && <p className="font-medium text-slate-900">{data.currency} {data.price}</p>}
          </div>
        </div>

        <div className="p-6">
          <label htmlFor="booking-date" className="text-sm font-medium text-slate-700">
            Select a date
          </label>
          <select
            id="booking-date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setSelectedSlot(null);
            }}
            className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
          >
            {dateOptions.map((d) => (
              <option key={d} value={d}>
                {new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </option>
            ))}
          </select>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {slotsLoading && <p className="col-span-3 text-sm text-slate-400">Loading times…</p>}
            {!slotsLoading && slots?.length === 0 && <p className="col-span-3 text-sm text-slate-400">No times available this day.</p>}
            {slots?.map((slot) => (
              <button
                key={slot.startAt}
                type="button"
                onClick={() => setSelectedSlot(slot)}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium ${
                  selectedSlot?.startAt === slot.startAt ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700 hover:border-slate-400'
                }`}
              >
                {new Date(slot.startAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </button>
            ))}
          </div>

          {selectedSlot && (
            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              {data.bookingFormFields.map((field) => (
                <div key={field.key} className="space-y-1">
                  <label htmlFor={field.key} className="text-sm font-medium text-slate-700">
                    {field.label}
                    {field.required && ' *'}
                  </label>
                  <input
                    id={field.key}
                    required={field.required}
                    type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
                    value={values[field.key] ?? ''}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                  />
                </div>
              ))}
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button type="submit" className="h-10 w-full rounded-md bg-slate-900 text-sm font-medium text-white">
                Confirm Booking
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
