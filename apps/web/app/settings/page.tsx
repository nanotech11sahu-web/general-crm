'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, refresh } from '../../lib/api';

interface Field { key: string; label: string; type: string; required: boolean; help?: string; pattern?: string; generated?: boolean }
interface Manifest { id: string; displayName: string; category: string; auth: { type: string }; credentialFields: Field[]; configFields: Field[]; hasWebhook: boolean }
interface Conn { id: string; name: string; provider: string; category: string; status: string; webhookPath: string; lastEventAt: string | null; lastError: string | null }
interface Member { userId: string; role: string; status: string; name?: string; email?: string }

const STATUS_DOT: Record<string, string> = { verified: '🟢', pending: '⚪', degraded: '🟠', failing: '🔴', revoked: '⚫' };
const ago = (iso: string | null) => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/** Admin: connect lead sources and channels (the form is generated from each connector's manifest) and invite the team. */
export default function Settings() {
  const router = useRouter();
  const [ready, setReady] = useState(false); const [tab, setTab] = useState<'connections' | 'team'>('connections'); const [msg, setMsg] = useState<string | null>(null);
  const [manifests, setManifests] = useState<Manifest[]>([]); const [conns, setConns] = useState<Conn[]>([]); const [members, setMembers] = useState<Member[]>([]); const [ingress, setIngress] = useState<string | null>(null);
  const [pick, setPick] = useState(''); const [name, setName] = useState(''); const [vals, setVals] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<{ title: string; items: [string, string][] } | null>(null);
  const [inv, setInv] = useState({ email: '', role: 'agent' }); const [inviteLink, setInviteLink] = useState<string | null>(null); const [emailed, setEmailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, c, u, cfg] = await Promise.all([api<Manifest[]>('/v1/connectors'), api<Conn[]>('/v1/connections'), api<Member[]>('/v1/users').catch(() => []), api<{ ingressUrl: string | null }>('/v1/app-config').catch(() => ({ ingressUrl: null }))]);
      setManifests(m); setConns(c); setMembers(u); setIngress(cfg.ingressUrl);
    } catch (e) { if (e instanceof ApiError && e.status === 401) router.replace('/login'); else if (e instanceof ApiError && e.status === 403) setMsg('Settings are for admins and owners.'); }
  }, [router]);
  useEffect(() => { (async () => { if (!(await refresh())) { router.replace('/login'); return; } setReady(true); await load(); })(); }, [router, load]);

  const man = manifests.find((m) => m.id === pick);
  const act = async (fn: () => Promise<void>, ok?: string) => { setMsg(null); try { await fn(); if (ok) setMsg(ok); await load(); } catch (e) { setMsg(e instanceof ApiError ? `${e.message}${e.details ? ': ' + Object.values(e.details).join('; ') : ''}` : 'Something went wrong'); } };

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!man) return;
    const credentials: Record<string, string> = {}, config: Record<string, string> = {};
    for (const f of man.credentialFields) if (!f.generated && vals[f.key]) credentials[f.key] = vals[f.key];
    for (const f of man.configFields) if (vals[f.key]) config[f.key] = vals[f.key];
    await act(async () => {
      const r = await api<{ connection: Conn; revealedOnce?: Record<string, string> }>('/v1/connections', { method: 'POST', body: { provider: man.id, name: name || man.displayName, credentials, config } });
      const items: [string, string][] = Object.entries(r.revealedOnce ?? {});
      if (man.hasWebhook) items.unshift(['Webhook URL', `${ingress ?? '<your ingress URL>'}${r.connection.webhookPath}`]);
      setRevealed({ title: `${r.connection.name} is connected`, items }); setPick(''); setName(''); setVals({});
    });
  }
  async function oauth(provider: string) { await act(async () => { const r = await api<{ url: string }>(`/v1/oauth/${provider}/start`); window.location.assign(r.url); }); }

  if (!ready) return <main><p className="reason">Loading…</p></main>;
  return (
    <main>
      <div className="bar"><h1>Settings</h1></div>
      {msg && <p className="reason" role="status">{msg}</p>}
      <div className="row" role="tablist" aria-label="Section">
        <button role="tab" aria-selected={tab === 'connections'} className={tab === 'connections' ? 'primary' : ''} onClick={() => setTab('connections')}>Connections</button>
        <button role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'primary' : ''} onClick={() => setTab('team')}>Team</button>
      </div>

      {tab === 'connections' && (<>
        {revealed && (
          <section className="card" role="alert" data-testid="revealed"><h2>{revealed.title}</h2>
            <p className="reason">Copy these now. Secrets are shown only once and cannot be viewed again.</p>
            {revealed.items.map(([k, v]) => <p key={k}><strong>{k}</strong><br /><code style={{ wordBreak: 'break-all' }}>{v}</code></p>)}
            <div className="row"><button onClick={() => setRevealed(null)}>I copied them</button></div>
          </section>
        )}
        <section className="card" aria-label="Connected"><h2>Connected</h2>
          {conns.length === 0 && <p className="reason">Nothing connected yet. Add your first lead source below: leads will start appearing in Today.</p>}
          {conns.map((c) => (
            <div key={c.id} style={{ margin: '10px 0' }} data-testid="connection">
              <strong>{STATUS_DOT[c.status] ?? '⚪'} {c.name}</strong> <span className="reason">({c.provider}) · {c.status} · last event {ago(c.lastEventAt)}</span>
              {c.lastError && <p className="err">{c.lastError}</p>}
              <div className="row"><button onClick={() => act(async () => { await api(`/v1/connections/${c.id}/verify`, { method: 'POST' }); }, 'Checked')}>Check now</button>
                <button onClick={() => { if (window.confirm(`Disconnect ${c.name}? New leads from it will stop.`)) void act(async () => { await api(`/v1/connections/${c.id}`, { method: 'DELETE' }); }, 'Disconnected'); }}>Disconnect</button></div>
            </div>
          ))}
        </section>
        <section className="card" aria-label="Add a connection"><h2>Add a connection</h2>
          <label htmlFor="prov">What do you want to connect?</label>
          <select id="prov" value={pick} onChange={(e) => { setPick(e.target.value); setVals({}); }}><option value="">Choose…</option>{manifests.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select>
          {man && man.auth.type === 'oauth2' && <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={() => oauth(man.id)}>Continue to {man.displayName}</button></div>}
          {man && man.auth.type !== 'oauth2' && (
            <form onSubmit={create}>
              <label htmlFor="cn">Name</label><input id="cn" placeholder={man.displayName} value={name} onChange={(e) => setName(e.target.value)} />
              {[...man.credentialFields.filter((f) => !f.generated), ...man.configFields].map((f) => (
                <div key={f.key}><label htmlFor={`f-${f.key}`}>{f.label}{f.required ? '' : ' (optional)'}</label>
                  <input id={`f-${f.key}`} type={f.type === 'secret' ? 'password' : 'text'} autoComplete="off" required={f.required} pattern={f.pattern} value={vals[f.key] ?? ''} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
                  {f.help && <p className="reason">{f.help}</p>}</div>
              ))}
              <div className="row" style={{ marginTop: 12 }}><button className="primary">Connect</button></div>
            </form>
          )}
        </section>
      </>)}

      {tab === 'team' && (<>
        <section className="card" aria-label="Invite"><h2>Invite a teammate</h2>
          <form onSubmit={(e) => { e.preventDefault(); void act(async () => { const r = await api<{ inviteToken: string; emailed?: boolean }>('/v1/invitations', { method: 'POST', body: inv }); setEmailed(!!r.emailed); setInviteLink(`${window.location.origin}/invite/${r.inviteToken}`); setInv({ ...inv, email: '' }); }); }}>
            <label htmlFor="ie">Email</label><input id="ie" type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />
            <label htmlFor="ir">Role</label><select id="ir" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}><option value="agent">Agent</option><option value="manager">Manager</option><option value="admin">Admin</option></select>
            <div className="row" style={{ marginTop: 12 }}><button className="primary">Create invite link</button></div>
          </form>
          {inviteLink && <div data-testid="invite-link"><p className="reason">{emailed ? 'We emailed the invitation. You can also send this link yourself (valid 7 days, single use).' : 'Email is not set up here, so send this link yourself (valid 7 days, single use).'}</p><p><code style={{ wordBreak: 'break-all' }}>{inviteLink}</code></p></div>}
        </section>
        <section className="card" aria-label="Members"><h2>Members</h2>
          <ul className="list">{members.map((m) => <li key={m.userId}><span>{m.name} <span className="reason">{m.email}</span></span><span>{m.role}{m.status !== 'active' ? ' (inactive)' : ''}</span></li>)}</ul>
        </section>
      </>)}
    </main>
  );
}
