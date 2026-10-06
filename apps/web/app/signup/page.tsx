'use client';
import { useState } from 'react';
import { useHydrated } from '../../lib/hydrated';
import { useRouter } from 'next/navigation';
import { ApiError, api, setToken } from '../../lib/api';

const PRESETS: [string, string][] = [['real_estate', 'Real estate'], ['education', 'Education'], ['generic', 'Something else']];

/** Self-serve workspace creation. The industry choice seeds statuses, outcomes, lost reasons and fields (all editable later). */
export default function Signup() {
  const hydrated = useHydrated();
  const router = useRouter();
  const [f, setF] = useState({ name: '', email: '', password: '', tenantName: '', industryPreset: 'real_estate' });
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api<{ accessToken: string }>('/v1/auth/signup', { method: 'POST', body: f }, false); setToken(r.accessToken); router.replace('/today'); }
    catch (err) { setError(err instanceof ApiError ? (err.status === 409 ? 'That email already has an account. Sign in instead.' : err.status === 429 ? 'Too many sign-ups from this network. Try again later.' : err.message) : 'Could not create the workspace. Try again.'); }
    finally { setBusy(false); }
  }
  return (
    <main>
      <div className="bar"><h1>LeadDesk</h1></div>
      <form className="card" onSubmit={submit}>
        <h2>Create your workspace</h2>
        <label htmlFor="tn">Business name</label><input id="tn" required minLength={2} maxLength={120} value={f.tenantName} onChange={set('tenantName')} />
        <label htmlFor="ind">What do you sell?</label>
        <select id="ind" value={f.industryPreset} onChange={set('industryPreset')}>{PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <label htmlFor="nm">Your name</label><input id="nm" required maxLength={120} autoComplete="name" value={f.name} onChange={set('name')} />
        <label htmlFor="em">Work email</label><input id="em" type="email" required autoComplete="username" value={f.email} onChange={set('email')} />
        <label htmlFor="pw">Password (10+ characters)</label><input id="pw" type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={f.password} onChange={set('password')} />
        {error && <p className="err" role="alert">{error}</p>}
        <div className="row" style={{ marginTop: 16 }}><button className="primary big" disabled={busy || !hydrated}>{busy ? 'Creating…' : 'Create workspace'}</button></div>
      </form>
      <p className="reason" style={{ textAlign: 'center' }}><a href="/login">I already have an account</a></p>
    </main>
  );
}
