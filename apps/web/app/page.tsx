import type { Metadata } from 'next';
import { Pricing, RedirectIfSignedIn } from '../components/Landing';

export const metadata: Metadata = { title: 'LeadDesk: never lose a lead', description: 'A lead-focused CRM for teams that live on the phone: leads arrive from your ads and forms, every agent gets one Today list, and managers see what is leaking.' };

const MODULES: [string, string][] = [
  ['Connect', 'Meta Lead Ads, Google Sheets and website forms flow in on their own, with health checks, token refresh and automatic backfill so a silent failure never costs you leads.'],
  ['Leads', 'One clean record per person: duplicates merged, sources and campaigns attached, agents never see raw phone numbers.'],
  ['Do', 'Every agent opens one Today list that says exactly who to call or message next, why, and forces a next step after every call. WhatsApp, SMS and calling run through your own accounts.'],
  ['Pulse', 'Response time, connect rate, follow-up discipline and source quality, plus a leakage report with one-click reassign.'],
];

/** Public landing page. Statically rendered; signed-in visitors are sent straight to Today. */
export default function Home() {
  return (
    <main style={{ maxWidth: 960 }}>
      <RedirectIfSignedIn />
      <div className="bar"><h1>LeadDesk</h1><div className="row"><a className="btn" href="/login">Sign in</a><a className="btn primary" href="/signup">Start free trial</a></div></div>
      <section style={{ padding: '24px 0' }}>
        <h2 style={{ fontSize: 32, margin: '0 0 8px' }}>Never lose a lead to slow follow-up again.</h2>
        <p className="reason" style={{ fontSize: 18 }}>Leads arrive from your ads and forms. Your team works one Today list. You see what is leaking, before it costs you a sale.</p>
        <div className="row"><a className="btn primary big" href="/signup">Start your 14-day free trial</a></div>
        <p className="reason">No card needed. Everything unlocked for 14 days. Your data stays yours: export or delete it any time.</p>
      </section>
      <section aria-label="What you get" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        {MODULES.map(([t, d]) => <div className="card" key={t}><h3 style={{ margin: 0 }}>{t}</h3><p className="reason">{d}</p></div>)}
      </section>
      <section aria-label="Pricing" style={{ padding: '24px 0' }}><h2>Simple pricing, per seat</h2><Pricing /><p className="reason">Prices exclude GST. WhatsApp, SMS and calling are billed by your own providers.</p></section>
      <section aria-label="Trust" className="card"><h3 style={{ margin: 0 }}>Built to be trusted with customer data</h3>
        <p className="reason">Each workspace is isolated, integration credentials are encrypted, AI is optional and only ever suggests, and erasure and export requests are built in.</p></section>
      <footer className="reason" style={{ padding: '24px 0' }}>© LeadDesk · <a href="/login">Sign in</a> · <a href="/signup">Create a workspace</a></footer>
    </main>
  );
}
