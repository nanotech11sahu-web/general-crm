'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { startRegistration } from '@simplewebauthn/browser';
import { ApiError, api, logout, refresh } from '../../lib/api';

/** Own account: two-factor, password, sign out everywhere. */
export default function Security() {
  const router = useRouter();
  const [ready, setReady] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null); const [code, setCode] = useState(''); const [recovery, setRecovery] = useState<string[] | null>(null);
  const [keys, setKeys] = useState<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }[]>([]); const [keyName, setKeyName] = useState(''); const [role, setRole] = useState(''); const [policy, setPolicy] = useState<string[] | null>(null); const [required, setRequired] = useState(false);
  const [prefs, setPrefs] = useState<{ alerts: boolean; digest: boolean; emailEnabled: boolean } | null>(null);
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [pw2, setPw2] = useState(''); const [dis, setDis] = useState('');
  useEffect(() => { (async () => { if (!(await refresh())) router.replace('/login'); else { setReady(true); api<typeof keys>('/v1/auth/passkeys').then(setKeys).catch(() => undefined); setRequired(new URLSearchParams(window.location.search).has('required')); api<{ role: string }>('/v1/me').then((m) => { setRole(m.role); if (m.role === 'owner') api<{ require2faRoles: string[] }>('/v1/security/policy').then((p) => setPolicy(p.require2faRoles)).catch(() => undefined); }).catch(() => undefined); api<{ alerts: boolean; digest: boolean; emailEnabled: boolean }>('/v1/me/email-preferences').then(setPrefs).catch(() => undefined); } })(); }, [router]);
  const run = async (fn: () => Promise<void>, ok: string) => { setMsg(null); try { await fn(); setMsg(ok); } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Something went wrong'); } };
  if (!ready) return <main><p className="reason">Loading…</p></main>;
  return (
    <main>
      <div className="bar"><h1>Security</h1></div>
      {msg && <p className="reason" role="status">{msg}</p>}
      {required && <p className="err" role="alert" data-testid="2fa-required">Your workspace requires two-factor authentication for your role. Set it up below to continue.</p>}
      <section className="card" data-testid="passkeys"><h2>Passkeys</h2>
        <p className="reason">Sign in with your fingerprint, face or a security key instead of typing a code. Passkeys count as two-factor.</p>
        <ul className="list">{keys.map((k) => (<li key={k.id}><span><b>{k.name}</b><br /><span className="reason">Added {new Date(k.createdAt).toLocaleDateString()}{k.lastUsedAt ? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ''}</span></span><span><button style={{ minHeight: 32, padding: '0 10px' }} onClick={() => { const pw = window.prompt('Confirm with your password to remove this passkey'); if (pw) void run(async () => setKeys(await api(`/v1/auth/passkeys/${encodeURIComponent(k.id)}/remove`, { method: 'POST', body: { password: pw } })), 'Passkey removed'); }}>Remove</button></span></li>))}</ul>
        <div className="row"><input aria-label="Passkey name" placeholder="Name it (e.g. Work laptop)" value={keyName} onChange={(e) => setKeyName(e.target.value)} style={{ flex: 1 }} />
          <button className="primary" onClick={() => run(async () => { const { options, challengeToken } = await api<{ options: any; challengeToken: string }>('/v1/auth/passkeys/register/options', { method: 'POST' }); const response = await startRegistration({ optionsJSON: options }); setKeys(await api('/v1/auth/passkeys/register/verify', { method: 'POST', body: { challengeToken, response, name: keyName } })); setKeyName(''); }, 'Passkey added')}>Add a passkey</button></div></section>
      {role === 'owner' && policy && (<section className="card" data-testid="2fa-policy"><h2>Require two-factor for your team</h2>
        <p className="reason">People in the roles you tick can only reach this page until they have set up an authenticator app (or a passkey). Turn it on for yourself first.</p>
        {(['owner', 'admin', 'manager', 'agent'] as const).map((r) => (<label key={r} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 16, color: 'inherit' }}><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={policy.includes(r)} onChange={(e) => { const next = e.target.checked ? [...policy, r] : policy.filter((x) => x !== r); void run(async () => { const res = await api<{ require2faRoles: string[] }>('/v1/security/policy', { method: 'PUT', body: { require2faRoles: next } }); setPolicy(res.require2faRoles); }, 'Saved'); }} />{r === 'owner' ? 'Owners' : r === 'admin' ? 'Admins' : r === 'manager' ? 'Managers' : 'Agents'}</label>))}</section>)}
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
