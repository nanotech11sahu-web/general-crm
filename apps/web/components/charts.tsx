/** Small dependency-free SVG charts for the dashboard. All of them render a sensible empty state when there is no data. */
const PALETTE = ['#4f46e5', '#16a34a', '#f59e0b', '#06b6d4', '#db2777', '#dc2626', '#8b5cf6'];
export const color = (i: number) => PALETTE[i % PALETTE.length];

export function Sparkline({ values, stroke = '#4f46e5', width = 96, height = 34 }: { values: number[]; stroke?: string; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...values, 1), min = Math.min(...values, 0), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (width - 4) + 2},${height - 3 - ((v - min) / span) * (height - 8)}`).join(' ');
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><polyline points={pts} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** Grouped bars for two series (e.g. new leads and calls per day) with a light grid and a handful of x labels. */
export function Bars({ labels, a, b, height = 220, aColor = '#4f46e5', bColor = '#16a34a' }: { labels: string[]; a: number[]; b?: number[]; height?: number; aColor?: string; bColor?: string }) {
  const W = 640, H = height, L = 30, B = 22, T = 8; const max = Math.max(...a, ...(b ?? []), 4); const n = labels.length || 1; const step = (W - L) / n; const bw = Math.max(3, Math.min(14, step / (b ? 3 : 2)));
  const y = (v: number) => H - B - (v / max) * (H - B - T); const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * max));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Activity per day" style={{ display: 'block' }}>
      {ticks.map((t) => (<g key={t}><line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={L - 6} y={y(t) + 4} fontSize="10" textAnchor="end" fill="var(--muted)">{t}</text></g>))}
      {labels.map((l, i) => { const x = L + i * step + step / 2; return (<g key={i}>
        <rect x={x - (b ? bw + 1 : bw / 2)} y={y(a[i] ?? 0)} width={bw} height={H - B - y(a[i] ?? 0)} rx="3" fill={aColor} />
        {b && <rect x={x + 1} y={y(b[i] ?? 0)} width={bw} height={H - B - y(b[i] ?? 0)} rx="3" fill={bColor} />}
        {(n <= 8 || i % Math.ceil(n / 8) === 0) && <text x={x} y={H - 6} fontSize="10" textAnchor="middle" fill="var(--muted)">{l}</text>}</g>); })}
    </svg>
  );
}

export function Donut({ parts, center, sub, size = 190 }: { parts: { label: string; value: number }[]; center: string; sub?: string; size?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0); const r = 70, c = 2 * Math.PI * r; let acc = 0;
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label="Breakdown" style={{ display: 'block', margin: '0 auto' }}>
      <circle cx="100" cy="100" r={r} fill="none" stroke="var(--soft)" strokeWidth="24" />
      {total > 0 && parts.map((p, i) => { const len = (p.value / total) * c; const el = <circle key={p.label} cx="100" cy="100" r={r} fill="none" stroke={color(i)} strokeWidth="24" strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-acc} transform="rotate(-90 100 100)" />; acc += len; return el; })}
      <text x="100" y="98" textAnchor="middle" fontSize="26" fontWeight="750" fill="var(--ink)">{center}</text>
      {sub && <text x="100" y="118" textAnchor="middle" fontSize="11" fill="var(--muted)">{sub}</text>}
    </svg>
  );
}
