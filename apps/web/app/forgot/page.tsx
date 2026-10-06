'use client';
import { useState } from 'react';
import { useHydrated } from '../../lib/hydrated';
import { ApiError, api } from '../../lib/api';

/** Ask for a password reset link. The answer is identical for every address, so it never reveals who has an account. */
export default function Forgot() {
  const hydrated = useHydrated();
  const [email, setEmail] = useState(''); const [done, setDone] = useState<{ message: string; emailEnabled: boolean } | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { setDone(await api('/v1/auth/forgot', { method: 'POST', body: { email } }, false)); }
    catch (err) { setError(err instanceof ApiError && err.status === 429 ? 'Too many requests. Try again in a while.' : 'Could not send the link. Try again.'); }
    finally { setBusy(false); }
  }
  return (
    <main><div className="bar"><h1>LeadDesk</h1></div>
      {done ? (<section className="card" data-testid="forgot-done"><h2>Check your email</h2><p className="reason">{done.message}</p>{!done.emailEnabled && <p className="err">This deployment cannot send email yet. Ask your workspace owner to reset your access.</p>}<p><a href="/login">Back to sign in</a></p></section>) : (
        <form className="card" onSubmit={submit}><h2>Reset your password</h2>
          <label htmlFor="email">Your email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <p className="err" role="alert">{error}</p>}
          <div className="row" style={{ marginTop: 16 }}><button className="primary big" disabled={busy || !hydrated}>{busy ? 'Sending…' : 'Email me a link'}</button></div></form>)}
      <p className="reason" style={{ textAlign: 'center' }}><a href="/login">Back to sign in</a></p></main>
  );
}
