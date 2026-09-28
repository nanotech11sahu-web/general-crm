import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar } from 'recharts';
import { Wallet, TrendingUp, Users, UserPlus, TrendingDown, Download, Activity, ShieldCheck } from 'lucide-react';
import { getDashboard } from '../../lib/api/finance';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { toast } from '../../stores/toastStore';

function currency(n: number): string {
  return `₹${Math.round(n).toLocaleString()}`;
}

export function DashboardTab() {
  const { data, isLoading } = useQuery({ queryKey: ['finance-dashboard'], queryFn: getDashboard });

  if (isLoading || !data) return <SkeletonList rows={6} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-muted)]">This Month</p>
        <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => toast('Export coming in a later phase', { variant: 'info' })}>
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard icon={Wallet} label="MRR" value={currency(data.kpis.mrr)} />
        <KpiCard icon={TrendingUp} label="ARR" value={currency(data.kpis.arr)} />
        <KpiCard icon={Users} label="Active Subscriptions" value={String(data.kpis.activeSubscriptions)} />
        <KpiCard icon={UserPlus} label="New This Month" value={String(data.kpis.newThisMonth)} />
        <KpiCard icon={TrendingDown} label="Churn Rate" value={`${Math.round(data.kpis.churnRate * 100)}%`} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <KpiCard label="Gross" value={currency(data.revenueSummary.gross)} compact />
        <KpiCard label="Collected" value={currency(data.revenueSummary.collected)} compact />
        <KpiCard label="Refunds" value={currency(data.revenueSummary.refunds)} compact />
        <KpiCard label="Outstanding" value={currency(data.revenueSummary.outstanding)} compact />
        <KpiCard label="Invoices" value={String(data.revenueSummary.invoiceCount)} compact />
        <KpiCard label="Collection Rate" value={`${Math.round(data.revenueSummary.collectionRate * 100)}%`} compact />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Revenue Trend</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data.revenueTrend}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Area type="monotone" dataKey="amount" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.15} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Subscription Breakdown</h3>
          <div className="space-y-2">
            {data.subscriptionBreakdown.map((s) => (
              <div key={s.cycle} className="flex items-center justify-between text-sm">
                <span className="capitalize">{s.cycle}</span>
                <span className="font-medium">{s.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Overdue" value={`${data.overdue.count} · ${currency(data.overdue.amount)}`} compact />
        <KpiCard label="Collection Rate" value={`${Math.round(data.overdue.collectionRate * 100)}%`} compact />
        <KpiCard label="DSO" value={`${Math.round(data.overdue.dso)} days`} compact />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">MRR Movement</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={[{ name: 'New', value: data.mrrMovement.new }, { name: 'Expansion', value: data.mrrMovement.expansion }, { name: 'Churned', value: -data.mrrMovement.churned }]}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="value" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Revenue Waterfall</h3>
          <div className="space-y-2 text-sm">
            <WaterfallRow label="Gross" value={data.revenueWaterfall.gross} />
            <WaterfallRow label="Discounts" value={-data.revenueWaterfall.discounts} />
            <WaterfallRow label="Refunds" value={-data.revenueWaterfall.refunds} />
            <div className="border-t border-[var(--color-border)] pt-2">
              <WaterfallRow label="Net" value={data.revenueWaterfall.net} bold />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Product Performance</h3>
          {!data.productPerformance.length ? (
            <p className="text-sm text-[var(--color-text-muted)]">No paid invoices yet.</p>
          ) : (
            <div className="space-y-1.5">
              {data.productPerformance.map((p) => (
                <div key={p.productId} className="flex items-center justify-between text-sm">
                  <span>{p.name}</span>
                  <span className="font-medium">{currency(p.revenue)} · {p.unitsSold} sold</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Top Customers</h3>
          {!data.topCustomers.length ? (
            <p className="text-sm text-[var(--color-text-muted)]">No paid invoices yet.</p>
          ) : (
            <div className="space-y-1.5">
              {data.topCustomers.map((c) => (
                <div key={c.contactId} className="flex items-center justify-between text-sm">
                  <span>{c.name}</span>
                  <span className="font-medium">{currency(c.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Upcoming Renewals (7d)</h3>
          {!data.upcomingRenewals.length ? (
            <EmptyState icon={Users} title="No renewals due this week" />
          ) : (
            <div className="space-y-1.5">
              {data.upcomingRenewals.map((r) => (
                <div key={r.subscriptionId} className="flex items-center justify-between text-sm">
                  <span>{new Date(r.nextBillingAt).toLocaleDateString()}</span>
                  <span className="font-medium">{currency(r.price)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Overdue Invoices</h3>
          {!data.overdueInvoices.length ? (
            <EmptyState icon={ShieldCheck} title="Nothing overdue" />
          ) : (
            <div className="space-y-1.5">
              {data.overdueInvoices.map((inv) => (
                <div key={inv.invoiceId} className="flex items-center justify-between text-sm">
                  <span>{inv.receiptNumber}</span>
                  <Badge tone="danger">{currency(inv.amount)}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 flex items-center gap-1.5 font-semibold">
            <Activity className="h-4 w-4" /> Finance Activity
          </h3>
          {!data.activityFeed.length ? (
            <p className="text-sm text-[var(--color-text-muted)]">No activity yet.</p>
          ) : (
            <div className="space-y-1.5">
              {data.activityFeed.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <span>{a.message}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">{new Date(a.at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Reconciliation</h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xl font-semibold text-[var(--color-danger)]">{data.reconciliation.open}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Open</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-[var(--color-success)]">{data.reconciliation.resolved}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Resolved</p>
            </div>
            <div>
              <p className="text-xl font-semibold">{data.reconciliation.total}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Total</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, compact }: { icon?: typeof Wallet; label: string; value: string; compact?: boolean }) {
  return (
    <Card className={compact ? 'p-3' : undefined}>
      <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
        {Icon && <Icon className="h-4 w-4" />} <p className="text-xs">{label}</p>
      </div>
      <p className={compact ? 'mt-1 text-lg font-semibold' : 'mt-1 text-xl font-semibold'}>{value}</p>
    </Card>
  );
}

function WaterfallRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span className={value < 0 ? 'text-[var(--color-danger)]' : ''}>{value < 0 ? '-' : ''}₹{Math.abs(Math.round(value)).toLocaleString()}</span>
    </div>
  );
}
