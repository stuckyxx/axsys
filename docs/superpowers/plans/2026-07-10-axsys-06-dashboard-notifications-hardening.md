# Axsys Dashboard, Notifications, Consistency, and Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the completed Axsys modules into a fresh, responsive dashboard with durable deadline notifications, immediate cross-tab/cross-user refresh, full acceptance coverage, and a documented local production-readiness gate.

**Architecture:** A small audience-scoped `invalidation_events` stream (tenant, individual user, or platform) is the only Realtime channel used by the UI. Mutations commit business rows, audit, and an invalidation event together; the client treats events only as signals to refetch fresh no-store data. Dashboard and notifications are derived from PostgreSQL records, never fake constants, and final security gates exercise UI, API, RLS, Storage, documents, concurrency, and browser behavior.

**Tech Stack:** Next.js 16.2.10, React 19.2.7, Supabase Realtime/PostgreSQL/Auth, TanStack Query 5.101.2, @supabase/supabase-js 2.110.2, Pino 10.3.1, @axe-core/playwright 4.12.1, Vitest 4.1.10, pgTAP, Playwright 1.61.1.

---

## Dependency and file map

This plan assumes plans 01 through 05 pass their local verification gates.

- Create through CLI: supabase/migrations/*_notifications_invalidation.sql
- Create: supabase/tests/database/06_notifications_rls.test.sql
- Modify: src/lib/db/bff.ts
- Modify: src/modules/auth/server/{login,logout,set-temporary-password,change-password,password-recovery}.ts
- Modify: src/modules/{companies,users,settings,files,administrative,proposals,contracts,certificates,finance,payments}/**/server/*.ts
- Create: tests/contracts/invalidation-writer-callsite.test.ts
- Create: src/modules/notifications/domain/deadline-alerts.ts
- Create: tests/unit/notifications/deadline-alerts.test.ts
- Create: src/modules/notifications/server/notification-repository.ts
- Create: src/modules/notifications/server/notification-service.ts
- Create: tests/integration/notifications/notification-service.test.ts
- Create: src/modules/notifications/actions/notification-actions.ts
- Create: src/modules/notifications/components/notification-bell.tsx
- Create: src/modules/notifications/components/notification-sheet.tsx
- Create: src/modules/dashboard/server/dashboard-service.ts
- Create: tests/integration/dashboard/dashboard-service.test.ts
- Create: src/modules/dashboard/components/enterprise-dashboard.tsx
- Create: src/modules/dashboard/components/module-launcher.tsx
- Create: src/modules/dashboard/components/deadline-panel.tsx
- Create: tests/unit/dashboard/dashboard-components.test.tsx
- Modify: src/app/(protected)/app/dashboard/page.tsx
- Modify: src/lib/supabase/browser.ts
- Create: src/lib/realtime/invalidation-scopes.ts
- Modify: src/lib/realtime/server-invalidation.ts
- Modify: src/lib/realtime/invalidation-channel.ts
- Create: src/lib/realtime/invalidation-provider.tsx
- Modify: src/lib/query/query-keys.ts
- Modify: src/lib/query/mutation-sync.tsx
- Modify: src/components/providers/scoped-providers.tsx
- Create: tests/unit/realtime/invalidation-provider.test.tsx
- Create: tests/integration/realtime/invalidation-scope-contract.test.ts
- Modify: src/app/api/auth/realtime-token/route.ts
- Modify: src/components/layout/company-shell.tsx
- Modify: src/components/layout/platform-shell.tsx
- Modify: src/lib/security/csp.ts
- Modify: src/proxy.ts
- Modify: next.config.ts
- Create: src/lib/observability/logger.ts
- Create: src/instrumentation.ts
- Create: tests/unit/observability/logger.test.ts
- Create: tests/integration/http/security-headers.test.ts
- Create: docs/security/threat-model.md
- Create: docs/security/rls-matrix.md
- Create: docs/runbooks/local-development.md
- Create: docs/runbooks/production-readiness.md
- Modify: scripts/bootstrap-local.ts
- Create: tests/unit/scripts/bootstrap-local.test.ts
- Create: scripts/redact-ci-artifacts.ts
- Create: tests/unit/scripts/redact-ci-artifacts.test.ts
- Create: scripts/scan-secrets.ts
- Create: tests/unit/scripts/scan-secrets.test.ts
- Create: .secrets.baseline.json
- Create: scripts/verify.ts
- Create: tests/unit/scripts/verify.test.ts
- Create: scripts/provision-test-env.ts
- Create: tests/unit/scripts/provision-test-env.test.ts
- Modify: README.md
- Modify: package.json
- Create: .github/workflows/ci.yml
- Create: tests/e2e/dashboard-notifications.spec.ts
- Create: tests/e2e/cache-consistency.spec.ts
- Create: tests/e2e/accessibility-responsive.spec.ts
- Create: tests/e2e/security-regression.spec.ts
- Create: tests/e2e/full-business-flow.spec.ts

### Task 1: Pin final observability, coverage, formatting, and accessibility dependencies

**Files:**
- Modify: package.json
- Modify: package-lock.json

- [ ] **Step 1: Verify package versions**

Run:

    npm view pino version
    npm view @axe-core/playwright version
    npm view @vitest/coverage-v8 version
    npm view prettier version

Expected: pino 10.3.1, @axe-core/playwright 4.12.1, @vitest/coverage-v8 4.1.10, and prettier 3.9.5.

- [ ] **Step 2: Install exact versions**

Run:

    npm install --save-exact pino@10.3.1
    npm install --save-dev --save-exact @axe-core/playwright@4.12.1 @vitest/coverage-v8@4.1.10 prettier@3.9.5

Expected: package-lock.json pins both versions and npm audit has no unresolved critical advisory.

- [ ] **Step 3: Commit**

Run:

    git add package.json package-lock.json
    git commit -m "build: add observability and accessibility tooling"

### Task 2: Add durable notification reads and invalidation events

**Files:**
- Create through CLI: supabase/migrations/*_notifications_invalidation.sql
- Create: supabase/tests/database/06_notifications_rls.test.sql
- Modify: src/lib/db/bff.ts
- Modify: all Plan 01–05 BFF writer call sites enumerated by tests/contracts/invalidation-writer-callsite.test.ts
- Create: tests/contracts/invalidation-writer-callsite.test.ts

- [ ] **Step 1: Generate the migration through the CLI**

Run:

    npx supabase migration new notifications_invalidation

Expected: one generated timestamped migration ending in _notifications_invalidation.sql.

- [ ] **Step 2: Add the tables and indexes**

The generated migration must create:

    create type public.invalidation_audience as enum ('tenant', 'user', 'platform');

    create table public.notification_reads (
      company_id uuid not null references public.companies(id) on delete restrict,
      user_id uuid not null references auth.users(id) on delete restrict,
      alert_key text not null check (
        char_length(alert_key) between 48 and 96
        and alert_key ~ '^(contract|certificate):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      ),
      read_at timestamptz not null default now(),
      primary key (company_id, user_id, alert_key),
      foreign key (company_id, user_id)
        references public.company_memberships(company_id, user_id) on delete restrict
    );

    create table public.invalidation_events (
      id uuid primary key default gen_random_uuid(),
      dedupe_tx bigint not null default txid_current(),
      audience public.invalidation_audience not null,
      company_id uuid references public.companies(id) on delete restrict,
      target_user_id uuid references auth.users(id) on delete restrict,
      scope text not null check (scope in (
        'dashboard', 'notifications', 'clients', 'catalog', 'proposals', 'contracts',
        'certificates', 'public-certificates', 'finance', 'payments', 'users', 'settings',
        'navigation', 'session', 'storage', 'platform-dashboard', 'platform-companies',
        'platform-admins', 'platform-audit', 'platform-health'
      )),
      committed_at timestamptz not null default now(),
      check (
        (audience = 'tenant' and company_id is not null and target_user_id is null)
        or (audience = 'user' and company_id is null and target_user_id is not null)
        or (audience = 'platform' and company_id is null and target_user_id is null)
      ),
      unique nulls not distinct (dedupe_tx, audience, company_id, target_user_id, scope)
    );

Add indexes on `notification_reads(company_id,user_id)`, `invalidation_events(audience,company_id,committed_at desc,id)`, `invalidation_events(target_user_id,committed_at desc,id)` where audience=user, and `invalidation_events(committed_at)`. The random UUID is the public dedupe identifier; clients order/coalesce by `(committed_at,id)` and can infer no global sequence/gap. `dedupe_tx` exists only to collapse same-scope trigger fan-out in one transaction: revoke its column privilege from every application role and exclude it from the Realtime publication column list, so it never appears in PostgREST or change payloads. Emitters use `INSERT ... ON CONFLICT DO NOTHING`.

Enable pg_cron and schedule a fixed `private.cleanup_invalidation_events()` every 15 minutes; it deletes events older than 24 hours, has empty search_path, accepts no input, is revoked from public/anon/authenticated/service_role/axsys_bff, and is executed only by the database maintenance owner. pgTAP proves the cron job exists and manual unprivileged calls fail.

Create private emit functions as SECURITY DEFINER, fixed-empty-search_path trigger functions owned by the migration owner, with EXECUTE revoked from public, anon, authenticated, service_role, and axsys_bff. They derive actor from auth.uid() or transaction-local app.actor_id set only after a restricted BFF function verifies actor/session/authorization; reject business writes with neither source; validate scopes/audience against a static allowlist; and insert no business payload. Direct calls remain impossible.

Attach explicit AFTER INSERT/UPDATE/DELETE FOR EACH ROW triggers to profiles, platform_roles, companies, company_memberships, member_modules, company_bank_accounts, company_settings, company_settings_drafts, file_objects, file_upload_intents, clients, catalog_items, proposals, proposal_items, contracts, contract_attachments, certificate_types, certificates, certificate_versions, public_certificate_settings, incomes, expenses, payment_requests, payment_certificate_checks, financial_reversals, generated_documents, audit_events, security_events, provisioning_operations, and notification_reads; also attach the safe internal trigger to `private.company_storage_usage`. Use these audience rules:

- ordinary tenant rows emit tenant scopes only for recipients whose active role/module can actually refetch that scope; events contain no entity ID or business payload;
- profile/membership/module/session-impacting changes also emit a `user` event targeted to every affected user, even when that user has just lost membership, so its open tab can clear immediately;
- company/archive/admin/bank/quota-health changes emit platform scopes for active Super Admin tabs, while company status/permission changes also target affected company users;
- audit rows with non-null `company_id` emit no outbox event in v1 because no tenant-audit consumer exists; platform lifecycle/control rows have `company_id is null` and emit only platform-audit. A tenant audit row must never create a platform event or reveal its existence to Super Admin;
- certificate mutations emit certificates/public-certificates/notifications/dashboard; contract mutations emit contracts/notifications/dashboard; finance/payment mutations emit finance/payments/dashboard; permission changes emit users/settings/navigation/session/dashboard; file mutations emit their mapped module plus storage/dashboard.
- `notification_reads` emits only `user` audience targeted to the reader; it never emits tenant/platform events, so colleagues cannot observe read timing or refresh another user's count.
- `profiles` personal/theme changes and `company_settings_drafts` autosave emit only user audience to the affected user/editor; no same-tenant nonrecipient receives them. A separately authorized, committed avatar/settings publication can emit its appropriate tenant/admin scope.
- `payment_requests` in `draft` or terminal `discarded` status emit only user audience to `draft_owner_id`; the transition that submits/formalizes a request emits finance/payments/dashboard tenant scopes. Another financial user in the same tenant never receives draft autosave/discard activity.
- file intent changes emit user-targeted storage to their owner; quota changes emit tenant storage for Company Admin plus redacted platform-health. `dedupe_tx` collapses the file-intent/file-object/quota triggers for the same audience/scope in one commit. Reservation→cancel and final retirement therefore refresh a different device and aggregate platform health even when no file_object row is inserted.

Freeze this exhaustive trigger matrix; old/new-row predicates choose the branch, and every listed scope is independently protected by its receiver rule:

| Source/change | Audience and canonical scopes |
|---|---|
| profiles: theme | affected user only → settings |
| profiles: display/email/avatar | affected user → settings, navigation, storage as applicable; authorized Company Admin → users; if the profile is a platform/admin directory subject, platform → platform-admins |
| profiles: active/forced-password | affected user → session, navigation; tenant Company Admin → users |
| platform_roles | platform → platform-admins, platform-audit; affected user → session, navigation |
| companies/status | platform → platform-companies, platform-dashboard, platform-health; affected company users → session, navigation, dashboard |
| companies identity/contact | platform → platform-companies, platform-dashboard; all active company users → navigation; tenant Company Admin → settings |
| companies timezone | platform → platform-companies; authorized tenant recipients → settings, contracts, certificates, notifications, dashboard, finance, payments because all local-date projections/period grouping may change |
| company_memberships/member_modules | tenant Company Admin → users; affected user → users, session, navigation, dashboard; platform aggregate → platform-companies |
| company_bank_accounts | platform → platform-companies, platform-audit; tenant Company Admin → settings; financial members → payments, finance |
| committed company_settings | Company Admin → settings; administrative members → proposals, contracts; financial members → payments |
| company_settings_drafts | editor user only → settings |
| file_upload_intents | owner user only → storage |
| company_storage_usage | Company Admin → storage; platform → platform-health |
| file_objects avatar/branding | owner or Company Admin → settings, storage; branding also administrative → proposals and financial → payments |
| file_objects contract/certificate/generated | matching module → contracts or certificates/public-certificates/notifications or payments/proposals, plus storage |
| file_objects invoice | while linked payment is draft, draft owner user only → payments, storage; after submission, authorized financial tenant recipients → payments, storage |
| clients | administrative → clients, proposals, contracts; financial → payments |
| catalog_items | administrative → catalog, proposals |
| proposals/proposal_items | administrative → proposals, dashboard |
| contracts/contract_attachments | administrative → contracts, notifications, dashboard, storage; financial → payments |
| certificate_types/certificates/versions | certificates → certificates, public-certificates, notifications, dashboard; financial → payments |
| public_certificate_settings | certificates admins → certificates, public-certificates |
| incomes/expenses | financial → finance, dashboard |
| payment_requests draft/discarded | draft owner user only → payments |
| payment_requests non-draft/checks/reversals | financial → payments, finance, dashboard; related contract selectors → contracts for administrative members |
| generated_documents | proposal kind → proposals; payment kinds → payments; both → storage |
| audit_events | platform rows → platform-audit; tenant rows emit no separate event because v1 has no tenant-audit screen/query root |
| security_events | trusted pre-auth/security writer context → platform-health only; never tenant/user or platform-audit |
| provisioning_operations | platform → platform-health and platform-companies; no tenant audience before commit |
| notification_reads | reader user only → notifications |
| auth_session_controls null→revoked | affected user only → session |

The contract test enumerates every table/branch above and compares the SQL-emitted scopes with each mutation service's committed response plus the central query-root map. Missing or extra mappings fail CI. In particular, bank changes refresh the financial payment selector, clients refresh proposal/contract/payment selectors, and generated document history is never left under an unmapped alias.

Add a separate statement-level `AFTER UPDATE` trigger on `private.auth_session_controls` with `REFERENCING OLD TABLE AS old_sessions NEW TABLE AS new_sessions`; PostgreSQL does not allow an `UPDATE OF` column list together with transition relations. The trigger function joins the transition tables and keeps only rows whose `revoked_at` changed from null to non-null. It emits one deduplicated `user` event with `scope='session'` for each affected user, regardless of whether the user still has an active membership. It uses the transaction-local verified `app.actor_id` when present and, for self/logout or expiry paths only, falls back to the affected user as actor; it never includes session IDs, JWTs, tokens, or revocation reasons. Update logout, admin reset, membership removal, forced-password, deactivate-user, and bulk-revocation call sites to use actor-aware BFF functions. Test two open tabs: both must clear immediately after the first session is revoked.

Each BFF writer from Plans 01–05—including login/logout/session/password/audit boundaries—must set `app.actor_id` after verification when an authenticated actor exists; the emitter validates that context but stores no actor/resource ID (only `target_user_id` when audience=user, as recipient routing). Add a checked-in manifest in `tests/contracts/invalidation-writer-callsite.test.ts` enumerating every function and TypeScript call site; update `src/lib/db/bff.ts` and all listed auth/user/module files in this task. Trigger inserts share the business transaction, so rollback leaves no event. Trigger functions normally reject writes with neither a verified actor nor an explicitly trusted maintenance context.

File cleanup/retirement runs inside its restricted private operation, which creates a row in `private.maintenance_execution_context` keyed by current transaction ID, backend PID and allowlisted operation kind before touching intent/quota rows, then deletes it before returning. DML/EXECUTE on that table/helper is revoked from all application roles; the emitter accepts system maintenance only while that exact same-transaction row exists, never from a caller-supplied actor ID or GUC alone. Tests prove direct axsys_bff/authenticated writes cannot forge the context. For `supabase db reset`, `supabase/seed.sql`, migrations, and pgTAP fixture setup, permit a transaction-local `app.maintenance_mode='seed'` bypass only when `session_user` equals the fixed migration/seed login and `current_user` is independently allowlisted as the expected owner. Never accept `current_user` alone because SECURITY DEFINER changes it to the function owner. The event trigger then skips emission because no client exists yet. No public/authenticated or SECURITY DEFINER wrapper can set/consume that bypass, and pgTAP must prove an authenticated role cannot forge it directly or through a callable function. Seed SQL wraps its idempotent inserts in one transaction, sets the flag locally, and clears it on commit/rollback.

Pre-auth security writers, download completion/stale sweeping, and one-shot platform bootstrap are not seed bypasses because their committed audit/security rows must be accepted. Owner-only functions insert a short-lived row in `private.security_execution_context`, `private.download_execution_context`, or `private.bootstrap_execution_context`. Download context key is exactly `(txid_current(),pg_backend_pid(),operation_kind,attempt_id)` with kind `download_completion|download_stale`, derived only after locking the attempt and consuming its nonce CAS or stale claim; it is valid for the one matching audit row even if an authenticated session was revoked after begin. Other contexts use `(txid,pid,kind)` after validating event or zero-admin Auth user. Emitter accepts only matching same-transaction source; tenant/public download audit creates no outbox, bootstrap/security emit normal platform signals, and context is deleted before return. Revoke all context DML/helper EXECUTE from application roles. pgTAP proves public/authenticated/revoked-session completion, stale/race/exactly-one outcome and no forgery.

- [ ] **Step 3: Enable Realtime and RLS safely**

Remove the Plan 01 base-table subscriptions (`profiles`, `companies`, `company_memberships`, `member_modules`) from `supabase_realtime`, set that publication to insert-only (`publish='insert'`), then add only the safe column list `(id,audience,company_id,target_user_id,scope,committed_at)` of `invalidation_events`. A hostile UPDATE/DELETE/TRUNCATE subscription therefore receives nothing during retention cleanup. Enable/force RLS on both `invalidation_events` and `notification_reads`. A private `STABLE SECURITY DEFINER SET search_path=''` `can_receive_invalidation(company_id,scope)` helper requires an active app session and active membership, then maps administrative/certificates/financial scopes to the matching active module, users/settings/storage administration to Company Admin, and common dashboard/navigation/session scopes to the active member. It is never IMMUTABLE. Revoke from public/anon/service_role/axsys_bff, but grant authenticated the minimum schema USAGE and EXECUTE required for its RLS policy; it returns only a boolean about the caller's own context. pgTAP uses real `SET ROLE authenticated` and exercises membership/module revocation through a prepared statement in the same session. SELECT permits: tenant audience only when same company and that helper authorizes the scope; user audience only when `target_user_id=auth.uid()` (including the final access-revocation signal); platform audience only through `private.has_platform_role()`. INSERT/UPDATE/DELETE are denied.

Start from `REVOKE ALL` on both tables from public, anon, authenticated, service_role, and axsys_bff. Grant authenticated SELECT only on the six safe invalidation columns (never `dedupe_tx`) and SELECT on notification_reads; RLS still limits rows. The notification SELECT policy is exactly own user plus active app session/membership. Grant no read-state DML. Create locked `private.mark_notification_reads(actor,session,alert_keys[])` and `private.mark_all_visible_notifications(actor,session,visible_alert_keys[])` as SECURITY DEFINER/search_path empty, axsys_bff-only. Each accepts at most 200 unique keys and 32 KiB array JSON, rejects duplicate/invalid grammar, asserts session/company, upserts only keys the fresh server service derived for that actor, sets actor context, and writes one aggregate audit with accepted count only. Browser keys are intersected with freshly derived visible set. pgTAP covers limits at 200/201, 32 KiB boundary, revoked/must-change/cross-tenant and grants.

- [ ] **Step 4: Write failing pgTAP tests**

Register distinct active sessions for all pgTAP actors. Test Company A cannot receive Company B tenant events, a removed member receives only its targeted session/navigation event and no tenant event, a member without a module receives none of that module's events, platform sees only platform events, tenant audit emits no outbox event, platform audit never creates a tenant event, a user cannot forge company/audience/scope/maintenance bypass, notification reads are private per user, and anon sees nothing. Specifically, a read by user A creates exactly one user-A event and user B in the same tenant receives zero; profile/theme and settings draft writes target only their owner/editor; payment draft autosave targets only its draft owner, while formalization emits the authorized tenant scope. Include SELECT, INSERT, UPDATE, DELETE and revoked/must-change attempts. Update one row in every trigger table/group, exercise reserve→cancel and retirement/cleanup without file creation, revoke multiple sessions for one user in one statement, call every private BFF writer from Plans 01–05, assert exact deduplicated scopes/audiences and that no payload contains actor/resource/foreign-user IDs, global sequences or hidden columns (a user-target event may contain only its recipient's own routing ID), and prove rollback emits nothing. Assert no duplicate trigger remains from Plan 01 and the insert-only publication contains only the safe invalidation_events column list among application tables. Run a full `npm run db:reset` with the real seed after installing the triggers so the maintenance/bootstrap path is exercised rather than mocked.

- [ ] **Step 5: Run database tests and advisors**

Run:

    npm run db:reset
    npx supabase test db supabase/tests/database/06_notifications_rls.test.sql
    npm run db:advisors
    npm run db:types
    npm run typecheck

Expected: every tenant/operation assertion passes and advisors report no exposed privileged cleanup function.

- [ ] **Step 6: Commit**

Run:

    git add supabase/migrations supabase/tests/database/06_notifications_rls.test.sql src/lib/supabase/database.types.ts src/lib/db/bff.ts src/modules tests/contracts/invalidation-writer-callsite.test.ts
    git commit -m "feat: add audience-scoped invalidation stream"

### Task 3: Derive deadline alerts from real records

**Files:**
- Create: src/modules/notifications/domain/deadline-alerts.ts
- Create: tests/unit/notifications/deadline-alerts.test.ts

- [ ] **Step 1: Write failing fixed-clock tests**

Cover active contract at 46 and 45 days, contract due today, expired contract, closed contract, valid certificate at 6 and 5 days, certificate due today, expired certificate, newer-expired plus older-valid selector parity, UTC/Fortaleza midnight boundaries, and a user lacking the target module. Assert stable keys, severity, labels, destination, and ordering.

- [ ] **Step 2: Run tests**

Run:

    npm run test:unit -- tests/unit/notifications/deadline-alerts.test.ts

Expected: FAIL because buildDeadlineAlerts is absent.

- [ ] **Step 3: Implement pure alert generation**

Export `buildDeadlineAlerts` with inputs contracts, certificateCollections, allowedModules, now, and timeZone. Derive the company-local date once. Contracts alert at 45 days or fewer, certificates at 5 days or fewer, expired is critical, upcoming is warning, and closed contracts are excluded. Each certificate collection carries both `currentValid` from Plan 04's exact selector and `operationalFallback` (latest ready/clean, nonrevoked, nonarchived tuple ignoring validity): use currentValid when present; otherwise an expired fallback produces the critical alert instead of disappearing. Add parity fixtures proving SQL/public/formalization/alerts choose the same current ID. Stable key builders are exact: `contract:${contract.id}:${contract.endsOn}` and `certificate:${selectedVersion.id}:${selectedVersion.validUntil}`; no ordinal/version alternative is allowed, so persisted reads remain stable.

- [ ] **Step 4: Run tests**

Run:

    npm run test:unit -- tests/unit/notifications/deadline-alerts.test.ts

Expected: every boundary and permission case passes.

- [ ] **Step 5: Commit**

Run:

    git add src/modules/notifications/domain tests/unit/notifications/deadline-alerts.test.ts
    git commit -m "feat: derive contract and certificate alerts"

### Task 4: Implement notification and dashboard services

**Files:**
- Create: src/modules/notifications/server/notification-repository.ts
- Create: src/modules/notifications/server/notification-service.ts
- Create: tests/integration/notifications/notification-service.test.ts
- Create: src/modules/notifications/actions/notification-actions.ts
- Create: src/modules/dashboard/server/dashboard-service.ts
- Create: tests/integration/dashboard/dashboard-service.test.ts

- [ ] **Step 1: Write failing notification-service tests**

Cover unread count, mark one, mark all currently visible, stable reads across days, removed alerts, no link without module, tenant scoping, audit of bulk reads only as aggregate, and invalidation after reads.

- [ ] **Step 2: Write failing dashboard-service tests**

Cover module cards, no-module state, real contract/certificate counts, finance totals only with permission, deadline summary, no operational data for Super Admin, query execution in parallel, and the exact next company-local temporal transition around UTC/Fortaleza midnight.

- [ ] **Step 3: Run tests**

Run:

    npm run test:integration -- tests/integration/notifications/notification-service.test.ts tests/integration/dashboard/dashboard-service.test.ts

Expected: FAIL because both services are absent.

- [ ] **Step 4: Implement repositories and services**

Every repository takes AccessContext, requires kind company, and filters by company_id. Notification service rebuilds alerts from fresh source rows, joins notification_reads by stable key, and marks only keys visible to the current user. Dashboard service calls only module-authorized aggregates and returns zero private module data rather than fetching and hiding it. Both return `nextTemporalTransitionAt`, computed with the same company timezone/date helper as contracts and certificates; at minimum it is the next local midnight, when 45-day/5-day thresholds, expiry, current-certificate selection and formalization eligibility may change without a database write.

- [ ] **Step 5: Run tests**

Run:

    npm run test:integration -- tests/integration/notifications/notification-service.test.ts tests/integration/dashboard/dashboard-service.test.ts

Expected: all privacy, permission, aggregate, and read-state tests pass.

- [ ] **Step 6: Commit**

Run:

    git add src/modules/notifications/server src/modules/notifications/actions src/modules/dashboard/server tests/integration/notifications tests/integration/dashboard
    git commit -m "feat: add fresh dashboard and notification services"

### Task 5: Build in-memory Realtime invalidation with secure fallback

**Files:**
- Modify: src/lib/supabase/browser.ts
- Create: src/lib/realtime/invalidation-scopes.ts
- Modify: src/lib/realtime/server-invalidation.ts
- Modify: src/lib/realtime/invalidation-channel.ts
- Create: src/lib/realtime/invalidation-provider.tsx
- Modify: src/lib/query/query-keys.ts
- Modify: src/lib/query/mutation-sync.tsx
- Modify: src/components/providers/scoped-providers.tsx
- Create: tests/unit/realtime/invalidation-provider.test.tsx
- Create: tests/integration/realtime/invalidation-scope-contract.test.ts
- Modify: src/app/api/auth/realtime-token/route.ts
- Modify: src/components/layout/company-shell.tsx

- [ ] **Step 1: Write failing provider tests**

Cover no token persistence, token cleared on unmount/logout, same-tab mutation, the frozen `axsys:invalidation:v1` BroadcastChannel from a second tab, authorized tenant/user/platform Realtime events, forged other-company/target event ignored, membership revocation targeted event, reconnect/focus/online/pageshow refetch, always-on 15-second visible auth watchdog, duplicate event de-duplication, platform context, tenant/user change clearing every query, the scheduled company-local temporal transition, and cleanup of every channel/listener/timer. Assert the four Plan 01 base-table subscriptions are removed rather than duplicated. For representative mutations in every module, feed the same committed scope once as local response, once through BroadcastChannel, and once through Realtime; each path must invalidate exactly the same list/detail/count/dashboard/navigation prefixes and must never call `setQueryData`.

- [ ] **Step 2: Run tests**

Run:

    npm run test:unit -- tests/unit/realtime/invalidation-provider.test.tsx

Expected: FAIL because the provider is absent.

- [ ] **Step 3: Implement the token route**

Modify existing GET `/api/auth/realtime-token`; do not create a second route. It calls getClaims/full AccessContext, accepts only active company/platform, and obtains current access token only for Realtime. Return exactly `{accessToken,refreshAfter}` under no-store/Pragma/Vary; `refreshAfter = min(now+90 seconds, jwtExp-60 seconds)` and reject tokens with under 75 seconds remaining instead of returning an already-due deadline. Never return refresh token. Atomically consume `realtime-token-user` 30/10 minutes and global IP 100/10 minutes; N succeeds/N+1 generic 429 with Retry-After ≤600. Forced-change/revoked/anonymous/inactive fail. Tests freeze response size/keys, rate boundaries and expiry math.

- [ ] **Step 4: Implement the Realtime-only client**

Create one canonical client-safe `InvalidationScope` union whose values exactly equal the database check/allowlist: dashboard, notifications, clients, catalog, proposals, contracts, certificates, public-certificates, finance, payments, users, settings, navigation, session, storage, platform-dashboard, platform-companies, platform-admins, platform-audit, and platform-health. `server-invalidation.ts`, local mutation responses, BroadcastChannel, Realtime, and query mapping all import this type; replace the Plan 01 arbitrary `resources: string[]` contract rather than supporting two vocabularies. A contract test queries PostgreSQL's allowed values and fails if SQL and TypeScript diverge.

In `mutation-sync.tsx`, expose one `applyInvalidationScopes(scopes, context, queryClient, router)` implementation used by all three transports. Freeze a `scope -> query-root prefixes + refresh behavior` table: clients covers client list/detail/count; catalog covers catalog and proposal selectors; proposals covers list/detail/document history; contracts covers list/detail/attachments/payment selectors; certificates/public-certificates cover management/public-settings roots; finance covers finance/incomes/expenses; payments covers requests/documents/contract selectors/finance summary; users/settings/navigation/storage cover their complete user, profile/settings/bank, access/menu, quota/branding/attachment roots; dashboard/notifications and all platform scopes cover their namesake list/detail/count roots. `session` first performs the no-store auth check and clears/redirects on revocation. Query factories from Plans 02–05 must nest every affected list/detail/count beneath one of these roots; no unmapped alias such as company-users, permissions, profile-theme, finance-dashboard, or dynamic `platform-company:${id}` remains.

Extend the existing `getBrowserRealtime()` facade; do not create another Supabase browser client. It retains `persistSession:false`, `autoRefreshToken:false`, `detectSessionInUrl:false` and exposes no database calls. Hold the token in memory, call `realtime.setAuth(token)`, and subscribe with exactly `postgres_changes`, `event:'INSERT'`, `schema:'public'`, `table:'invalidation_events'`. RLS is primary; the callback additionally checks audience against context.companyId/context.userId/platform and discards mismatches. Cleanup DELETE events from pg_cron are neither subscribed nor applied. Event fields are only signals: pass the canonical scope to `applyInvalidationScopes`, never `setQueryData`.

- [ ] **Step 5: Implement BroadcastChannel, token renewal, and fallback refresh**

Successful local mutations publish canonical scopes through the existing frozen `axsys:invalidation:v1` helper only after the server commit. Mount one `InvalidationProvider` inside existing `ScopedProviders`; remove its Plan 01 base-table subscriptions once the outbox tests pass. It refetches visible scopes on focus, online, pageshow and Realtime reconnect. Consume the freshest `nextTemporalTransitionAt` from dashboard/notification responses and keep one in-memory timer; when it fires, invalidate contracts, certificates, notifications, dashboard and payments, then reschedule from the fresh response. If a hidden/throttled tab misses it, visibility/pageshow performs the same invalidation. Fake-clock tests cross UTC/Fortaleza midnight and 45-day/5-day/expiry boundaries without focus, Realtime, mutation or reload.

Schedule an in-memory jittered refresh 5–15 seconds before refreshAfter; fetch no-store, setAuth and resubscribe only if SDK requires. Retry transient failure after 1,2,4,8 then 30 seconds, capped at two minutes/one in-flight request; 401/403 stops immediately and invokes auth watchdog. Never persist token. Every 15 seconds while visible it checks `/api/auth/me`, compares identity/role/modules/profile version, clears/redirects revocation or applies scopes. Close/abort/clear all state on context change/unmount/logout.

- [ ] **Step 6: Run tests**

Run:

    npm run test:unit -- tests/unit/realtime/invalidation-provider.test.tsx
    npm run test:integration -- tests/integration/realtime/invalidation-scope-contract.test.ts

Expected: all freshness, cleanup, token-lifetime, and cross-tenant filtering cases pass. Fake-clock coverage advances beyond the first two-minute deadline and past the original JWT expiry, proving renewal continues without reload and stops after logout/unmount.

- [ ] **Step 7: Commit**

Run:

    git add src/lib/supabase/browser.ts src/lib/realtime src/lib/query src/components/providers/scoped-providers.tsx src/app/api/auth/realtime-token src/components/layout/company-shell.tsx tests/unit/realtime/invalidation-provider.test.tsx tests/integration/realtime/invalidation-scope-contract.test.ts
    git commit -m "feat: synchronize committed tenant updates"

### Task 6: Build the enterprise dashboard and notification center

**Files:**
- Create: src/modules/notifications/components/notification-bell.tsx
- Create: src/modules/notifications/components/notification-sheet.tsx
- Create: src/modules/dashboard/components/enterprise-dashboard.tsx
- Create: src/modules/dashboard/components/module-launcher.tsx
- Create: src/modules/dashboard/components/deadline-panel.tsx
- Modify: src/app/(protected)/app/dashboard/page.tsx
- Modify: src/components/layout/company-shell.tsx
- Create: tests/unit/dashboard/dashboard-components.test.tsx

- [ ] **Step 1: Write failing UI tests**

Cover unread 9+ cap, open marks current alerts, Escape/click-outside/focus return, module-aware links, empty alerts, dashboard no-module state, real metrics, loading skeletons, error retry, dark/light rendering, and mobile full-height notification Sheet.

- [ ] **Step 2: Run tests**

Run:

    npm run test:unit -- tests/unit/dashboard/dashboard-components.test.tsx

Expected: FAIL because the components are absent.

- [ ] **Step 3: Implement the dynamic dashboard page**

page.tsx exports dynamic = 'force-dynamic', calls requireCompanyContext(), loads authorized aggregates through the request-scoped no-store client, and passes server-built view models. It never renders fake cash-flow numbers or fetches forbidden modules.

- [ ] **Step 4: Implement the interface**

Use design dials variance 5, motion 3, density 6. Desktop gets an asymmetric top summary, deadline panel, and module launcher without a generic three-equal-card row. Mobile collapses to one column with 16-pixel gutters. Use Geist/Geist Mono, Phosphor icons, one blue/cyan accent, no outer glow, matched skeletons, explicit empty/error states, 44-pixel targets, and transform/opacity-only motion.

- [ ] **Step 5: Wire notification navigation**

Contract links open /app/administrativo/contratos with a validated contract filter; certificate links open /app/certidoes. Without module access, alerts remain text. Mark-read waits for the server before changing the count and then invalidates notifications only.

- [ ] **Step 6: Run tests and typecheck**

Run:

    npm run test:unit -- tests/unit/dashboard/dashboard-components.test.tsx
    npm run typecheck

Expected: all state, keyboard, permission, and responsive component tests pass.

- [ ] **Step 7: Commit**

Run:

    git add src/modules/notifications/components src/modules/dashboard/components 'src/app/(protected)/app/dashboard' src/components/layout/company-shell.tsx tests/unit/dashboard/dashboard-components.test.tsx
    git commit -m "feat: add operational dashboard and notifications"

### Task 7: Finalize security headers, CSP, and structured observability

**Files:**
- Modify: src/lib/security/csp.ts
- Modify: src/proxy.ts
- Modify: next.config.ts
- Create: src/lib/observability/logger.ts
- Create: src/instrumentation.ts
- Modify: src/components/layout/platform-shell.tsx
- Create: tests/unit/observability/logger.test.ts
- Create: tests/integration/http/security-headers.test.ts

- [ ] **Step 1: Write failing header and log-redaction tests**

Assert CSP has no unsafe-eval, object-src none, base-uri none, frame-ancestors none, explicit connect/img/font sources, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, HSTS outside localhost, and no powered-by header. Log tests must recursively redact password, token, authorization, cookie, CPF, branch/bank account, file bytes, model output, database URLs, JWTs, service keys, signed URLs, exact alternate tokens matching `t_[A-Za-z0-9_-]{43}`, and identifiers in `/public/certidoes/*` or `/api/public/certificates/*` including download segments.

- [ ] **Step 2: Run tests**

Run:

    npm run test:unit -- tests/unit/observability/logger.test.ts
    npm run test:integration -- tests/integration/http/security-headers.test.ts

Expected: FAIL until final policies and redaction exist.

- [ ] **Step 3: Implement CSP and headers**

Generate a per-request nonce in proxy.ts, forward it to Server Components, and configure scripts/styles without broad wildcards. Keep development exceptions local-only and explicit. Route-specific download handlers retain their stricter sandbox/no-store headers.

- [ ] **Step 4: Implement lazy Pino logging and instrumentation**

getLogger() lazily initializes Pino with the single shared recursive bounded redactor from Plan 01 and correlation ID binding. It caps depth, keys, array length, and serialized bytes; detects sensitive keys case-insensitively and sensitive value shapes; and replaces public certificate URLs with fixed route templates before logging. Never log request URL, referrer, or params on those routes. instrumentation.ts registers server hooks without importing secrets into client bundles. Errors expose only stable codes to users and log redacted causes server-side. Production CDN/reverse-proxy access logs must suppress or template the same public route grammars.

- [ ] **Step 5: Verify headers against a running build**

Run:

    npm run build
    START_LOG="$(mktemp -t axsys-next-start.XXXXXX)"
    chmod 600 "$START_LOG"
    npm start > "$START_LOG" 2>&1 &
    APP_PID=$!
    trap 'kill "$APP_PID" 2>/dev/null || true; rm -f "$START_LOG"' EXIT
    READY=0
    for ATTEMPT in $(seq 1 60); do
      kill -0 "$APP_PID" 2>/dev/null || break
      if curl --fail --silent http://localhost:3000/login > /dev/null; then READY=1; break; fi
      sleep 1
    done
    test "$READY" = 1 || { echo "Axsys server failed to become ready; inspect the protected local log manually." >&2; exit 1; }
    curl -I http://localhost:3000/login
    curl -I http://localhost:3000/app/dashboard
    kill "$APP_PID"
    wait "$APP_PID" || true
    rm -f "$START_LOG"

Expected: headers are present, authenticated page redirects safely without a session, and no secret or stack appears.

- [ ] **Step 6: Commit**

Run:

    git add src/lib/security src/lib/observability src/instrumentation.ts src/proxy.ts next.config.ts src/components/layout/platform-shell.tsx tests/unit/observability/logger.test.ts tests/integration/http/security-headers.test.ts
    git commit -m "security: harden headers and redact telemetry"

### Task 8: Document threat model, RLS matrix, and local operation

**Files:**
- Create: docs/security/threat-model.md
- Create: docs/security/rls-matrix.md
- Create: docs/runbooks/local-development.md
- Create: docs/runbooks/production-readiness.md
- Modify: scripts/bootstrap-local.ts
- Create: tests/unit/scripts/bootstrap-local.test.ts
- Modify: README.md
- Modify: package.json

- [ ] **Step 1: Write the threat model**

Document assets, trust boundaries, roles, entry points, RLS/IDOR/XSS/CSRF/SSRF/upload/replay threats, mitigations, residual risks, and security acceptance commands. Include the exact rule that Super Admin has no operational tenant access.

- [ ] **Step 2: Write the RLS matrix**

List every public and storage table against anon, Super Admin, Company Admin, User by each module, and each SELECT/INSERT/UPDATE/DELETE operation. Every cell must say allow with predicate or deny; no blank cells.

- [ ] **Step 3: Harden the existing local Super Admin bootstrap against final triggers**

Modify, do not duplicate, `scripts/bootstrap-local.ts`. Preserve the frozen `AXSYS_BOOTSTRAP_SUPER_ADMIN_EMAIL` and `AXSYS_BOOTSTRAP_SUPER_ADMIN_PASSWORD` names from Plan 01. It validates the password policy, proves the Supabase API and direct PostgreSQL endpoints are loopback/local, and refuses every remote target with no override. It creates the confirmed Auth user, then uses the local migration-owner database connection to invoke a private one-shot bootstrap function whose EXECUTE is revoked from public, anon, authenticated, service_role, and axsys_bff. That function locks the platform role table, requires zero existing platform administrators, verifies the Auth user exists, creates the exact same-transaction `private.bootstrap_execution_context` from Task 2, sets transaction-local `app.actor_id` to that same user, and atomically creates profile, platform role, audit, and normal invalidation rows before consuming/deleting the context. It never trusts a naked GUC or seed bypass. On any database failure the script deletes the just-created Auth user; retries safely detect the compensated state. It prints only the user UUID/email and never the password, database URL, service key, or token. Hosted bootstrap is deliberately out of scope and must use a separately approved operational ceremony.

- [ ] **Step 4: Write local runbook and README**

Move any provisional setup text out of README or `docs/local-development.md` into the canonical `docs/runbooks/local-development.md`; README links there instead of duplicating commands. Document Node requirement, Docker prerequisite, `npm ci`, Supabase init/start/reset/status, ClamAV compose, document-sanitizer image build/self-test/cleanup, environment generation, bootstrap, seed, dev server, Mailpit, Studio, tests, stop commands, and recovery from occupied ports/containers. Explicitly state Docker is currently missing on the workstation and must be installed before Supabase/ClamAV/sanitizer verification. Local setup runs `npm run files:cleanup` and `npm run sanitizer:self-test` before E2E and provides on-demand `npm run files:reconcile`.

- [ ] **Step 5: Write production-readiness runbook**

Require hosted Supabase project link, migrations/advisors, remote RLS tests, secret rotation, MFA for Super Admin, TLS, backups and restore test, retention/privacy approval, subprocessors, malware signature updates, SAST/DAST/dependency scan, independent pentest, and rollback. Define a deployment-neutral maintenance worker schedule: `npm run files:cleanup` every five minutes with overlapping runs made harmless by the database claim lock, and `npm run files:reconcile` once daily; any nonzero reconcile result pages the operator and blocks silent quota correction. Document restricted worker credentials, timeout, retry, log-redaction, alert ownership, and a manual recovery drill. Public deployment is blocked until every checkbox is signed off.

- [ ] **Step 6: Add and verify bootstrap tests and docs commands**

Create `tests/unit/scripts/bootstrap-local.test.ts` with cases for missing environment, weak password, loopback success, any remote target refusal, pre-existing platform admin refusal, compensation after database failure, retry after compensation, trigger-compatible atomic creation, and redacted stdout/stderr. Add the exact package.json script `"docs:check": "prettier --check README.md 'docs/**/*.md'"`.

