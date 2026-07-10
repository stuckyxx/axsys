# Axsys SaaS Master Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coordinate six independently testable implementation plans into one complete, secure, responsive Axsys SaaS running locally against Supabase.

**Architecture:** Build a Next.js modular monolith whose browser communicates with a typed BFF and whose PostgreSQL, Auth, Storage, and Realtime services run in Supabase local. Each subsystem owns focused domain, server, UI, migration, RLS, and test files; PostgreSQL is the only business source of truth. Tenant isolation is enforced independently in BFF, RLS, Storage, documents, and an audience-scoped Realtime signal stream. Direct business-table mutation is denied, privileged functions default to non-public, every download is authorized/audited, and sensitive responses never enter a persistent/shared business cache.

**Tech Stack:** Next.js 16.2.10, React 19.2.7, TypeScript, npm lockfile, Tailwind CSS, customized shadcn/ui, Geist/Geist Mono, Phosphor Icons, Supabase CLI 2.109.1, @supabase/ssr 0.12.0, @supabase/supabase-js 2.110.2, PostgreSQL/RLS/pgTAP, Vitest 4.1.10, Playwright 1.61.1, ClamAV 1.5.3.

---

## Approved inputs

- Product and security design: docs/superpowers/specs/2026-07-10-axsys-saas-design.md
- Brand source supplied by the user: /Users/gabrielmachado/Downloads/axsys.png
- Theme: dark by default, light selectable and persisted by user.
- Platform split: one login; Super Admin redirects to /platform and never enters tenant operations; enterprise users redirect to /app.
- Data consistency: no business cache persistence, no manual cache clearing, immediate post-mutation refresh, version conflicts instead of silent overwrite.
- Scope exclusions: Orders, legal digital signing, advanced standalone XML import, public contracts, WhatsApp/SMS, and automatic legacy migration.

## Environment facts and prerequisites

- The workstation has Node.js 24.13.0 and npm 11.6.2, which satisfy Next.js and Supabase CLI minimums.
- pnpm, Docker, and a global Supabase CLI are not currently available.
- Use npm and the project-pinned Supabase CLI through npx.
- Before database, Storage, email, scanner, or E2E work, install and start a Docker-compatible runtime. Do not replace Supabase local with mocks to bypass this prerequisite.
- Never embed bootstrap credentials in Git. The local Super Admin command reads environment values at execution time.

## Stable dependency baseline

Use exact versions and commit package-lock.json:

| Package | Version |
|---|---:|
| next | 16.2.10 |
| react / react-dom | 19.2.7 |
| typescript | 5.9.3 |
| tailwindcss / @tailwindcss/postcss | 4.3.2 |
| eslint | 9.39.4 |
| eslint-config-next | 16.2.10 |
| @supabase/ssr | 0.12.0 |
| @supabase/supabase-js | 2.110.2 |
| supabase CLI | 2.109.1 |
| zod | 4.4.3 |
| react-hook-form | 7.81.0 |
| @hookform/resolvers | 5.4.0 |
| @tanstack/react-query | 5.101.2 |
| @phosphor-icons/react | 2.1.10 |
| next-themes | 0.4.6 |
| decimal.js | 10.6.0 |
| date-fns | 4.4.0 |
| @date-fns/tz | 1.5.0 |
| saxes | 6.0.0 |
| file-type | 22.0.1 |
| sharp | 0.35.3 |
| tus-js-client | 4.3.1 |
| @google/genai | 2.11.0 |
| @react-pdf/renderer | 4.5.1 |
| pdf-lib | 1.17.1 |
| recharts | 3.9.2 |
| sonner | 2.0.7 |
| pino | 10.3.1 |
| prettier | 3.9.5 |
| vitest | 4.1.10 |
| @vitest/coverage-v8 | 4.1.10 |
| @playwright/test | 1.61.1 |
| @axe-core/playwright | 4.12.1 |

Before installing a version, run npm view for that package. If a critical security release supersedes this table, update the plan and lockfile together; never silently switch to latest or a canary.

