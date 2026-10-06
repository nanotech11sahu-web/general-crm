'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, getToken, logout, refresh } from '../lib/api';

/** Pages that never show the app chrome (marketing, sign-in flows, printable documents). */
const BARE = [/^\/$/, /^\/login/, /^\/signup/, /^\/forgot/, /^\/reset\//, /^\/invite\//, /^\/operator/, /^\/billing\/invoice\//];
type Role = 'owner' | 'admin' | 'manager' | 'agent';
interface Item { href: string; label: string; icon: ReactNode; roles?: Role[] }

const I = (d: string) => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>);
const ICON = {
  dash: I('M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z'), today: I('M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M12 8a4 4 0 100 8 4 4 0 000-8z'),
  leads: I('M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8'), pulse: I('M3 12h4l3-8 4 16 3-8h4'),
  ai: I('M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'), admin: I('M4 6h16M4 12h16M4 18h10M18 16v4M16 18h4'),
  settings: I('M10.3 3.3l-.5 2a7 7 0 00-1.7 1l-2-.7-1.7 3 1.5 1.4a7 7 0 000 2l-1.5 1.4 1.7 3 2-.7a7 7 0 001.7 1l.5 2h3.4l.5-2a7 7 0 001.7-1l2 .7 1.7-3-1.5-1.4a7 7 0 000-2l1.5-1.4-1.7-3-2 .7a7 7 0 00-1.7-1l-.5-2zM12 9a3 3 0 100 6 3 3 0 000-6z'),
  billing: I('M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2zM2 10h20'), health: I('M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z'),
  shield: I('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'), out: I('M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9'), search: I('M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3'),
  bell: I('M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0'), sun: I('M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4'), back: I('M19 12H5M12 19l-7-7 7-7'),
};
const NAV: Item[] = [
  { href: '/dashboard', label: 'Dashboard', icon: ICON.dash, roles: ['owner', 'admin', 'manager'] },
  { href: '/today', label: 'Today', icon: ICON.today }, { href: '/leads', label: 'Leads', icon: ICON.leads },
  { href: '/pulse', label: 'Pulse', icon: ICON.pulse, roles: ['owner', 'admin', 'manager'] }, { href: '/ai', label: 'AI', icon: ICON.ai, roles: ['owner', 'admin'] },
  { href: '/admin', label: 'Admin', icon: ICON.admin, roles: ['owner', 'admin'] }, { href: '/settings', label: 'Settings', icon: ICON.settings, roles: ['owner', 'admin'] },
  { href: '/billing', label: 'Billing', icon: ICON.billing, roles: ['owner', 'admin'] }, { href: '/ops', label: 'Health', icon: ICON.health, roles: ['owner', 'admin'] },
  { href: '/security', label: 'Security', icon: ICON.shield },
];

/** App chrome: icon rail, labelled sidebar, top bar (search, theme, notifications, account). Public pages render bare. */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? '/'; const router = useRouter();
  const bare = BARE.some((r) => r.test(path));
  const [me, setMe] = useState<{ role: Role; name?: string } | null>(null); const [unread, setUnread] = useState(0); const [q, setQ] = useState('');
  useEffect(() => { try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* storage blocked: follow the system theme */ } }, []);
  useEffect(() => {
    if (bare) return; let alive = true;
    (async () => {
      if (!getToken() && !(await refresh())) return;
      const m = await api<{ role: Role; userId: string }>('/v1/me').catch(() => null); if (!alive || !m) return;
      setMe({ role: m.role });
      api<{ readAt?: string | null }[]>('/v1/notifications').then((n) => alive && setUnread(n.filter((x) => !x.readAt).length)).catch(() => undefined);
    })();
    return () => { alive = false; };
  }, [bare, path]);
  if (bare) return <>{children}</>;
  const items = NAV.filter((n) => !n.roles || (me && n.roles.includes(me.role)));
  const page = path.split('/')[1] || 'today';
  const toggle = () => { const next = (document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)) ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('theme', next); } catch { /* ignore */ } };
  const go = (href: string) => router.push(href);
  const active = (href: string) => (path === href || path.startsWith(`${href}/`) ? 'page' : undefined);
  return (
    <div className="shell" data-page={page}>
      <aside className="rail" aria-hidden="true"><div className="logo">L</div>
        {items.slice(0, 7).map((n) => <button key={n.href} tabIndex={-1} className="ico" aria-current={active(n.href)} onClick={() => go(n.href)} title={n.label}>{n.icon}</button>)}
      </aside>
      <nav className="side" aria-label="Main">
        <div className="brand">LeadDesk</div>
        {items.map((n) => <button key={n.href} className="nav-item" aria-current={active(n.href)} onClick={() => go(n.href)}>{n.icon}<span>{n.label}</span></button>)}
        <div className="grow" />
        <div className="upsell"><b>Never lose a lead</b>Reply fast, follow up on time.</div>
        <button className="nav-item" onClick={async () => { await logout(); router.replace('/login'); }}>{ICON.out}<span>Sign out</span></button>
      </nav>
      <div className="workspace">
        <header className="topbar">
          <button className="back" aria-label="Go back" onClick={() => router.back()}>{ICON.back}</button>
          <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/leads?q=${encodeURIComponent(q.trim())}`); }}>
            <input aria-label="Quick find" placeholder="Quick find a lead…" value={q} onChange={(e) => setQ(e.target.value)} /><button aria-label="Quick find go">{ICON.search}</button>
          </form>
          <div className="spacer" />
          <button className="tool" aria-label="Switch light or dark theme" onClick={toggle}>{ICON.sun}</button>
          <button className={`tool${unread ? ' badge-dot' : ''}`} aria-label={unread ? `${unread} unread notifications` : 'Notifications'} onClick={() => go('/today')}>{ICON.bell}{unread ? <i /> : null}</button>
          <div className="user"><div className="avatar" aria-hidden="true">{(me?.role ?? 'u')[0].toUpperCase()}</div><div className="who"><b>{me ? me.role[0].toUpperCase() + me.role.slice(1) : '…'}</b><span>LeadDesk</span></div></div>
        </header>
        <div className="content">{children}</div>
        <footer className="footer"><span>© {new Date().getFullYear()} LeadDesk</span><span>Your next best action, one lead at a time.</span></footer>
      </div>
    </div>
  );
}
