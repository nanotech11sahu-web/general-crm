'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAdminPage } from '../../lib/admin';
import PipelineTab from './PipelineTab';
import RoutingTab from './RoutingTab';
import TemplatesTab from './TemplatesTab';
import AutomationTab from './AutomationTab';
import ImportsTab from './ImportsTab';
import TeamTab from './TeamTab';
import ViewsTab from './ViewsTab';

const TABS = [['pipeline', 'Pipeline'], ['routing', 'Routing & SLA'], ['templates', 'Templates'], ['automation', 'Automation'], ['imports', 'Import'], ['team', 'Team'], ['views', 'Views']] as const;
type Tab = (typeof TABS)[number][0];

/** One place for everything an admin configures. Each tab talks to the same permission-checked API the rest of the app uses. */
export default function Admin() {
  const { router, ready, msg, run } = useAdminPage();
  const [tab, setTab] = useState<Tab>('pipeline'); const [role, setRole] = useState('');
  useEffect(() => { if (ready) api<{ role: string }>('/v1/me').then((m) => setRole(m.role)).catch(() => setRole('')); }, [ready]);
  if (!ready) return <main><p className="reason">Loading…</p></main>;
  return (
    <main>
      <div className="bar"><h1>Admin</h1><span className="row"><button onClick={() => router.push('/settings')} style={{ minHeight: 36, padding: '0 12px' }}>Connections</button></span></div>
      {msg && <p className="reason" role="status">{msg}</p>}
      <div className="row" role="tablist" aria-label="Admin sections" style={{ marginBottom: 12 }}>
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'primary' : ''} onClick={() => setTab(k)} style={{ minHeight: 40 }}>{l}</button>)}
      </div>
      {tab === 'pipeline' && <PipelineTab run={run} />}
      {tab === 'routing' && <RoutingTab run={run} />}
      {tab === 'templates' && <TemplatesTab run={run} />}
      {tab === 'automation' && <AutomationTab run={run} />}
      {tab === 'imports' && <ImportsTab run={run} />}
      {tab === 'team' && <TeamTab run={run} role={role} />}
      {tab === 'views' && <ViewsTab run={run} />}
    </main>
  );
}
