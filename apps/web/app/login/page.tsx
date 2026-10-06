'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, login } from '../../lib/api';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [totp, setTotp] = useState(''); const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await login(email, password, needTotp ? totp : undefined); router.replace('/today'); }
    catch (err) {
      if (err instanceof ApiError && err.code === 'totp_required') { setNeedTotp(true); setError(null); }
      else if (err instanceof ApiError && err.code === 'totp_invalid') setError('That code did not work');
      else if (err instanceof ApiError && (err.status === 429)) setError('Too many attempts. Wait a few minutes and try again.');
      else setError(err instanceof ApiError && err.status === 401 ? 'Wrong email or password' : 'Could not sign in. Try again.');
    }
    finally { setBusy(false); }
  }
  return (
    <main>
      <div className="bar"><h1>LeadDesk</h1></div>
      <form className="card" onSubmit={submit}>
        <h2>Sign in</h2>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {needTotp && (<><label htmlFor="totp">Authenticator code (or a recovery code)</label><input id="totp" inputMode="numeric" autoComplete="one-time-code" autoFocus required value={totp} onChange={(e) => setTotp(e.target.value)} /></>)}
        {error && <p className="err" role="alert">{error}</p>}
        <div className="row" style={{ marginTop: 16 }}><button className="primary big" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></div>
      </form>
      <p className="reason" style={{ textAlign: 'center' }}><a href="/signup">Create a workspace</a></p>
    </main>
  );
}
