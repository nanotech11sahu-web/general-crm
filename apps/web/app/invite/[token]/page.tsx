'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, api, setToken } from '../../../lib/api';

/** Landing page for an invitation link. */
export default function Invite() {
  const { token } = useParams<{ token: string }>(); const router = useRouter();
  const [name, setName] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api<{ accessToken: string }>(`/v1/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST', body: { name, password } }, false); setToken(r.accessToken); router.replace('/today'); }
    catch (err) { setError(err instanceof ApiError && err.status === 400 ? 'This invitation has expired or was already used. Ask your admin for a new one.' : 'Could not join. Try again.'); }
    finally { setBusy(false); }
  }
  return (
    <main><div className="bar"><h1>LeadDesk</h1></div>
      <form className="card" onSubmit={submit}><h2>Join your team</h2>
        <label htmlFor="n">Your name</label><input id="n" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="p">Choose a password (10+ characters)</label><input id="p" type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="err" role="alert">{error}</p>}
        <div className="row" style={{ marginTop: 16 }}><button className="primary big" disabled={busy}>{busy ? 'Joining…' : 'Join'}</button></div>
      </form></main>
  );
}
