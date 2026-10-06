'use client';
import { useState } from 'react';
import { useHydrated } from '../../../lib/hydrated';
import { useParams } from 'next/navigation';
import { ApiError, api } from '../../../lib/api';

/** Landing page for a reset link: choose a new password; every device is signed out afterwards. */
export default function Reset() {
  const hydrated = useHydrated();
  const { token } = useParams<{ token: string }>();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [error, setError] = useState<string | null>(null); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (pw !== pw2) { setError('The two passwords do not match'); return; }
    setBusy(true);
    try { await api('/v1/auth/reset', { method: 'POST', body: { token, password: pw } }, false); setDone(true); }
    catch (err) { setError(err instanceof ApiError && err.status === 400 ? 'This link is invalid, expired or already used. Ask for a new one.' : 'Could not reset the password. Try again.'); }
    finally { setBusy(false); }
  }
  return (
    <main><div className="bar"><h1>LeadDesk</h1></div>
      {done ? (<section className="card" data-testid="reset-done"><h2>Password changed</h2><p className="reason">You were signed out everywhere. Sign in with your new password.</p><div className="row"><a className="btn primary" href="/login">Sign in</a></div></section>) : (
        <form className="card" onSubmit={submit}><h2>Choose a new password</h2>
          <label htmlFor="p">New password (10+ characters)</label><input id="p" type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <label htmlFor="p2">Repeat it</label><input id="p2" type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          {error && <p className="err" role="alert">{error}</p>}
          <div className="row" style={{ marginTop: 16 }}><button className="primary big" disabled={busy || !hydrated}>{busy ? 'Saving…' : 'Change password'}</button></div></form>)}</main>
  );
}