Run:

    npm run test:unit -- tests/unit/scripts/bootstrap-local.test.ts
    npm run docs:check

Expected: bootstrap redaction/compensation tests pass and every documented local command exists in package.json.

- [ ] **Step 7: Commit**

Run:

    git add docs README.md scripts/bootstrap-local.ts tests/unit/scripts/bootstrap-local.test.ts package.json
    git commit -m "docs: add security and local operations runbooks"

### Task 9: Add the continuous verification pipeline

**Files:**
- Create: .github/workflows/ci.yml
- Modify: package.json
- Modify: vitest.config.ts
- Create: scripts/redact-ci-artifacts.ts
- Create: tests/unit/scripts/redact-ci-artifacts.test.ts
- Create: scripts/scan-secrets.ts
- Create: tests/unit/scripts/scan-secrets.test.ts
- Create: .secrets.baseline.json
- Create: scripts/verify.ts
- Create: tests/unit/scripts/verify.test.ts
- Create: scripts/provision-test-env.ts
- Create: tests/unit/scripts/provision-test-env.test.ts

- [ ] **Step 1: Add deterministic scripts**

Preserve the Plan 01 scripts and add these exact entries to package.json:

    "test:coverage": "vitest run tests/unit --coverage",
    "security:deps": "npm audit --omit=dev --audit-level=high",
    "security:secrets": "tsx scripts/scan-secrets.ts",
    "test:provision": "tsx scripts/provision-test-env.ts",
    "docs:check": "prettier --check README.md 'docs/**/*.md'",
    "verify": "tsx scripts/verify.ts"

