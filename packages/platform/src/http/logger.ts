/** Structured JSON logs. Never pass bodies, headers, cookies or credentials in `fields`. */
export type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACT = /^(authorization|cookie|set-cookie|password|token|secret|apikey|api_key|accesstoken|refreshtoken|credentials|body)$/i;

export function redact(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== 'object') return typeof v === 'string' && v.length > 500 ? `${v.slice(0, 500)}…` : v;
  if (depth > 4) return '[deep]';
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redact(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, REDACT.test(k) ? '[redacted]' : redact(x, depth + 1)]));
}

export function createLogger(o: { service: string; level?: Level; sink?: (line: string) => void } = { service: 'app' }) {
  const min = ORDER[o.level ?? ((process.env.LOG_LEVEL as Level) || (process.env.NODE_ENV === 'test' ? 'error' : 'info'))] ?? 20;
  const sink = o.sink ?? ((l: string) => process.stdout.write(l + '\n'));
  const emit = (level: Level, msg: string, fields: Record<string, unknown> = {}) => {
    if (ORDER[level] < min) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level, service: o.service, msg, ...(redact(fields) as object) }));
  };
  return { debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, f), info: (m: string, f?: Record<string, unknown>) => emit('info', m, f), warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, f), error: (m: string, f?: Record<string, unknown>) => emit('error', m, f) };
}
export type Logger = ReturnType<typeof createLogger>;
