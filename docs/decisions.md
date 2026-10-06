# Decisions log

Format: decision, why, consequence. Newest last.

## Phase 0

1. **pnpm workspaces, packages export TypeScript source.** No per-package build step; apps run with `tsx` and tests with Vitest + SWC (decorator metadata). Simple for one maintainer. Production images will bundle with a build step added in Phase 7.
2. **Tenant isolation = two layers.** `TenantScopedRepository` (always merges `tenantId`) plus a Mongoose plugin (throws without tenant context, force-scopes every query/aggregate/save, blocks spoofed or mutated `tenantId`). Un-scoped `$lookup`/`$unionWith`/`$graphLookup` are rejected unless in pipeline form with a leading `tenantId` `$match`.
3. **System context is a closed list** (`SYSTEM_OPERATIONS`) reachable only through named functions in `createSystemOps`. Feature code cannot run arbitrary cross-tenant queries.
4. **Raw Mongoose is forbidden in `apps/*`**, enforced by an ESLint `no-restricted-imports` rule and an architecture test.
5. **Tenant-in-token for unauthenticated lookups.** Refresh and invitation tokens are `<tenantId>.<random>`; only the SHA-256 of the whole token is stored. This lets refresh/accept run inside a tenant scope with no system query. A forged prefix simply finds nothing.
6. **Refresh tokens rotate with reuse detection.** Replaying a rotated token revokes the whole family.
7. **Users and tenants are global collections** (no `tenantId`); membership links them. Login uses the named system ops `findUserByEmail` / `listMemberships`.
8. **Migrations:** `packages/db/src/migrations` with a small idempotent runner (changelog collection, migrate-mongo-compatible shape) so migrations run against a real replica set in tests. Spec named `migrate-mongo`; swap in its CLI later if preferred (the dependency is installed).
9. **Validators:** `$jsonSchema` on memberships, leads, integration_connections, integration_inbox.
10. **Secrets:** envelope encryption (fresh DEK per secret, AES-256-GCM, AAD = tenantId:connectionId, DEK wrapped by `KeyService`). `LocalKeyService` for dev/tests, `AwsKmsKeyService` for prod (untested against real KMS). Secret API is write-only; only a `••••1234` hint is stored for display.
11. **Webhook ingress** verifies signature before storing, dedupes on unique `(tenantId, connectionId, externalEventId)`, enqueues once, returns 200. Secrets are cached in-process for 60s to keep acks fast (a revoked connection is refused immediately; a *replaced* secret can take up to 60s to take effect).
12. **Outbox:** events written in the same transaction as the change; dispatcher leases events (`claimedUntil`), publishes, then marks dispatched. At-least-once; consumers must be idempotent.
13. **Lead model in Phase 0 is minimal** (needed for isolation/dedupe tests). Phase 1 extends it.
14. **Invitation delivery:** the invite token is returned to the inviter (copy link). Email sending arrives with the email connector.
15. **Not in Phase 0:** web app, Meilisearch wiring, MinIO usage, 2FA, rate limiting, Dockerfiles. Compose file includes the services.

## Phase 1

16. **Intake is one pipeline** (`LeadService.intake`): normalise -> validate (contacts + custom fields) -> dedupe via `lead_contact_index` -> create or attach "re-enquired" -> activity + outbox event. API, import (and later webhooks) all use it. Lost races on the unique contact index retry as a merge; concurrent submissions of one phone yield exactly one lead (tested with 12 parallel).
17. **Search without Atlas/Meilisearch (for now).** Name search = anchored prefix match on an indexed `nameTokens` array; phone search = denormalised `phoneNorms` (E.164, digits, last-10, suffix `s…`, prefix `p…` keys). Meets the spec's intent on plain MongoDB; swap in Atlas Search/Meilisearch behind `LeadSearch` when volume demands (no API change). Not yet load-tested at 500k leads.
18. **Custody.** `presentLead` is the only way lead data leaves the API: agents get masked contacts, never raw/normalised values or `phoneNorms`. Agents need >= 6 digits to phone-search (limits number-space probing). Export is manager/admin only, audited, and CSV-injection safe. Reduced-custody modes (tap-to-call) arrive with telephony in Phase 4.
19. **Visibility** (`own|team|all`) is applied in the query filter and re-checked on single-lead routes. Other-tenant ids return 404; same-tenant out-of-scope returns 403.
20. **Saved views and filters** go through a whitelist (`LeadQuery`); saved views reject unknown keys. Nothing user-supplied reaches Mongo as a raw filter.
21. **Merge** keeps all contacts/activities, soft-deletes the loser and stores a snapshot; undo is allowed for 30 days. Open tasks/cadences will be included when those exist (Phase 3).
22. **Offboarding**: deactivation + session revocation + audit + outbox event in ONE transaction; open-lead reassignment then runs in chunked short transactions (round-robin over a pool, or unassigned). Re-runnable. Live access tokens die immediately via a membership-status check (10 s cache, invalidated on offboard; other instances converge within the TTL).
23. **Import**: parsed rows are stored in `importrows` (not S3 yet; 20k rows / 5 MB cap). Rows carry an `outcome`, so re-runs and crash-resume are idempotent and final stats are recomputed from outcomes. Formula cells keep their value, never the formula. In Phase 1 the API runs the job in-process after returning; the worker has the same processor, and moving dispatch to BullMQ changes no behaviour.
24. **Not yet done in Phase 1:** web UI, Google Sheets import, AI-assisted mapping, object storage for uploads, virus-scan hook (stub point is `ImportService.create`).