`scripts/verify.ts` runs, in this exact order, `security:secrets`, lint, typecheck, coverage, sanitizer:build, sanitizer:self-test, integration, db:lint, db:test, db:advisors, build, E2E, docs and dependency audit. The image therefore exists before payment-document integration. It stops on first failure but always invokes `sanitizer:clean` in `finally`, without hiding the original exit code. A unit test injects the runner and proves order, early stop, cleanup on success/failure and no shell interpolation. Existing test/db/build names remain canonical; do not introduce `test:db`.

- [ ] **Step 2: Create CI with pinned actions**

CI runs on pull requests and main pushes from a clean checkout with full Git history. Its order is exact: `npm ci`; `npx supabase start`; `npm run db:reset`; `npm run db:env`; `npm run test:provision`; `npm run files:start`; `npm run verify`. `test:provision` proves every endpoint loopback, generates strong ephemeral `AXSYS_E2E_*` and bootstrap credentials, writes `.env.test.local` atomically mode 0600, masks values through the runner API before any child process, bootstraps the Super Admin and provisions deterministic two-tenant/module fixtures through normal local boundaries. It never relies on committed seed credentials or prints/writes Git-tracked secrets; rerun replaces the ephemeral file safely. Workflow `if: always()` stops ClamAV/Supabase and sanitizer cleanup. It uploads only sanitized HTML on failure and never raw env/log/trace/video/body/security screenshot/Storage URL. Use these audited pins:

    actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
    actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
    actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1

