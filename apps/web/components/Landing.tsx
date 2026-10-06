'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, refresh } from '../lib/api';

/** Signed-in visitors skip the marketing page. */
export function RedirectIfSignedIn() {
  const router = useRouter();
  useEffect(() => { let alive = true; (async () => { if (getToken() || (await refresh())) { if (alive) router.replace('/today'); } })(); return () => { alive = false; }; }, [router]);
  return null;
}

interface PlanCard { key: string; name: string; pricePerSeatInr: number; blurb: string; limits: { maxSeats: number; connections: number; ai: boolean; cloudTelephony: boolean; leadsPerMonth: number | null } }
export function Pricing() {
  const [plans, setPlans] = useState<PlanCard[] | null>(null);
  useEffect(() => { fetch('/v1/plans').then((r) => r.json()).then((j) => setPlans(j.plans)).catch(() => setPlans([])); }, []);
  if (!plans) return <p className="reason">Loading prices…</p>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }} data-testid="pricing">
      {plans.map((p) => (
        <div className="card" key={p.key}><h3 style={{ margin: 0 }}>{p.name}</h3><div className="name">₹{p.pricePerSeatInr.toLocaleString('en-IN')}<span className="reason"> / seat / month</span></div>
          <p className="reason">{p.blurb}</p><p className="reason">Up to {p.limits.maxSeats} seats · {p.limits.leadsPerMonth ? `${p.limits.leadsPerMonth.toLocaleString('en-IN')} leads/month` : 'unlimited leads'}</p></div>
      ))}
    </div>
  );
}
