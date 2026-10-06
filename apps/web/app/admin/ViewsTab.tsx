'use client';
import { api } from '../../lib/api';
import { useResource } from '../../lib/admin';

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
interface View { _id: string; name: string; shared: boolean; filter: Record<string, unknown> }

/** Saved lead views: see, share-state and delete (creating happens from the filter bar on the lead list). */
export default function ViewsTab({ run }: { run: Run }) {
  const v = useResource<View[]>('/v1/views', []);
  return (
    <section className="card" data-testid="views"><h2>Saved views</h2>
      {v.data.length === 0 && <p className="reason">No saved views yet.</p>}
      <ul className="list">{v.data.map((x) => (<li key={x._id}><span><b>{x.name}</b> {x.shared && <span className="pill">shared</span>}<br /><span className="reason">{Object.entries(x.filter).map(([k, val]) => `${k}: ${String(val)}`).join(' · ') || 'all leads'}</span></span>
        <span><button style={{ minHeight: 32, padding: '0 10px' }} onClick={() => run(async () => { await api(`/v1/views/${x._id}`, { method: 'DELETE' }); await v.reload(); }, 'View deleted')}>Delete</button></span></li>))}</ul></section>
  );
}