Set minimal workflow permissions to `contents: read`, pin Node from `.nvmrc`, use `npm ci`, and make artifact upload conditional on failure after running a tested `scripts/redact-ci-artifacts.ts` pass. The redactor rejects rather than uploads when it detects cookies, authorization values, JWT shapes, signed Storage URLs, passwords, CPF/bank patterns, database URLs/keys, exact `t_[A-Za-z0-9_-]{43}` tokens, untemplated `/public/certidoes/*` or `/api/public/certificates/*` identifiers, request bodies, screenshots, traces, or video files; unit fixtures prove allow/deny cases. CI never uploads the raw server-start log.

`tests/unit/scripts/provision-test-env.test.ts` covers empty checkout, db:env ordering, strong unique credentials, GitHub masking before use, 0600 atomic file, remote endpoint refusal, bootstrap/fixture failure cleanup, rerun and redacted stdout/stderr. The workflow test parses YAML and fails if reset is not followed by env+provision before verify.

`scan-secrets.ts` is a versioned blocking repository/history scanner: it enumerates current tracked files plus every reachable Git blob, caps binary/size handling safely, and detects PEM private keys, credentialed database URLs, JWT/service-role claims, Supabase `sb_secret_`, GitHub/AWS/Gemini token forms, sensitive assignments and high-entropy values. `.secrets.baseline.json` is empty by default; any exception requires exact path/blob/finding SHA-256, owner, reason and expiry, rejects wildcard/stale entries, and is itself reviewed. The scanner never prints the matched value—only path/blob, rule and fingerprint prefix. Unit fixtures cover present/current/history secrets, entropy false positives, binary/oversize, redacted output, baseline expiry and exact-fingerprint changes. CI fetches full history (`fetch-depth: 0`) before the blocking scan.

