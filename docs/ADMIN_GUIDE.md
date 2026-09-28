# PMC Demo — Admin & User Guide

A practical, per-module walkthrough of what you can do in PMC Demo today. This mirrors the
left sidebar's module order. Anything marked **(stub)** has a real UI and data model but doesn't
make a live outbound call to a third party — see `README.md` for the exact, per-phase list of
what's stubbed versus real.

## Getting started

On signup, your workspace is seeded with: an Owner role (full access), a default "B2B Sales
Pipeline", one demo contact so the CRM isn't empty on first login, and a 30-item onboarding
checklist on the Dashboard ("Finish your setup") that tracks real progress — it recomputes against
your actual data every time you load it, so completing a task anywhere in the app (adding a
contact, connecting an app, inviting a teammate) ticks it off automatically.

## Dashboard

Your home screen. The "Finish your setup" banner shows real progress out of 30 tasks. Below it,
14 KPIs across 6 groups (Marketing & Leads, Sales & Revenue, Operations, Messaging & Engagement,
Contacts & CRM, Finance) pull live from their owning module — set a date range and staff filter at
the top, and drag any KPI card to reorder it or use the eye icon to hide one; your layout is saved
per-user. The top bar's search box searches Contacts, Projects, Products, Forms, Funnels, and
Workflows in one query — press **Cmd/Ctrl+K** anywhere to open the same search as a command
palette that also jumps you to any sidebar module. The bell icon shows a consolidated feed of
real events: overdue invoices, failed workflow runs, new inbox messages, and pending leave
requests.

## Lead Generation

Eight tools for capturing leads: **Ecom** (products, synced automatically to Finance so a product
created here is billable there), **Sites** (a block-based page builder — publish a page and it's
reachable at a real public URL), **Chat Widget** (a 5-step wizard; conversations land in Inbox),
**Forms** (field-library builder; a real submission creates a real Contact, honoring GDPR consent,
captcha, and a configurable per-hour rate limit against abuse), **Ad Launcher** (campaign
dashboard with a health-score formula; platform connections are a stub), **AI Social** (post
scheduling and a delivery-health funnel), **Vibe Prospecting** (natural-language lead search
against a real credits/wallet ledger), and **URLs** (a link shortener that hard-blocks link
creation until you've added a domain).

## Lead Management

Your CRM core. The **Contacts** list supports search, temperature/lifecycle filters, and real
server-side pagination (correct at any scale, not just the first page). Each contact profile has
11 tabs — Overview, Opportunities, Fields, Timeline, Appointments, Conversations, Finance, Lead
Scoring, and more. **Leads Kanban** is drag-and-drop across pipeline stages; a stage move is
persisted immediately. Lead Scoring recalculates on a schedule and shows a real trend chart.

## Lead Automation

**Workflows** are trigger → action graphs (e.g. "Contact Created" → "Add Tag"); publish one and it
fires for real the next time its trigger event happens anywhere in the app — check
`docs/ARCHITECTURE.md` §3 for the full trigger catalog and which triggers are actually wired today.
**Email Marketing** and **WABA** send through the same underlying send logic Bulk Campaigns and
Inbox use, so a send here shows up in Inbox's merged conversation timeline too.

## Sales

Sales Performance's rep leaderboard, Webinars, IVR call logs, and the Proposal Builder. Sales
activity (calls, revenue-linked actions) is logged via explicit actions today, not auto-derived
from every possible CRM event.

## AI Suite

**AI Brain**: seed knowledge documents per topic pack; **Chat with Brain** matches by keyword
overlap today, not vector embeddings. **AI Agents**: install a template (Marketing, Sales,
Operations, Finance) and customize tone/instructions/guardrails. Every provider — including five
BYOK options (OpenAI, Gemini, Claude, DeepSeek, xAI/Grok) — routes through one deterministic
internal gateway rather than a real external LLM call **(stub)**; connecting a BYOK key only flips
a connect-state flag and never stores or transmits the raw key beyond a masked tail.

## Operations

**Projects** (Kanban via a status dropdown, not drag-and-drop), **HRM** (Staff directory shared
with School's Teachers, Org Chart, hiring/ATS pipeline, Leave requests with approval — submitting
one notifies the workspace owner), and **Education/School** (Academic Years, Classes, Subjects,
Students; a Setup Progress screen gates full functionality on real prerequisites, not a checkbox).

## Inbox

One merged conversation timeline per contact across WhatsApp, Email, and Chat Widget. New,
Unread, Starred, and Snoozed filters are all backed by real per-conversation state. Real-time
delivery is refetch-on-action, not a live socket push — a second open tab needs to refetch to see
a brand-new message.

## Calendar

Event Types (booking pages) with a full weekly-availability builder; the public booking page is
rate-limited per event-type+IP against scripted slot-hogging. A completed booking fires the
Calendar Events trigger group for Workflows.

## Finance

Dashboard (MRR/ARR/collection-rate/churn from real Subscription/Invoice/Transaction data),
Billing (invoices, subscriptions, installments — all fire real triggers on create/paid/overdue),
Products (shared with Ecom/Community), and Tax Profiles. Razorpay is a connect-state stub.

## Community

Course sales create a real Finance transaction and grant access via Enrollment — this is the same
shared-`Product` pattern as Ecom. Digital Store has real Products/Orders/Coupons; Analytics/Domain/
Store Design are placeholders. Community Profile controls the portal's identity and which modules
(Feed, Chat Groups, Events, etc.) are enabled, though most of those gated modules don't exist yet.

## Agency

Turn any workspace into an agency parent, then spin up sub-account workspaces — each gets its own
full seeded workspace (not a stripped-down shell). Switch between your workspaces from this page
without a password re-prompt, and see a real rollup of KPIs summed across every workspace in the
agency.

## Settings

Roles & Permissions (per-module × per-action grid; edits take effect on a member's very next
request, no re-login), Staff/Members, Tags, Fields & Values, Templates, Vault (real file storage
with an accurate usage figure), Domains (verification is a connect-state stub; a verified domain
assigned to a Funnel or Form is applied for real), Branding (live in the Sidebar the moment you
save it), App Store (a unified view of every module's own connection status, plus a real SMTP
connect flow), Analytics (numbers provably match each source module's own dashboard), and Deleted
Items (a real 30-day recover bin — restoring reinserts the actual document, not just a flag).
