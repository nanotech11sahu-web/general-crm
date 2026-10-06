'use client';
import { useState } from 'react';
import { api } from '../../lib/api';
import { csv, useResource, type Member } from '../../lib/admin';

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
interface Team { id: string; name: string; leadUserId: string | null; members: number }
const small = { minHeight: 32, padding: '0 10px' };

/** Teams, each person's routing profile (skills, languages, capacity, leave), and offboarding with lead reassignment. */
export default function TeamTab({ run, role }: { run: Run; role: string }) {
  const users = useResource<Member[]>('/v1/users', []); const teams = useResource<Team[]>('/v1/teams', []);
  const [nt, setNt] = useState(''); const [sel, setSel] = useState<Member | null>(null); const [p, setP] = useState({ skills: '', languages: '', maxOpenLeads: '', onLeaveUntil: '', teamId: '' }); const [off, setOff] = useState<Member | null>(null); const [to, setTo] = useState('');
  const active = users.data.filter((m) => m.status === 'active');
  const pick = (m: Member) => { setSel(m); setP({ skills: '', languages: '', maxOpenLeads: '', onLeaveUntil: '', teamId: m.teamId ?? '' }); };
  const reload = async () => { await Promise.all([users.reload(), teams.reload()]); };
  return (<>
    <section className="card" data-testid="teams"><h2>Teams</h2>
      <ul className="list">{teams.data.map((t) => (<li key={t.id}><span><b>{t.name}</b> <span className="reason">{t.members} people</span></span>
        <span className="row"><button style={small} onClick={() => { const n = window.prompt('Rename team', t.name); if (n?.trim()) void run(async () => { await api(`/v1/teams/${t.id}`, { method: 'PUT', body: { name: n.trim(), leadUserId: t.leadUserId } }); await reload(); }); }}>Rename</button>
          <button style={small} onClick={() => { if (window.confirm(`Delete team “${t.name}”? Its people stay, without a team.`)) void run(async () => { await api(`/v1/teams/${t.id}`, { method: 'DELETE' }); await reload(); }); }}>Delete</button></span></li>))}</ul>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/v1/teams', { method: 'POST', body: { name: nt } }); setNt(''); await reload(); }, 'Team created'); }}>
        <input aria-label="New team name" placeholder="New team" value={nt} onChange={(e) => setNt(e.target.value)} required style={{ flex: 1 }} /><button className="primary">Add team</button></form></section>

    <section className="card" data-testid="people"><h2>People</h2>
      <ul className="list">{users.data.map((m) => (<li key={m.userId}><span>{m.name} <span className="pill">{m.role}</span>{m.status !== 'active' && <span className="pill">{m.status}</span>}<br /><span className="reason">{m.email} {m.teamId ? `· ${teams.data.find((t) => t.id === m.teamId)?.name ?? ''}` : ''}</span></span>
        <span className="row">{m.status === 'active' && <button style={small} onClick={() => pick(m)}>Profile</button>}{m.status === 'active' && m.role !== 'owner' && ['owner', 'admin'].includes(role) && <button style={small} onClick={() => { setOff(m); setTo(''); }}>Offboard</button>}</span></li>))}</ul></section>

    {sel && (<section className="card" data-testid="profile"><h2>Routing profile — {sel.name}</h2>
      <label>Team</label><select aria-label="Team" value={p.teamId} onChange={(e) => setP({ ...p, teamId: e.target.value })}><option value="">No team</option>{teams.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <label>Skills (comma separated)</label><input aria-label="Skills" value={p.skills} onChange={(e) => setP({ ...p, skills: e.target.value })} />
      <label>Languages</label><input aria-label="Languages" value={p.languages} onChange={(e) => setP({ ...p, languages: e.target.value })} placeholder="en, hi, mr" />
      <label>Max open leads</label><input aria-label="Max open leads" type="number" min={1} value={p.maxOpenLeads} onChange={(e) => setP({ ...p, maxOpenLeads: e.target.value })} />
      <label>On leave until</label><input aria-label="On leave until" type="date" value={p.onLeaveUntil} onChange={(e) => setP({ ...p, onLeaveUntil: e.target.value })} />
      <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={() => run(async () => {
        const body: any = { teamId: p.teamId || null }; if (p.skills) body.skills = csv(p.skills); if (p.languages) body.languages = csv(p.languages); if (p.maxOpenLeads) body.maxOpenLeads = Number(p.maxOpenLeads); body.onLeaveUntil = p.onLeaveUntil ? new Date(p.onLeaveUntil).toISOString() : null;
        await api(`/v1/users/${sel.userId}/profile`, { method: 'PATCH', body }); setSel(null); await reload();
      }, 'Profile saved')}>Save</button><button onClick={() => setSel(null)}>Cancel</button></div></section>)}

    {off && (<section className="card" role="alertdialog" aria-label="Offboard" data-testid="offboard"><h2>Offboard {off.name}</h2><p className="reason">Their access ends immediately. Their open leads go to the person you pick (or are spread across the agents if you choose none).</p>
      <select aria-label="Reassign to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Spread across agents</option>{active.filter((m) => m.userId !== off.userId).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select>
      <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={() => run(async () => { await api(`/v1/users/${off.userId}/offboard`, { method: 'POST', body: to ? { reassignTo: to } : {} }); setOff(null); await reload(); }, `${off.name} was offboarded`)}>Offboard now</button><button onClick={() => setOff(null)}>Cancel</button></div></section>)}
  </>);
}