- [ ] **Step 3: Enforce coverage and dependency policy**

Encode in `vitest.config.ts` (not prose-only) 90% statements/branches/functions/lines for domain and security modules and 80% overall. Keep npm audit at production critical/high failure and exact lockfile. Generated types and shadcn primitives may be excluded, business modules may not. Add `tests/unit/scripts/redact-ci-artifacts.test.ts` and make the CI artifact step depend on its passing result.

- [ ] **Step 4: Run the same pipeline locally**

Run:

    npm ci
    npm run verify

Expected: all stages exit 0 on a clean checkout with Docker services available.

- [ ] **Step 5: Commit**

Run:

    git add .github/workflows/ci.yml package.json package-lock.json vitest.config.ts playwright.config.ts scripts/redact-ci-artifacts.ts tests/unit/scripts/redact-ci-artifacts.test.ts scripts/scan-secrets.ts tests/unit/scripts/scan-secrets.test.ts .secrets.baseline.json scripts/verify.ts tests/unit/scripts/verify.test.ts scripts/provision-test-env.ts tests/unit/scripts/provision-test-env.test.ts
    git commit -m "ci: enforce complete Axsys verification"

### Task 10: Execute full acceptance, security, cache, and visual regression

**Files:**
- Create: tests/e2e/dashboard-notifications.spec.ts
- Create: tests/e2e/cache-consistency.spec.ts
- Create: tests/e2e/accessibility-responsive.spec.ts
- Create: tests/e2e/security-regression.spec.ts
- Create: tests/e2e/full-business-flow.spec.ts

