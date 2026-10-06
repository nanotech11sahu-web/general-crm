# Security review (Phase 7)

Method: code review of auth, tenancy, input handling, outbound HTTP, file/object handling, secrets and the browser surface against the OWASP Top 10 and the spec's security list; `pnpm audit`; adversarial tests for each control. **This is an internal review, not a penetration test. Commission an external pentest before taking real customer data at scale.**

## Controls verified by tests

| Risk | Control | Evidence |
|---|---|---|
| Broken access control / tenant leaks | Mandatory tenant-scoped repositories **and** a Mongoose plugin that scopes every query/update/aggregate/insert; lint rule + architecture test ban raw `mongoose` in app code; indexes lead with `tenantId` | `packages/db/test/tenancy.test.ts`, cross-tenant 404/403 tests in every API suite |
| Privilege escalation | RBAC permissions in code; managers cannot invite admins; agents cannot export; each sensitive route has a permission check | `apps/api/test/api.test.ts` (RBAC, per-feature 403 tests) |
| IDOR | Lead/conversation/suggestion/task routes re-check the caller's visibility scope | per-module "colleague cannot" tests |
| Authentication | argon2id; 15-min JWT + rotating httpOnly refresh cookie with reuse detection; per-IP route limits; account+IP lockout (uniform for unknown users); TOTP 2FA with single-use steps and hashed recovery codes; logout-all and password change revoke sessions; disabled users and suspended workspaces blocked | `apps/api/test/hardening.test.ts` |
| CSRF | SameSite=Strict refresh cookie + Origin/Sec-Fetch-Site check on cookie-authenticated unsafe requests; API otherwise uses bearer tokens | hardening tests; browser e2e passes through the real proxy |
| Injection | Global `ValidationPipe` (whitelist, forbid unknown); search regexes escaped; AI filters are a closed `.strict()` schema compiled server-side; CSV/XLSX cells neutralised (formula injection) on import and export | domain/API tests (`nl_search` `$where` rejected; export escaping) |
| SSRF | Connector HTTP client: https only, fixed host allow-list checked on every request, timeouts, response size caps (redirect handling is the runtime `fetch` default: verify against provider behaviour before go-live) | `packages/connectors/core` tests, per-connector "blocked host" tests |
| Secrets | Client credentials sealed with envelope encryption (AES-256-GCM, DEK wrapped by KMS/KEK, AAD = tenant+connection), write-only API, shown once; platform secrets validated at boot and never logged (logger redacts) | crypto tests; API tests assert secrets never appear in responses/exports |
| Webhooks | Raw body signature/token check in constant time **before** parsing, store raw, 200 fast, process in worker, idempotent by event id; app-level hooks never IP-throttled, rejected requests are | ingress tests |
| Files | Upload size/type/row limits; recordings only via short-lived HMAC URLs; object keys never returned; path traversal blocked in the store | storage/API tests |
| Privacy / AI | PII masked before any AI call; AI cannot write data; kill switch; DPDP export/erasure with suppression | `ai.test.ts`, `privacy.test.ts` |
| Availability | Rate limits fail open; per-connection webhook ceilings; body size defaults; worker leases and idempotency | hardening + burst tests |
| Browser | CSP (self only; `unsafe-inline` for Next's bootstrap), frame-ancestors none, no inline user HTML rendered anywhere (React escaping; no `dangerouslySetInnerHTML`), `Cache-Control: no-store` on API | grep + e2e |
| Supply chain | `pnpm audit --prod` clean at the time of review (postcss, uuid, csv-parse bumped via overrides/upgrade); CI audit step, Dependabot, CodeQL, secret scanning | CI config |

## Findings fixed during the review

1. **Unvalidated `x-request-id`** was echoed into responses and logs (log/header injection) → ids are accepted only if they match a safe pattern.
2. **No brute-force protection and no throttling anywhere** → layered rate limits and lockout.
3. **JWT secret could be undefined or a placeholder in production** → boot validation refuses weak configuration.
4. **Disabled users could keep refreshing tokens**; suspended workspaces were not blocked → both checked on refresh and in the membership cache.
5. **Unbounded password length** (argon2 CPU DoS) → 128-char cap before hashing.
6. **Workspace export leaked invitation token hashes** (found by the export test) → all token/password/secret fields are stripped from every exported document.
7. **Recording signing key fell back to a short dev string and reused the raw JWT secret** → derived purpose-bound key; production requires `OBJECT_SIGNING_SECRET`.
8. **Index gaps** (planner could scan across tenants for newest-first lists) → additive index migration; not a vulnerability by itself but a cross-tenant performance side channel.
9. **Dependencies**: 6 advisories (postcss ×4, uuid, csv-parse) → resolved.

## Accepted risks and open items (owner: whoever runs the deployment)

- **No external penetration test, no formal threat model workshop.** Do both before onboarding paying customers.
- **Provider integrations are fixture-verified only.** Webhook signature schemes and payload shapes follow public documentation; confirm each against a live sandbox before go-live (Meta app review, WhatsApp, MSG91 DLT, Exotel).
- **CSP allows `script-src 'unsafe-inline'`** because Next.js emits inline bootstrap scripts; moving to nonces requires a custom server/middleware.
- **Access tokens are held in JS memory** (XSS would expose a 15-minute token; the refresh cookie is httpOnly). The CSP and React escaping are the mitigation; there is deliberately no `localStorage` token.
- **2FA is optional and per user** (no enforced-by-role policy, no WebAuthn, no email-based recovery yet).
- **Manager visibility vs Pulse**: Pulse is tenant-wide for managers while lead visibility is team-scoped (decisions #76).
- **Imports retain uploaded rows** until the job is deleted (not yet under retention).
- **Redis outage fails rate limits open** by design; alert on `/readyz` redis=down.
- **Docker images and the backup scripts were not executed** in the authoring environment.
- **No WAF / DDoS layer**: put the ingress and API behind your cloud's edge protection.
- **Sentry/error tracking is not wired** (needs an account decision). Structured JSON logs with request ids are the current source of truth.
- **Audit log has no tamper-evidence** (append-only by convention, tenant-scoped, 90-day TTL is **not** applied to it).
