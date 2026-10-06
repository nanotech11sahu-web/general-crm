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
