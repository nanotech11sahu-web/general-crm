# PMC Demo — Internal Architecture

This document is for engineers picking up the codebase after this build. It describes how the
system is put together and *why*, not what every function does — the code and its tests are the
source of truth for that.

## 1. Stack

- **Backend**: Node.js + Express + TypeScript, Mongoose/MongoDB, JWT access+refresh auth, Zod for
  request validation, Jest + Supertest + `mongodb-memory-server` for tests.
- **Frontend**: React 19 + TypeScript + Vite, Tailwind CSS v4 (CSS custom properties for live
  theming), TanStack Query for server state, Zustand for client state, Framer Motion, Vitest +
  React Testing Library.
- **No external infra dependency for local dev**: MongoDB is the only required service. Every
  third-party integration (Zoom, Razorpay, WhatsApp Business, ad platforms, AI providers, SMTP,
  domain DNS) is a connect-state stub — real models and state machines, no outbound vendor call —
  per the build spec's own instruction. See `README.md`'s per-phase "Deferred" sections for the
  exact boundary of what's stubbed versus real in each module.

## 2. Request lifecycle and multi-tenancy

Every authenticated request carries a JWT with `{ sub: userId, workspaceId, membershipId }`
(`backend/src/lib/jwt.ts`). The `authenticate` middleware (`middleware/auth.ts`) verifies the
token, then calls `resolveEffectivePermissions(membershipId)` (`services/rbac.service.ts`) **on
every request** — permissions are never cached in the token. This is deliberate: editing a role's
permissions takes effect on that member's very next API call, with no re-login, which is directly
tested (`rbacDepth.routes.test.ts`).

Every collection that holds tenant data carries a `workspaceId`, and every route filters by
`req.auth!.workspaceId` before returning or mutating anything. There is no cross-workspace query
path in the codebase — this is enforced by convention (every route file follows the same
`Model.findOne({ _id, workspaceId })` shape) and verified by a systematic IDOR sweep in
`security.routes.test.ts` (Phase 12) that asserts a resource created in one workspace returns 404,
not 200 or 403, when a different workspace's valid token tries to read it.

RBAC permissions are a `{ [module]: { read, create, edit, delete } }` map
(`constants/modules.ts`). The `Role.isSystem` Owner role always resolves to full access
(`fullPermissionMap()`); it can never be edited or deleted (checked in `roles.routes.ts`, not just
UI-hidden). `LeadershipTitle` documents apply additive overrides on top of a member's role.

## 3. The event bus and workflow engine

`lib/eventBus.ts` is an in-process `EventEmitter` wrapping a closed union of `PlatformEvent`
strings. Modules call `emitPlatformEvent(event, payload)` when something real happens (a contact
is created, an invoice goes overdue, a course is purchased). `constants/triggers.ts` is the full
trigger taxonomy from the build spec, with a `wired: boolean` flag — `wired: true` means the event
is actually emitted today; the rest are catalogued for the Workflow Builder's trigger picker but
belong to modules/behaviors not built yet. `services/workflowEngine.ts` subscribes to every wired
trigger key and runs any published `Workflow` whose `triggerKey` matches
(`services/workflow.service.ts` → `executeWorkflow`).

This same bus is what the Phase 11 notification center listens to indirectly: rather than a second
generic subscriber, the modules that need to notify the workspace owner (`finance.service.ts` on
overdue, `inbox.service.ts` on a new message, `workflow.service.ts` on a failed run,
`hrm.routes.ts` on a pending leave request) call `notifyWorkspaceOwner()`
(`services/notification.service.ts`) directly alongside their existing `emitPlatformEvent` call.

## 4. Shared objects (build once, reuse across modules)

A few models are deliberately shared across module boundaries rather than duplicated per module —
this is the single most load-bearing architectural decision in the codebase and is called out
explicitly in `README.md`'s per-phase notes wherever it applies:

- **`Product`** (`models/Product.ts`) — one schema, three surfaces: Ecom (`source: 'ecom'`),
  Community's Digital Store and Courses (`source: 'community'`), and Finance reads it directly for
  billing. Creating a product in any surface makes it visible and billable everywhere else.
- **`Staff`** (`models/Staff.ts`) — backs HRM's People/Org Chart directory and School's Teachers.
- **`Tag`** and **`CustomField`** — one engine, `appliesTo`/`objectType` scoped, used by Contacts,
  Projects, and others rather than a per-object tagging/fields implementation.
- **`DeletedItem`** — the single soft-delete path. Every module's delete endpoint writes a
  `{ originalCollection, originalId, snapshot }` record here instead of hard-deleting; restore
  does a genuine `mongoose.model(originalCollection).create(snapshot)`, not a flag flip.
- **`Wallet`/`WalletTransaction`** — one credits ledger, reused by Vibe Prospecting, WABA billing,
  and the AI gateway's cost tracking.

## 5. Anti-staleness pattern

A real bug in Phase 7 (a cached AI Brain seed document going stale) became a standing lesson
applied everywhere afterward: **compute derived numbers live from their source data, never from a
stored counter that can drift**. Concretely:

