import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createLogger, errorTracker, Metrics, type Logger } from '@leaddesk/platform';

/** Wraps a job so every run records duration, success time and failures (alerts key off "last success" age). */
export function instrument<T>(metrics: Metrics, log: Logger, name: string, fn: () => Promise<T>, now: () => number = Date.now) {
  return async (): Promise<T> => {
    const t0 = now();
    try {
      const r = await fn();
      metrics.gauge('leaddesk_job_last_success_timestamp_seconds', 'Unix time of the last successful run', Math.floor(now() / 1000), { job: name });
      metrics.observe('leaddesk_job_duration_seconds', 'Job duration', (now() - t0) / 1000, { job: name }, [0.05, 0.25, 1, 5, 15, 60, 300]);
      return r;
    } catch (e) {
      metrics.counter('leaddesk_job_failures_total', 'Failed job runs', { job: name });
      log.error('job failed', { job: name, error: String((e as Error)?.message ?? e).slice(0, 300) });
      errorTracker().capture(e, { job: name });
      throw e;
    }
  };
}

/** Tiny HTTP surface for the worker: liveness + Prometheus scrape (bearer METRICS_TOKEN when set). */
export function startMetricsServer(port: number, metrics: Metrics, ready: () => Promise<boolean>): Server {
  const token = process.env.METRICS_TOKEN;
  const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
  const srv = createServer(async (req, res) => {
    try {
      if (req.url === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}'); return; }
      if (req.url === '/readyz') { const ok = await ready().catch(() => false); res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify({ status: ok ? 'ready' : 'not_ready' })); return; }
      if (req.url === '/metrics') {
        if (!token && process.env.NODE_ENV === 'production') { res.writeHead(404).end(); return; }
        if (token && !eq(String(req.headers.authorization ?? ''), `Bearer ${token}`)) { res.writeHead(401).end(); return; }
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' }).end(await metrics.render()); return;
      }
      res.writeHead(404).end();
    } catch { res.writeHead(500).end(); }
  });
  srv.listen(port);
  return srv;
}
export const workerLogger = () => createLogger({ service: 'worker' });
