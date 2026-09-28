import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import type { FormField } from '../../types/leadgen';

interface PublicFormResponse {
  form: {
    id: string;
    name: string;
    fields: FormField[];
    style: { pageBackground: string; cardBackground: string; buttonBackground: string; cornerRadius: number };
    settings: { gdprConsent: boolean; onSubmitAction: 'message' | 'redirect' };
  };
}

export function PublicFormPage() {
  const { id } = useParams<{ id: string }>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState<{ message: string; redirectUrl?: string } | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-form', id],
    queryFn: async () => (await api.get(`/public/forms/${id}`)).data as PublicFormResponse,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post(`/public/forms/${id}/submit`, {
        data: { ...values, consent },
      });
      setSubmitted({ message: res.data.message, redirectUrl: res.data.redirectUrl });
      if (res.data.onSubmitAction === 'redirect' && res.data.redirectUrl) {
        window.location.href = res.data.redirectUrl;
      }
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Something went wrong. Please try again.';
      setError(message);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading form…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Form not available</h1>
        <p className="text-slate-500">This form hasn't been published yet.</p>
      </div>
    );
  }

  const { form } = data;

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow">
          <p className="text-lg font-medium text-slate-900">{submitted.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12" style={{ backgroundColor: form.style.pageBackground }}>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 p-8 shadow"
        style={{ backgroundColor: form.style.cardBackground, borderRadius: form.style.cornerRadius }}
      >
        <h1 className="text-xl font-semibold text-slate-900">{form.name}</h1>
        {form.fields
          .filter((f) => f.type !== 'submit')
          .map((field) => (
            <div key={field.id} className="space-y-1">
              <label htmlFor={field.id} className="text-sm font-medium text-slate-700">
                {field.label}
                {field.required && ' *'}
              </label>
              <input
                id={field.id}
                required={field.required}
                type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
                value={values[field.id] ?? ''}
                onChange={(e) => setValues({ ...values, [field.id]: e.target.value })}
                className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
              />
            </div>
          ))}
        {form.settings.gdprConsent && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />I consent to be contacted.
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          className="h-10 w-full rounded-md font-medium text-white"
          style={{ backgroundColor: form.style.buttonBackground }}
        >
          Submit
        </button>
      </form>
    </div>
  );
}
