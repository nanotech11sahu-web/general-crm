'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { csv, useResource, type Member } from '../../lib/admin';

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
interface Action { kind: string; poolUserIds?: string[]; teamId?: string; userId?: string; requireSkills?: string[] }
interface Rule { name: string; conditions: { sourceKinds?: string[]; campaignContains?: string; cities?: string[]; languages?: string[]; timeOfDay?: { from: string; to: string } }; action: Action; active: boolean }
interface Sla { name: string; claimSeconds: number; firstContactSeconds: number; maxReassignments?: number; appliesTo?: { sourceKinds?: string[] }; active: boolean }
interface Team { id: string; name: string }
const STRATS = [['round_robin', 'Round robin'], ['least_loaded', 'Least loaded'], ['specific_user', 'One person'], ['sticky_previous_owner', 'Previous owner'], ['team_pool', 'A team']];
const small = { minHeight: 32, padding: '0 10px' };
const blank = (): Rule => ({ name: '', conditions: {}, action: { kind: 'round_robin' }, active: true });

function ActionEditor({ a, onChange, members, teams }: { a: Action; onChange: (a: Action) => void; members: Member[]; teams: Team[] }) {
  return (<div className="row">
    <select aria-label="Strategy" value={a.kind} onChange={(e) => onChange({ ...a, kind: e.target.value })} style={{ flex: 1 }}>{STRATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    {a.kind === 'specific_user' && <select aria-label="Person" value={a.userId ?? ''} onChange={(e) => onChange({ ...a, userId: e.target.value })} style={{ flex: 1 }}><option value="">Choose…</option>{members.filter((m) => m.status === 'active').map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select>}
    {a.kind === 'team_pool' && <select aria-label="Team" value={a.teamId ?? ''} onChange={(e) => onChange({ ...a, teamId: e.target.value })} style={{ flex: 1 }}><option value="">Choose…</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
    {(a.kind === 'round_robin' || a.kind === 'least_loaded') && <select aria-label="Pool" value={(a.poolUserIds ?? []).length ? 'custom' : 'agents'} onChange={(e) => onChange({ ...a, poolUserIds: e.target.value === 'agents' ? [] : members.filter((m) => m.role === 'agent' && m.status === 'active').map((m) => m.userId) })} style={{ flex: 1 }}><option value="agents">All agents</option><option value="custom">Pick people…</option></select>}
    {(a.poolUserIds ?? []).length > 0 && <select aria-label="Pool members" multiple value={a.poolUserIds} onChange={(e) => onChange({ ...a, poolUserIds: [...e.target.selectedOptions].map((o) => o.value) })} style={{ flex: '1 1 100%' }}>{members.filter((m) => m.status === 'active').map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select>}
  </div>);
}

/** Assignment rules (first match wins, in order) and SLA policies. */
export default function RoutingTab({ run }: { run: Run }) {
  const users = useResource<Member[]>('/v1/users', []); const teams = useResource<Team[]>('/v1/teams', []);
  const [rules, setRules] = useState<Rule[]>([]); const [def, setDef] = useState<Action | null>(null); const [slas, setSlas] = useState<Sla[]>([]);
  useEffect(() => { (async () => {
    const r = await api<{ rules: any[]; default: Action | null }>('/v1/rules/assignment'); setDef(r.default);
    setRules(r.rules.map((x) => ({ name: x.name, conditions: x.conditions ?? {}, action: x.action, active: x.active !== false })));
    const s = await api<any[]>('/v1/sla'); setSlas(s.map((p) => ({ name: p.name, claimSeconds: p.claimSeconds, firstContactSeconds: p.firstContactSeconds, maxReassignments: p.maxReassignments, appliesTo: p.appliesTo, active: p.active !== false })));
  })().catch(() => undefined); }, []);
  const patch = (i: number, p: Partial<Rule>) => setRules((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const cond = (i: number, p: Partial<Rule['conditions']>) => patch(i, { conditions: { ...rules[i].conditions, ...p } });
  const swap = (i: number, d: -1 | 1) => setRules((rs) => { const a = [...rs]; const j = i + d; if (j < 0 || j >= a.length) return rs; [a[i], a[j]] = [a[j], a[i]]; return a; });
  const cleanCond = (c: Rule['conditions']) => { const o: any = {}; if (c.sourceKinds?.length) o.sourceKinds = c.sourceKinds; if (c.campaignContains) o.campaignContains = c.campaignContains; if (c.cities?.length) o.cities = c.cities; if (c.languages?.length) o.languages = c.languages; if (c.timeOfDay?.from && c.timeOfDay?.to) o.timeOfDay = c.timeOfDay; return o; };

  return (<>
    <section className="card" data-testid="rules"><h2>Who gets a new lead</h2><p className="reason">The first rule that matches wins. If none match, the fallback below is used.</p>
      {rules.length === 0 && <p className="reason">No rules yet: new leads go to the fallback.</p>}
      {rules.map((r, i) => (<div key={i} className="card" style={{ background: 'var(--bg)' }} data-testid={`rule-${i}`}>
        <div className="row"><input aria-label={`Rule ${i + 1} name`} placeholder="Rule name" value={r.name} onChange={(e) => patch(i, { name: e.target.value })} style={{ flex: 1 }} />
          <button aria-label={`Move rule ${i + 1} up`} onClick={() => swap(i, -1)} disabled={i === 0} style={small}>↑</button><button aria-label={`Move rule ${i + 1} down`} onClick={() => swap(i, 1)} disabled={i === rules.length - 1} style={small}>↓</button>
          <button onClick={() => setRules(rules.filter((_, k) => k !== i))} style={small}>Remove</button></div>
        <label>When (leave blank for “any”)</label>
        <div className="row"><input aria-label={`Rule ${i + 1} sources`} placeholder="sources: meta_leadads, manual" value={(r.conditions.sourceKinds ?? []).join(', ')} onChange={(e) => cond(i, { sourceKinds: csv(e.target.value) })} style={{ flex: 1 }} />
          <input aria-label={`Rule ${i + 1} campaign`} placeholder="campaign contains" value={r.conditions.campaignContains ?? ''} onChange={(e) => cond(i, { campaignContains: e.target.value })} style={{ flex: 1 }} /></div>
        <div className="row" style={{ marginTop: 8 }}><input aria-label={`Rule ${i + 1} cities`} placeholder="cities, comma separated" value={(r.conditions.cities ?? []).join(', ')} onChange={(e) => cond(i, { cities: csv(e.target.value) })} style={{ flex: 1 }} />
          <input aria-label={`Rule ${i + 1} languages`} placeholder="languages" value={(r.conditions.languages ?? []).join(', ')} onChange={(e) => cond(i, { languages: csv(e.target.value) })} style={{ flex: 1 }} /></div>
        <div className="row" style={{ marginTop: 8 }}><input aria-label={`Rule ${i + 1} from`} type="time" value={r.conditions.timeOfDay?.from ?? ''} onChange={(e) => cond(i, { timeOfDay: { from: e.target.value, to: r.conditions.timeOfDay?.to ?? '' } })} style={{ flex: 1 }} /><span className="reason">to</span><input aria-label={`Rule ${i + 1} to`} type="time" value={r.conditions.timeOfDay?.to ?? ''} onChange={(e) => cond(i, { timeOfDay: { from: r.conditions.timeOfDay?.from ?? '', to: e.target.value } })} style={{ flex: 1 }} /></div>
        <label>Then assign to</label><ActionEditor a={r.action} onChange={(a) => patch(i, { action: a })} members={users.data} teams={teams.data} />
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={r.active} onChange={(e) => patch(i, { active: e.target.checked })} /> Active</label>
      </div>))}
      <button onClick={() => setRules([...rules, blank()])}>Add rule</button>
      <h2 style={{ marginTop: 16 }}>Fallback</h2>
      <ActionEditor a={def ?? { kind: 'round_robin' }} onChange={setDef} members={users.data} teams={teams.data} />
      <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={() => run(() => api('/v1/rules/assignment', { method: 'PUT', body: { rules: rules.map((r) => ({ ...r, conditions: cleanCond(r.conditions) })), default: def } }), 'Rules saved')}>Save rules</button></div></section>

    <section className="card" data-testid="sla"><h2>Response-time promises (SLA)</h2><p className="reason">How fast a new lead must be claimed and first contacted before it escalates.</p>
      {slas.map((p, i) => (<div key={i} className="card" style={{ background: 'var(--bg)' }}>
        <div className="row"><input aria-label={`SLA ${i + 1} name`} value={p.name} onChange={(e) => setSlas(slas.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} style={{ flex: 1 }} /><button onClick={() => setSlas(slas.filter((_, k) => k !== i))} style={small}>Remove</button></div>
        <div className="row"><div style={{ flex: 1 }}><label>Claim within (min)</label><input aria-label={`SLA ${i + 1} claim minutes`} type="number" min={0} value={Math.round(p.claimSeconds / 60)} onChange={(e) => setSlas(slas.map((x, k) => (k === i ? { ...x, claimSeconds: Number(e.target.value) * 60 } : x)))} /></div>
          <div style={{ flex: 1 }}><label>First contact within (min)</label><input aria-label={`SLA ${i + 1} first contact minutes`} type="number" min={0} value={Math.round(p.firstContactSeconds / 60)} onChange={(e) => setSlas(slas.map((x, k) => (k === i ? { ...x, firstContactSeconds: Number(e.target.value) * 60 } : x)))} /></div>
          <div style={{ flex: 1 }}><label>Max reassignments</label><input aria-label={`SLA ${i + 1} max reassignments`} type="number" min={0} max={50} value={p.maxReassignments ?? 3} onChange={(e) => setSlas(slas.map((x, k) => (k === i ? { ...x, maxReassignments: Number(e.target.value) } : x)))} /></div></div></div>))}
      <div className="row"><button onClick={() => setSlas([...slas, { name: 'Default', claimSeconds: 300, firstContactSeconds: 900, maxReassignments: 3, active: true }])}>Add policy</button>
        <button className="primary" onClick={() => run(() => api('/v1/sla', { method: 'PUT', body: { policies: slas } }), 'SLA saved')}>Save SLA</button></div></section>
  </>);
}
