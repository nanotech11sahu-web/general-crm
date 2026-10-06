# Runbook

Audience: whoever is on call. Every alert in `deploy/prometheus/alerts.yml` links to a section here.

## Services and health

| Service | Role | Port | Liveness | Readiness | Metrics |
|---|---|---|---|---|---|
| api | REST + SSE | 3000 | `/healthz` | `/readyz` (Mongo, Redis) | `/metrics` (bearer `METRICS_TOKEN`) |
| ingress | webhooks | 3100 | `/healthz` | `/readyz` | n/a (counters in api logs) |
| worker | queues, sweeps, outbox | 9464 | `/healthz` | `/readyz` (Redis) | `/metrics` |
| web | PWA | 3000 | `/login` | | |

The api must be scaled horizontally behind a load balancer (stateless; rate limits live in Redis). Run **at least one worker**; it owns every timer (SLA claim windows, missed tasks, cadences, digests, health checks, retention). Ingress is deliberately tiny so it keeps accepting webhooks while the rest is down: it only verifies, stores the raw event and answers 200.

## Deploying

1. Build and push both images (`Dockerfile` with `ROLE=api|worker|ingress|migrate`; `apps/web/Dockerfile`). CI builds them but nothing in the authoring environment ever ran them: **smoke-test the first deploy on staging**.
2. Run the `migrate` role first (idempotent). Migrations are additive; new indexes go in a new migration (see decisions #90).
3. Roll api/ingress/web, then worker. A worker stopping mid-job is safe (jobs are idempotent, leases expire).
4. Check `/readyz`, then Today in the browser, then the **Health** page.

Required production environment (the services refuse to boot otherwise): `MONGO_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET` (32+ random), `OBJECT_SIGNING_SECRET` (32+ random, identical on api/worker/ingress), `KMS_KEY_ID` (or `LOCAL_KEK_BASE64` on single-node installs), `PUBLIC_APP_URL` (https). Also set `TRUST_PROXY` to the number of proxies in front, `PUBLIC_INGRESS_URL`, `METRICS_TOKEN`, and provider app credentials as needed. Never put client integration credentials in the environment: they are stored encrypted in the database.

## Backups and the restore drill

- Managed MongoDB (Atlas): enable continuous backup with point-in-time restore. Test a PITR restore into a scratch cluster each quarter.
- Self-hosted or as a second copy: `scripts/backup.sh` (mongodump archive + sha256 + retention + optional S3). Archives hold customer data and *sealed* credentials: encrypt at rest and restrict access.
- **Monthly drill**: `DRILL_MONGO_URL=<scratch server> scripts/restore-drill.sh` restores the newest archive into a scratch DB and runs `verifyDatabase` (migrations applied, every declared index present, no tenant document without `tenantId`). A failed drill is a P1: backups you cannot restore are not backups. (These shell scripts were not executed in the authoring sandbox; run one end to end before launch.)
- Keys: the key-encryption key (KMS key or `LOCAL_KEK_BASE64`) is part of the backup story. Without it, backed-up credentials are unreadable by design. Back it up separately from the database.
- Per-customer export: owner → `GET /v1/tenant/export` (NDJSON, no credentials). It can be loaded with `TenantDataService.restoreExport` into a fresh database.

## Alert playbooks

### ingest-lag
`leaddesk_inbox_oldest_pending_seconds` high: webhook events are stored but not processed. Check the worker is up (`/readyz`, `leaddesk_job_last_success_timestamp_seconds`), Redis reachable, the `inbox` queue (`leaddesk_queue_jobs{queue="inbox"}`). Restart the worker; events are idempotent and will drain. Nothing is lost: ingress already stored them.

### dead-letters
Events exhausted retries (`leaddesk_inbox_dead`). Admin UI: Connections → failed events, or `GET /v1/inbox?status=dead`. Fix the cause (usually an expired token or a provider payload change), then `POST /v1/inbox/:id/replay`. The 90-day TTL keeps them long enough to recover.

### queues
`leaddesk_queue_jobs{state="failed"}` growing: read the worker logs for `job failed` (structured, with job name). Common causes: provider 4xx/5xx, a deploy mismatch between api and worker. Failed jobs are retained for inspection; fix then retry from the queue.

### timers
`leaddesk_sla_claim_timers_overdue` / `leaddesk_tasks_not_swept` > 0 or a sweep not succeeding: the worker is down or wedged. Impact: leads are not reassigned when claim windows expire, tasks are not marked missed, cadences do not run. Restart the worker; the sweeps are state-based, so they catch up on their own. Confirm `leaddesk_job_last_success_timestamp_seconds{job="sla"}` advances.

### outbox
`leaddesk_outbox_oldest_seconds` high: the dispatcher inside the worker is not draining the `events` outbox. Realtime pushes (SSE) read the outbox directly and are not affected; downstream consumers are.

### connections
`leaddesk_connections{status=~"failing|revoked"}`: a customer's lead source stopped delivering and may be silently missing leads. The product already notifies that tenant's admins. For platform issues check provider status pages; for tokens, ask the customer to Reconnect. After recovery the hourly/nightly backfill reconciles missing leads (Meta keeps data ~90 days: act within that window).

## Common operations

- **Rotate `JWT_ACCESS_SECRET`**: deploy the new value; every access token (15 min) dies, refresh cookies keep sessions alive.
- **Rotate the KEK**: add the new key, use `rewrapDek` over all connections (see `packages/crypto`), then retire the old key. Plan a maintenance window; test on a copy first.
- **Suspend a tenant**: set `tenants.status = "suspended"`; logins, refreshes and API calls stop within ~10 s.
- **Delete a tenant**: the owner requests it (`POST /v1/tenant/deletion`); after the grace period the nightly retention job purges everything. To cancel, the owner calls `DELETE /v1/tenant/deletion` during the grace period.
- **Erase a person (DPDP/GDPR)**: admin `DELETE /v1/leads/:id/erase`; a salted phone hash remains so we never contact them again.
- **Kill AI everywhere for a tenant**: Settings → AI → *Pause everything*; platform-wide, remove the `ai-groq` connector from the registry or unset the tenants' connections.

## Capacity notes

One ingress process absorbs ≈ 12k webhooks/min in the burst test (ack p95 ≈ 30 ms at steady load). API list/search/queue p95 < 300 ms with 60k leads in the test database; run `load/` against staging before onboarding a large tenant. Scale the worker per queue if one backs up; Pulse reads are live aggregations (daily rollups exist for trends): move heavy tenants to a secondary read preference first.