## Locked top-level file structure

    src/
      app/
        (public)/
        (protected)/app/
        (protected)/platform/
        api/
      components/
        brand/
        ui/
        layout/
        providers/
      lib/
        db/
        env/
        http/
        money/
        observability/
        query/
        realtime/
        security/
        supabase/
        theme/
      modules/
        auth/
        audit/
        platform/
        companies/
        users/
        bank-accounts/
        settings/
        files/
        administrative/
        proposals/
        contracts/
        certificates/
        finance/
        payments/
        documents/
        dashboard/
        notifications/
        realtime/
    supabase/
      migrations/
      tests/database/
      config.toml
      seed.sql
    tests/
      unit/
      integration/
      helpers/
      e2e/
    scripts/
    services/document-sanitizer/
    docker/
    docs/security/
    docs/runbooks/

Within a module, use domain for pure rules, schemas for untrusted input, server for repositories/use cases, actions for Server Actions, and components for UI. Server Components are the default; client components remain interactive leaves.

## Plan order and dependency graph

1. docs/superpowers/plans/2026-07-10-axsys-01-foundation-auth-security.md
2. docs/superpowers/plans/2026-07-10-axsys-02-platform-users-settings.md
3. docs/superpowers/plans/2026-07-10-axsys-03-administrative.md
4. docs/superpowers/plans/2026-07-10-axsys-04-certificates-storage-public.md
5. docs/superpowers/plans/2026-07-10-axsys-05-finance-payments-documents.md
6. docs/superpowers/plans/2026-07-10-axsys-06-dashboard-notifications-hardening.md

Execute in this order. Plans 01 and 02 establish cross-cutting primitives consumed by later work. Plan 03 establishes clients/contracts consumed by payments. Plan 04 establishes certificate checks and secure files. Plan 05 completes financial transactions and documents. Plan 06 integrates notifications/freshness and executes the full acceptance matrix.

## Specification coverage matrix

| Approved design area | Implemented and verified by |
|---|---|
| Local Next.js/Supabase foundation, modular boundaries, design system | Plan 01 |
| Login, cookies, CSRF, rate limit, password policy, provisional/reset flows | Plan 01 |
| Tenant context, RLS helpers, restricted BFF role, audit/security events | Plan 01 |
| Separate /platform and /app shells, role/module route guards | Plans 01–02 |
| Super Admin companies, administrators, banks, platform audit/health | Plan 02 |
| Company users/modules, last-admin protection, profile/theme | Plan 02 |
| Company settings, encrypted CPF/banking data, drafts, branding uploads | Plan 02 |
| Shared TUS quarantine/capability lifetime, quota holds/retirement, MIME/magic checks, ClamAV, private Storage | Plans 02–05 |
| Clients, catalog, client aggregate detail, deletion/archive integrity | Plan 03 |
| Proposals, Decimal calculations, sequence, status, canonical PDF | Plan 03 |
| Contracts, status/progress, filters, attachments, close/payment shortcuts | Plan 03 defines hidden/canonical links; Plan 05 installs routes and enables them |
| Certificate types/versions, inclusive validity, history, publication/revocation | Plan 04 |
| Public certificate no-store page, 15-second/focus polling, hierarchical limits and reauthorized downloads | Plan 04 |
| Income/expense CRUD, real totals/chart, immutable automatic postings | Plan 05 |
| Payment drafts, invoice files, Gemini suggestions/manual fallback | Plan 05 |
| Six-certificate formalization, controlled override, snapshot | Plan 05 |
| Atomic paid/income/tax transaction, idempotency, concurrency, reversal | Plan 05 |
| Immutable payment letters/process PDFs, isolated sanitizer container and protected downloads | Plan 05 |
| Real dashboard, 45/5-day alerts, durable notification reads | Plan 06 |
| Audience-scoped Realtime/BroadcastChannel/focus/watchdog refresh without business cache persistence | Plans 01 and 06 |
| Authorized download attempt/completion audit for avatar, branding, proposal, contract, certificate and payment files | Plan 02 core; Plans 03–05 integrations; Plan 06 regression |
| Explicit table/column/routine grants and schema-wide default-deny scans on a fresh project | Every database plan; final catalog scan in Plan 06 |
| Dark-first/light theme, mobile/tablet/desktop, WCAG AA | Every UI plan; final gate in Plan 06 |
| IDOR, XSS, CSRF, SSRF, upload, RLS, replay and cache regressions | Per-plan tests; full matrix in Plan 06 |
| Local runbooks, secure bootstrap, CI and production-readiness gate | Plan 06 |

