import type { NextFunction, Request, Response } from 'express';

type Labels = Record<string, string | number>;
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const fmt = (l: Labels) => { const k = Object.keys(l).sort(); return k.length ? `{${k.map((x) => `${x}="${esc(String(l[x]))}"`).join(',')}}` : ''; };

/** Minimal Prometheus text-format registry (counters, gauges, histograms). Label values must be low-cardinality. */
export class Metrics {
  private readonly help = new Map<string, { help: string; type: string }>();
  private readonly counters = new Map<string, Map<string, { l: Labels; v: number }>>();
  private readonly gauges = new Map<string, Map<string, { l: Labels; v: number }>>();
  private readonly hist = new Map<string, { buckets: number[]; rows: Map<string, { l: Labels; counts: number[]; sum: number; n: number }> }>();
  private readonly collectors: (() => Promise<void> | void)[] = [];

  counter(name: string, help: string, l: Labels = {}, by = 1) { this.help.set(name, { help, type: 'counter' }); const m = this.counters.get(name) ?? this.counters.set(name, new Map()).get(name)!; const k = fmt(l); const r = m.get(k) ?? { l, v: 0 }; r.v += by; m.set(k, r); }
  gauge(name: string, help: string, v: number, l: Labels = {}) { this.help.set(name, { help, type: 'gauge' }); const m = this.gauges.get(name) ?? this.gauges.set(name, new Map()).get(name)!; m.set(fmt(l), { l, v }); }
  clearGauge(name: string) { this.gauges.delete(name); }
  observe(name: string, help: string, v: number, l: Labels = {}, buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
    this.help.set(name, { help, type: 'histogram' });
    const h = this.hist.get(name) ?? this.hist.set(name, { buckets, rows: new Map() }).get(name)!;
    const k = fmt(l); const r = h.rows.get(k) ?? { l, counts: new Array(h.buckets.length).fill(0), sum: 0, n: 0 };
    h.buckets.forEach((b, i) => { if (v <= b) r.counts[i]++; }); r.sum += v; r.n++; h.rows.set(k, r);
  }
  /** Gauges that must be read at scrape time (DB counts, queue depth). */
  collect(fn: () => Promise<void> | void) { this.collectors.push(fn); }

  async render(): Promise<string> {
    for (const c of this.collectors) { try { await c(); } catch { this.counter('leaddesk_metrics_collector_errors_total', 'Collector failures while rendering metrics'); } }
    const out: string[] = [];
    const head = (n: string) => { const h = this.help.get(n)!; out.push(`# HELP ${n} ${h.help}`, `# TYPE ${n} ${h.type}`); };
    for (const [n, rows] of this.counters) { head(n); for (const [k, r] of rows) out.push(`${n}${k} ${r.v}`); }
    for (const [n, rows] of this.gauges) { head(n); for (const [k, r] of rows) out.push(`${n}${k} ${r.v}`); }
    for (const [n, h] of this.hist) {
      head(n);
      for (const r of h.rows.values()) {
        h.buckets.forEach((b, i) => out.push(`${n}_bucket${fmt({ ...r.l, le: b })} ${r.counts[i]}`));
        out.push(`${n}_bucket${fmt({ ...r.l, le: '+Inf' })} ${r.n}`, `${n}_sum${fmt(r.l)} ${r.sum}`, `${n}_count${fmt(r.l)} ${r.n}`);
      }
    }
    return out.join('\n') + '\n';
  }
}

/** Request counter + latency histogram labelled by method, matched route template and status class (never raw paths). */
export function httpMetrics(m: Metrics) {
  return (req: Request, res: Response, next: NextFunction) => {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const route = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : 'unmatched';
      const l = { method: req.method, route, status: `${Math.floor(res.statusCode / 100)}xx` };
      m.counter('leaddesk_http_requests_total', 'HTTP requests', l);
      m.observe('leaddesk_http_request_duration_seconds', 'HTTP request latency', Number(process.hrtime.bigint() - t0) / 1e9, { method: l.method, route: l.route });
    });
    next();
  };
}
