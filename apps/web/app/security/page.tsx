'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, logout, refresh } from '../../lib/api';

/** Own account: two-factor, password, sign out everywhere. */
export default function Security() {
  const router = useRouter();
  const [ready, setReady] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null); const [code, setCode] = useState(''); const [recovery, setRecovery] = useState<string[] | null>(null);
  const [prefs, setPrefs] = useState<{ alerts: boolean; digest: boolean; emailEnabled: boolean } | null>(null);
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [pw2, setPw2] = useState(''); const [dis, setDis] = useState('');
  useEffect(() => { (async () => { if (!(await refresh())) router.replace('/login'); else { setReady(true); api<{ alerts: boolean; digest: boolean; emailEnabled: boolean }>('/v1/me/email-preferences').then(setPrefs).catch(() => undefined); } })(); }, [router]);
  const run = async (fn: () => Promise<void>, ok: string) => { setMsg(null); try { await fn(); setMsg(ok); } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Something went wrong'); } };
  if (!ready) return <main><p className="reason">Loading…</p></main>;
  return (
    <main>
      <div className="bar"><h1>Security</h1><button onClick={() => router.push('/today')} style={{ minHeight: 36, padding: '0 12px' }}>Today</button></div>
      {msg && <p className="reason" role="status">{msg}</p>}
      {prefs && (<section className="card" data-testid="email-notices"><h2>Email notices</h2>
        {!prefs.emailEnabled && <p className="reason">Email is not set up on this deployment, so nothing is sent yet.</p>}
        {(['alerts', 'digest'] as const).map((k) => (<label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 16, color: 'inherit' }}><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={prefs[k]} onChange={(e) => run(async () => setPrefs(await api('/v1/me/email-preferences', { method: 'POST', body: { [k]: e.target.checked } })), 'Saved')} />{k === 'alerts' ? 'Connection problems (billing notices are always sent to owners and admins)' : 'Daily lead digest (managers and admins)'}</label>))}
      </section>)}
      <section className="card"><h2>Two-factor authentication</h2>
        {!setup && !recovery && <><p className="reason">Add a second step to sign-in with an authenticator app (Google Authenticator, Authy, 1Password…).</p><div className="row"><button className="primary" onClick={() => run(async () => setSetup(await api('/v1/auth/2fa/setup', { method: 'POST' })), 'Scan or enter the key, then type the 6-digit code.')}>Set up</button></div></>}
        {setup && (<>
          <p className="reason">Enter this key in your authenticator app:</p><p><code data-testid="totp-secret" style={{ wordBreak: 'break-all' }}>{setup.secret}</code></p>
          <label htmlFor="c">6-digit code</label><input id="c" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
          <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={() => run(async () => { const r = await api<{ recoveryCodes: string[] }>('/v1/auth/2fa/enable', { method: 'POST', body: { code } }); setRecovery(r.recoveryCodes); setSetup(null); setCode(''); }, 'Two-factor is on.')}>Turn on</button></div></>)}
        {recovery && (<><p className="reason" role="alert">Save these recovery codes now. Each works once, and they will not be shown again.</p><pre data-testid="recovery" style={{ whiteSpace: 'pre-wrap' }}>{recovery.join('\n')}</pre><div className="row"><button onClick={() => setRecovery(null)}>I saved them</button></div></>)}
        <details style={{ marginTop: 12 }}><summary>Turn two-factor off</summary>
          <label htmlFor="dp">Password</label><input id="dp" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <label htmlFor="dc">Authenticator or recovery code</label><input id="dc" value={dis} onChange={(e) => setDis(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}><button onClick={() => run(async () => { await api('/v1/auth/2fa/disable', { method: 'POST', body: { password: pw2, code: dis } }); setPw2(''); setDis(''); }, 'Two-factor is off.')}>Turn off</button></div></details>
      </section>
      <section className="card"><h2>Password</h2>
        <label htmlFor="cp">Current password</label><input id="cp" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        <label htmlFor="np">New password (10+ characters)</label><input id="np" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <p className="reason">Changing it signs you out everywhere.</p>
        <div className="row"><button className="primary" onClick={() => run(async () => { await api('/v1/auth/password', { method: 'POST', body: { current: cur, next } }); await logout(); router.replace('/login'); }, 'Password changed.')}>Change password</button></div>
      </section>
      <section className="card"><h2>Sessions</h2><p className="reason">Lost a phone? Sign out of every device.</p>
        <div className="row"><button onClick={() => run(async () => { await api('/v1/auth/logout-all', { method: 'POST' }); await logout(); router.replace('/login'); }, 'Signed out everywhere.')}>Sign out everywhere</button></div></section>
    </main>
  );
}