The explicitly excluded features have no implementation task or visible simulated control. Their absence is intentional and tested during final navigation review.

### Task 1: Prepare isolated execution

**Files:**
- Verify: .git/
- Verify: docs/superpowers/specs/2026-07-10-axsys-saas-design.md
- Verify: docs/superpowers/plans/

- [ ] **Step 1: Confirm the planning branch is clean except outputs**

Run:

    git status --short --branch
    git log --oneline -5

Expected: design and plans are committed; outputs may remain untracked as user-facing copies; no application code exists yet.

- [ ] **Step 2: Use the worktree safety skill**

Invoke superpowers:using-git-worktrees and create an isolated branch with the codex/ prefix for implementation. Do not execute the implementation directly on main.

- [ ] **Step 3: Verify prerequisites without changing scope**

Run:

    node --version
    npm --version
    docker version

Expected: Node is at least 20.9, npm is available, and Docker client/server respond. If Docker is missing, stop for installation rather than substituting a different database.

### Task 2: Execute Plan 01 — foundation, Auth, RLS, and shells

**Files:**
- Follow: docs/superpowers/plans/2026-07-10-axsys-01-foundation-auth-security.md

- [ ] **Step 1: Execute every unchecked step with TDD**

Use a fresh implementation subagent per task and complete both spec-compliance and code-quality review before advancing.

- [ ] **Step 2: Run the Plan 01 gate**

Expected: login/logout/reset/provisional password, /platform and /app redirects, base RLS matrix, CSRF, audit, theme, no-store data layer, and local Supabase tests all pass.

- [ ] **Step 3: Record the checkpoint**

Create a checkpoint commit only if the worktree is clean after Plan 01 verification.

### Task 3: Execute Plan 02 — platform, companies, users, and settings

**Files:**
- Follow: docs/superpowers/plans/2026-07-10-axsys-02-platform-users-settings.md

- [ ] **Step 1: Execute every unchecked step with TDD**

Require company/admin compensation tests, last-admin protection, encrypted banking fields, generic secure upload substrate, settings drafts, tenant IDOR tests, and responsive portal verification.

- [ ] **Step 2: Run the Plan 02 gate**

Expected: Super Admin operates only platform metadata; Company Admin manages only its tenant; passwords and uploads follow the approved secure flows.

- [ ] **Step 3: Record the checkpoint**

Commit only after unit, database, E2E, build, and advisor commands pass.

### Task 4: Execute Plan 03 — administrative module

**Files:**
- Follow: docs/superpowers/plans/2026-07-10-axsys-03-administrative.md

- [ ] **Step 1: Execute every unchecked step with TDD**

Require relational links, decimal calculations, sequential proposals, canonical proposal PDFs, contract attachments, status/progress, 409 conflict handling, and responsive list/form states.

- [ ] **Step 2: Run the Plan 03 gate**

Expected: client, catalog, proposal, and contract flows pass domain, RLS, IDOR, XSS/PDF, Storage, cache-freshness, and browser tests.

- [ ] **Step 3: Record the checkpoint**

Commit only verified application and test files.

### Task 5: Execute Plan 04 — certificates, Storage, and public portal

**Files:**
- Follow: docs/superpowers/plans/2026-07-10-axsys-04-certificates-storage-public.md

- [ ] **Step 1: Execute every unchecked step with TDD**

