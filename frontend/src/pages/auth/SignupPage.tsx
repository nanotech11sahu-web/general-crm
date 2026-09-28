import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { toast } from '../../stores/toastStore';

export function SignupPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setLoading(true);
    try {
      const res = await api.post('/auth/signup', form);
      setSession({
        user: res.data.user,
        workspaceId: res.data.workspace.id,
        accessToken: res.data.accessToken,
        refreshToken: res.data.refreshToken,
      });
      toast('Workspace created', { variant: 'success', description: `Welcome to ${res.data.workspace.name}` });
      navigate('/');
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Something went wrong';
      setErrors({ form: message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-4">
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)]">
        <div className="mb-6 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-[var(--color-primary)]" aria-hidden />
          <h1 className="text-xl font-semibold">Create your PMC Demo workspace</h1>
        </div>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Input
            label="Your name"
            name="name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="Workspace name"
            name="workspaceName"
            required
            value={form.workspaceName}
            onChange={(e) => setForm({ ...form, workspaceName: e.target.value })}
          />
          <Input
            label="Email"
            type="email"
            name="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            label="Password"
            type="password"
            name="password"
            required
            minLength={8}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          {errors.form && <p className="text-sm text-[var(--color-danger)]">{errors.form}</p>}
          <Button type="submit" className="w-full" loading={loading}>
            Create workspace
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-[var(--color-text-muted)]">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-[var(--color-primary)]">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
