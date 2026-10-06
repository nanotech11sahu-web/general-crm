# LeadDesk

A multi-tenant, lead-focused CRM: **Connect** (lead sources and channels) → **Leads** → **Do** (the agent's one-screen Today loop) → **Pulse** (what's happening, what's leaking), with optional **AI** that only ever suggests.
NestJS + MongoDB (replica set) + Redis/BullMQ + a Next.js PWA. Built to the spec in the master prompt; every non-obvious choice is logged in [`docs/decisions.md`](docs/decisions.md).

## What's in the box

| Area | What it does |
|---|---|
| Connect | Manifest-driven connectors (Meta Lead Ads, Google Sheets, website webhook, WhatsApp Cloud, MSG91 SMS, Exotel voice, Groq AI). Credentials encrypted per client, health checks, token refresh, backfill, silence detection |
| Leads | One intake pipeline (normalise → validate → dedupe → create/merge → route), custody (agents never see raw numbers), import (CSV/XLSX, dry run), search, timeline, GDPR/DPDP export + erasure |
| Do | Forced outcome + next action, tasks with missed/escalation sweeps, routing + SLA claim timers, cloud click-to-call or tap-to-call, WhatsApp/SMS with templates, cadences and first-touch automation, replies in the queue |
| Pulse | Five KPIs with trend, team board, leakage with bulk reassign, source quality, scorecards, insight rules, daily digest, CSV export |
| AI (optional, off by default) | Summaries, auto-fill, scoring, next-action extraction, natural-language search, import mapping, new-lead assessment. Suggest-only; kill switch; daily cap |
| Operate | `/healthz` `/readyz` `/metrics`, per-workspace health page and alerts, rate limits, 2FA, backups + restore drill, retention, Prometheus alert rules |

## Run it locally

```bash
cp .env.example .env            # set JWT_ACCESS_SECRET (openssl rand -base64 48) and LOCAL_KEK_BASE64 (openssl rand -base64 32)
docker compose up -d            # mongo replica set, redis, minio, meilisearch
pnpm install
pnpm migrate
pnpm dev:api        # :3000   (OpenAPI at /docs and /openapi.json outside production)
pnpm dev:worker     # sweeps, queues, :9464 metrics
pnpm dev:ingress    # :3100   webhooks
API_URL=http://127.0.0.1:3000 pnpm --filter @leaddesk/web dev   # :3000 -> set PORT or use `next dev -p 3400`
```

Open the web app, **Create a workspace**, and follow the *Get set up* checklist on Today.

## Verify it

```bash
pnpm lint && pnpm typecheck
pnpm test                       # real MongoDB replica sets (mongodb-memory-server), no mocks of the database
pnpm --filter @leaddesk/web e2e # builds the web app, boots the real API process, drives Chromium
PERF_LEADS=330000 pnpm --filter @leaddesk/api exec vitest run test/perf.test.ts --testTimeout 600000   # 1M-lead index/latency audit
```

What the test suites prove (and what they cannot) is listed per phase in `docs/decisions.md`. In short: tenant isolation (cross-tenant matrix), idempotent webhooks, provider fixtures (shapes taken from public docs, **not** verified against live accounts), index-backed hot queries, latency budgets, rate limits, 2FA, erasure, restore verification.

## Deploy

See [`docs/runbook.md`](docs/runbook.md): images (`Dockerfile`, `apps/web/Dockerfile`), `deploy/docker-compose.prod.yml`, environment, backups, restore drill, alerts, incident playbooks. Security posture and open risks: [`docs/security-review.md`](docs/security-review.md).

## Layout

```
apps/api              REST API (NestJS)         apps/web             PWA (Next.js)
apps/worker           queues + sweepers          apps/webhook-ingress webhook receiver (verify, store raw, 200)
packages/db           models, tenant plugin, repositories, migrations
packages/domain       business logic (no HTTP)   packages/platform    Nest wiring, HTTP hardening, metrics
packages/crypto       envelope encryption        packages/shared      RBAC, phone utils
packages/connectors/* one folder per provider    load/  k6 scripts    deploy/  compose + Prometheus rules
```
