# Load tests

Two layers:

1. **Automated, runs in CI** (no extra tools):
   - `apps/api/test/perf.test.ts`: seeds 3 × 20 000 leads (+ activities, tasks, messages, calls) in a real replica set, then asserts
     (a) every hot query is index-backed (`explain`: no COLLSCAN, no large in-memory sort, bounded docs examined),
     (b) API p95 budgets (list/search/queue < 300 ms, detail < 400 ms, Pulse < 2 s), (c) no N+1 (command counts do not grow with rows).
     Bigger run: `PERF_LEADS=330000 pnpm --filter @leaddesk/api exec vitest run test/perf.test.ts --testTimeout 600000` (1M leads in total).
   - `apps/webhook-ingress/test/burst.test.ts`: ack p95 < 100 ms at steady load, 1 000-event burst, exactly-once under redelivery.
2. **k6 against a deployed stack** (staging, sized like production): `load/webhook-burst.js` (1.5k/min sustained, 5k/min spike) and
   `load/api-read-mix.js` (200 concurrent agents). Run before every launch of a new customer tier and after infrastructure changes.

Reading results: the k6 thresholds fail the run (non-zero exit). In production watch the same numbers in Prometheus
(`leaddesk_http_request_duration_seconds`, `leaddesk_inbox_oldest_pending_seconds`, `leaddesk_queue_jobs`), see `deploy/prometheus/alerts.yml`.