Reuse the shared path-scoped TUS/quarantine/ClamAV capability substrate, including two-hour signed authorization, resumable-session grace, quota hold, safe retirement, and replay-blocking cleanup. Do not add Base64 persistence or public buckets.

- [ ] **Step 2: Run the Plan 04 gate**

Expected: history and inclusive validity are correct, only explicitly published current versions are public, revocation is immediate, and cross-tenant files remain unavailable.

- [ ] **Step 3: Record the checkpoint**

Commit only after private/public/adversarial E2E and advisors pass.

### Task 6: Execute Plan 05 — finance, payments, Gemini, and documents

**Files:**
- Follow: docs/superpowers/plans/2026-07-10-axsys-05-finance-payments-documents.md

- [ ] **Step 1: Execute every unchecked step with TDD**

Treat Gemini output as untrusted suggestions, preserve manual fallback, and keep mark-paid plus income plus tax in one locked idempotent transaction.

- [ ] **Step 2: Run the Plan 05 gate**

Expected: ledgers/dashboard use real values; formalization snapshots six certificates; payment creates exactly one posting set; reversal is auditable; PDFs are escaped, immutable, and tenant-protected.

- [ ] **Step 3: Record the checkpoint**

Commit only after race, replay, IDOR, XSS, upload, document, cache-freshness, and browser tests pass.

### Task 7: Execute Plan 06 — dashboard, notifications, and final hardening

**Files:**
- Follow: docs/superpowers/plans/2026-07-10-axsys-06-dashboard-notifications-hardening.md

- [ ] **Step 1: Execute every unchecked step with TDD**

Implement the audience-scoped tenant/user/platform invalidation stream, durable notification reads, real dashboard, headers/CSP, redacted logging, runbooks, CI, and complete adversarial matrix.

- [ ] **Step 2: Run the master verification command**

Run:

    npm run verify
    npm run db:advisors
    git diff --check

Expected: all commands exit 0, no security advisor finding remains, and the worktree contains only intended files.

- [ ] **Step 3: Request final independent code review**

Invoke superpowers:requesting-code-review. Resolve all P0/P1 findings and rerun the master verification command before making any completion claim.

### Task 8: Conduct the user's local acceptance session

**Files:**
- Follow: docs/runbooks/local-development.md
- Verify: README.md

- [ ] **Step 1: Start the complete local stack**

Run the documented Supabase, ClamAV, locked document-sanitizer image/self-test, and Next.js commands from a clean checkout.

- [ ] **Step 2: Bootstrap without hardcoded credentials**

Run the bootstrap script with user-supplied local environment values and confirm no password appears in console or Git.

- [ ] **Step 3: Walk through all four personas**

Verify Visitor, Super Admin, Company Admin, and User behavior, including module denial and the strict split between /platform and /app.

- [ ] **Step 4: Demonstrate freshness and isolation**

Use two companies, two browser contexts, and two tabs. Show immediate updates without cache clearing and prove Company A cannot read, infer, mutate, subscribe to, or download Company B data.

- [ ] **Step 5: Capture acceptance results**

Record passed commands, browser scenarios, known environmental prerequisites, and any user-requested changes. A public deployment remains outside this local acceptance and must follow docs/runbooks/production-readiness.md.

## Completion rule

The project is complete only when every checkbox in all six plans is checked, every plan-specific gate passes, the master acceptance matrix passes, an independent review has no unresolved P0/P1 finding, and the user completes the local walkthrough. Near-complete modules, mocked security checks, skipped Docker services, or manual cache-clearing workarounds do not satisfy completion.

## Current official references

- Next.js installation and system requirements: https://nextjs.org/docs/app/getting-started/installation
- Next.js 16 upgrade notes: https://nextjs.org/docs/app/guides/upgrading/version-16
- Supabase local CLI: https://supabase.com/docs/guides/local-development/cli/getting-started
- Supabase server-side client guidance: https://supabase.com/docs/guides/auth/server-side/creating-a-client
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control
- Gemini model lifecycle: https://ai.google.dev/gemini-api/docs/deprecations