- Tag usage counts are a live `Contact.aggregate()`, not a stored counter on the Tag document.
- Cross-module Analytics (Phase 10) and the Dashboard's 14 KPIs (Phase 11) call each owning
  module's own dashboard/aggregation function directly (`computeDashboard`,
  `computeCommunityDashboard`, `computeAiDashboard`) rather than re-deriving the same numbers a
  second time — this makes the values provably identical by construction, not by careful
  duplication, and is locked in by regression tests that compare the two call sites directly.
- The Phase 11 onboarding checklist recomputes all 30 items against real collections on every
  read (`services/onboarding.service.ts`) instead of trusting a flag set once at creation time —
  this caught a real gap where the seeded demo contact and default pipeline were never marked
  complete despite already existing.

## 6. Module boundaries (backend)

Each business module is one `routes/<module>.routes.ts` file (thin: auth, validation, permission
check, delegate to a service or the model directly) plus, where the logic is non-trivial, a
`services/<module>.service.ts`. `app.ts` is the single place every router is mounted — start there
to find where a URL prefix lives. There is no ORM-level module boundary beyond Mongoose model
files; module isolation is enforced by convention (a route file only touches its own models plus
the shared ones above) and by the workspace-scoping rule in §2.

## 7. Frontend shape

`App.tsx` is the route table; `components/shell/AppShell.tsx` is the authenticated layout
(Sidebar, TopBar, mobile nav/drawer, floating buttons, and the Phase 11 command palette, which is
mounted globally and listens for cmd/ctrl-K). Each module has a `pages/<module>/` folder; most
follow a `<Module>Home.tsx` (tabs) → `<Tab>.tsx` (list + create-form) pattern established from
Phase 2 onward and repeated through Phase 10's Settings tabs. `lib/api/<module>.ts` files are thin
Axios wrappers with typed request/response shapes; `lib/apiClient.ts` is the single shared Axios
instance with the token-refresh interceptor (attach current token on request, transparently
refresh and retry once on a 401, clear the session if the refresh token itself is rejected — this
exact logic has a dedicated test suite in `apiClient.test.ts` because a live debugging session
during Phase 10 verification hit the real race it's designed to survive).

## 8. Testing strategy

- **Backend**: every route file with real logic has a colocated `*.routes.test.ts` using
  `mongodb-memory-server` (no live Mongo needed) and a shared `test/helpers.ts::createOwnerContext()`
  that seeds a full workspace (owner user, Owner role, default pipeline, demo contact) so tests
  don't each hand-roll tenant setup. Coverage is enforced as a CI gate (`jest.config.js`
  `coverageThreshold`, see §10) at the level actually achieved in Phase 12's hardening pass.
- **Frontend**: business-logic-bearing components (Sidebar branding, the Dashboard KPI grid,
  ContactsTable pagination, KanbanBoard virtualization, the notification bell, the token-refresh
  interceptor) have dedicated Vitest suites. The majority of page-level UI across this 12-phase
  build was verified live in the browser per phase rather than with unit tests — that was this
  build's stated strategy from Phase 0 onward, not an oversight, and it's why frontend statement
  coverage sits far below the backend's. See `README.md`'s Phase 12 section for the exact number
  and the honest reasoning, rather than a fabricated target.
- **Security**: `security.routes.test.ts` (Phase 12) is a systematic cross-workspace IDOR sweep
  across nine modules' detail routes, plus privilege-escalation resistance tests (a
  zero-`settings`-permission member cannot touch Roles at all; the system Owner role can never be
  edited/deleted even by its own owner; a forged JWT for a nonexistent membership resolves to zero
  permissions rather than an error that would leak whether the id exists).

## 9. Load-bearing performance decisions (Phase 12)

- **Contacts list**: server-side pagination (`page`/`limit`, max 200/page) existed on the backend
  since Phase 1 but the frontend never used it — it always fetched page 1 and stopped. Phase 12
  wired real Prev/Next controls into `ContactsTable.tsx`, verified with a test asserting 50,000
  total rows paginate correctly rather than silently truncating.
- **Kanban board**: `KanbanColumn` renders every card in a stage directly via `.map()` below 50
  cards (preserves the existing Framer Motion enter/exit animation), and switches to a
  `react-window` `FixedSizeList` above that threshold so a 1,000-card stage only mounts the rows
  near the visible viewport. `dnd-kit`'s drag targets are the column (stage), not per-card drop
  positions, so windowing doesn't change drag behavior — verified with a test asserting a
  far-off card in a 1,000-card stage is never mounted.
- **Public endpoints**: `public.routes.ts` rate-limits both form submissions (existing,
  per-form+IP, configurable per form) and booking creation (added in Phase 12, flat 20/hour per
  event-type+IP) against scripted abuse, since these are the only unauthenticated write paths in
  the system.

## 10. CI and coverage gate

`.github/workflows/ci.yml` runs, on every push/PR to `main`: backend typecheck (`tsc --noEmit`),
lint (`eslint`), the full Jest suite with coverage (fails the build below the thresholds in
`backend/jest.config.js`), and `npm audit`; and frontend typecheck (`tsc -b`), lint (`oxlint`), the
full Vitest suite, and `npm audit`. There is no coverage gate on the frontend job — see §8 for why
a fabricated 80% frontend gate would be dishonest busywork rather than a real signal, and
`README.md`'s Phase 12 section for the number actually achieved.