- [ ] **Step 1: Write the full business-flow test**

Bootstrap Super Admin, create a company/admin/bank, create a user with modules, configure company identity, create client/catalog/proposal/PDF/contract, upload valid certificates, create/formalize/pay request, verify income/tax/document, and publish/download/revoke a certificate.

- [ ] **Step 2: Write the isolation and IDOR matrix**

Repeat protected reads/mutations/downloads with Company B identifiers across every module, route, RPC, Storage path, generated document, public link, and Realtime event. Assert not-found or access-denied without revealing existence.

- [ ] **Step 3: Write the cache-consistency matrix**

Use two browser contexts and two tabs. After each create/update/archive/permission/payment/publish/revoke operation, assert lists, details, counters, dashboards, alerts, public page, and navigation update without hard reload, logout, or cache clearing. Simulate Realtime disconnect and verify focus/online/watchdog fallback.

- [ ] **Step 4: Write XSS, CSRF, SSRF, upload, and replay regressions**

Submit script/event-handler/javascript-URL strings to every textual document field, invalid Origin and missing CSRF on every mutation, private/loopback URLs to any remote-field surface, MIME/extension/magic-byte mismatches, SVG, EICAR, unsafe XML, duplicate idempotency keys, and concurrent payment requests.

- [ ] **Step 5: Write accessibility and responsive tests**

Run axe on login, both shells, every list/form/dialog, documents, and public certificates in dark/light themes. Test keyboard-only paths, focus restoration, reduced motion, 200% zoom, 390/768/1440 widths, no horizontal overflow, and at least 44-pixel touch controls.

- [ ] **Step 6: Run the full local gate**

Run:

    npm run verify
    npm run db:advisors
    git diff --check

Expected: all tests pass, advisors contain no security finding, no console/page error occurs, visual snapshots are reviewed, and the worktree contains only intended files.

- [ ] **Step 7: Conduct final code review before completion**

Use superpowers:requesting-code-review with emphasis on tenant isolation, privileged SQL, Auth cookies, Storage, document escaping, cache freshness, concurrency, and mobile accessibility. Resolve every P0/P1 finding and rerun npm run verify.

- [ ] **Step 8: Commit**

Run:

    git add tests/e2e
    git commit -m "test: complete Axsys acceptance and security matrix"
