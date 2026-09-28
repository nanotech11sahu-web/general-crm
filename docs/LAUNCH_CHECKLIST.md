# PMC Demo — Launch Checklist

This is a real checklist for taking this codebase from "demo build" to "something you could point
production traffic at." Items are marked **done** where Phase 0–12 already built the real thing,
and **required before launch** where this build stubbed it deliberately (per the build spec's own
instruction to stub vendor/infra calls while keeping the surrounding architecture real).

## Environment configuration

- [x] All secrets read from environment variables with no committed defaults for production use
  (`backend/src/config/env.ts`) — `MONGO_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `JWT_ACCESS_EXPIRES`, `JWT_REFRESH_EXPIRES`, `CLIENT_ORIGIN`, `NODE_ENV`, `PORT`.
- [ ] **Required before launch**: `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` currently fall back to
  hardcoded dev values (`dev_access_secret` / `dev_refresh_secret`) if unset. Set real, distinct,
  high-entropy secrets in every non-local environment, and fail startup loudly if they're missing
  in `NODE_ENV=production` rather than silently falling back.
- [ ] **Required before launch**: `CLIENT_ORIGIN` and the CORS config in `app.ts` currently allow
  any `localhost:*` origin in non-production. Confirm the production CORS origin list is the exact
  set of real frontend domains, nothing broader.
- [ ] **Required before launch**: provision a real MongoDB cluster (replica set, not standalone)
  with authentication, network restrictions (VPC/security group, not open to the internet), and
  automated backups (see below) — local dev and CI both use a standalone/in-memory Mongo.

## Backups

- [ ] **Required before launch**: no backup mechanism exists yet. At minimum: automated daily
  MongoDB snapshots with a tested restore procedure, and a documented RPO/RTO target.
- [ ] **Required before launch**: Vault file uploads (`backend/src/routes/vault.routes.ts`) are
  stored as base64 data URLs on the document itself, not in object storage — this does not scale
  past a small number of files and has no separate backup story from the database itself. Before
  real usage, move Vault storage to S3/GCS/equivalent with its own lifecycle/backup policy.

## Monitoring & alerting

- [ ] **Required before launch**: no APM, error tracking (e.g. Sentry), or structured logging
  pipeline is wired up. `morgan('dev')` logs to stdout only, and only outside `NODE_ENV=test`.
- [ ] **Required before launch**: no queue exists yet for anything (the workflow engine runs
  synchronously in-process via an `EventEmitter`), so there is no "queue health" to monitor today —
  if workflows move to a real job queue before launch, that queue's depth/failure rate needs
  alerting.
- [ ] **Required before launch**: webhook delivery failure alerting doesn't apply yet since no
  outbound webhooks exist (integrations are connect-state stubs) — add this when a real outbound
  webhook integration ships.
- [x] Workflow run failures, overdue invoices, and other real operational events already surface
  in-app via the Phase 11 notification center (`services/notification.service.ts`) — this is a
  reasonable foundation to route into a real alerting channel (email/Slack/PagerDuty) rather than
  building alerting from scratch.

## Security

- [x] RBAC enforced fresh on every request, never cached in the JWT — verified by
  `rbacDepth.routes.test.ts` and `security.routes.test.ts`.
- [x] Cross-workspace IDOR sweep across 9 modules' detail routes — verified, all return 404, not a
  data leak or an existence-confirming 403 (`security.routes.test.ts`).
- [x] Privilege escalation resistance — a zero-permission member cannot touch Roles at all; the
  system Owner role can never be edited/deleted even by its own owner; a forged JWT for a
  nonexistent membership resolves to zero permissions rather than an error.
- [x] Public endpoint rate limiting — form submissions and booking creation are both rate-limited
  per-resource+IP (`public.routes.ts`).
- [x] `npm audit` clean on both backend and frontend as of this pass (0 vulnerabilities) — this is
  a point-in-time result, not a standing guarantee; re-run before every release.
- [ ] **Required before launch**: the in-memory rate limiter (`public.routes.ts`) resets on every
  process restart and doesn't share state across multiple backend instances — replace with a
  shared store (Redis) before running more than one backend instance behind a load balancer.
- [ ] **Required before launch**: no WAF, DDoS protection, or infra-level rate limiting in front of
  the API — the app-level limiter above is a last line of defense, not a substitute.
- [ ] **Required before launch**: a professional penetration test and a dependency SCA tool wired
  into CI (beyond `npm audit`) before handling real customer data.

## Data & scale

- [x] Contacts list: real server-side pagination, verified correct at 50,000+ rows.
- [x] Kanban board: windowed rendering above 50 cards per stage, verified correct at 1,000 cards.
- [ ] **Required before launch**: no load testing has been run against a real deployed environment
  (only in-process integration tests seeding large datasets) — run an actual load test (k6,
  Artillery, or similar) against a staging deployment before launch, especially for the workflow
  engine under concurrent trigger volume, which today runs entirely synchronously per request.

## Staging → production migration plan

1. Stand up a staging environment with its own MongoDB cluster, staging-only secrets, and the same
   CI-validated build artifact that would go to production (no separate "staging build").
2. Run the full Phase 0–12 regression suite against staging data, plus the manual cross-browser/
   device QA pass below.
3. Smoke-test the full signup → seed → core-module walkthrough manually (this mirrors how every
   phase in this build was verified live, not just via automated tests).
4. Cut over DNS/load balancer to the new environment; keep the previous environment warm for a
   defined rollback window (see below) rather than tearing it down immediately.

## Rollback plan

- Database migrations in this codebase are additive (new fields with defaults, new collections) —
  no destructive schema changes have been made across Phases 0–12, so rolling back application code
  to a previous version should not require a database rollback in the common case.
- Keep the previous deployment's build artifact and environment config available for immediate
  redeploy for at least 24 hours after a release.
- If a release does require a breaking schema change in the future, write the migration as
  backward-compatible for one release cycle (old code tolerates the new shape; new code tolerates
  the old shape) rather than a hard cutover, so rollback stays safe.

## Cross-browser / device QA sign-off

- [x] Verified live during this build, module by module, per the pattern established from Phase 0
  onward: Chrome (primary dev/verification browser throughout).
- [ ] **Required before launch**: Safari, Firefox, Edge desktop, iOS Safari, and Android Chrome
  have not been explicitly tested — this build's live-browser verification used one browser
  throughout. Run the same per-module walkthrough on each before launch.

## Final sign-off

This checklist itself is the Phase 12 "launch checklist" deliverable. It intentionally does not
claim things are done that aren't — every unchecked item above is real, scoped work, not a
placeholder. See `README.md`'s Phase 12 section for the full regression/security/coverage results
this checklist is built on top of.
