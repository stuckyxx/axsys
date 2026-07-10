# Axsys Administrative Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the tenant-isolated Administrative module for clients, catalog items, proposals with exact decimal totals and real versioned PDFs, and contracts with derived lifecycle, private versioned attachments, and payment-request navigation.

**Architecture:** Keep PostgreSQL as the business source of truth: composite tenant foreign keys, per-operation RLS, transactional proposal numbering, database-confirmed totals, immutable document snapshots, and optimistic versions protect every write. Next.js Server Components load authorized no-store data by default; small client leaves handle forms, filters, resumable uploads, query invalidation, cross-tab synchronization, and conflict comparison. The module reuses the authentication, audit, API-error, CSRF/Origin, query, Realtime, company-settings, and TUS/quarantine services completed in Plans 01 and 02.

**Tech Stack:** Next.js 16.2.10, React 19.2.7, TypeScript, Supabase PostgreSQL/Auth/Storage/Realtime, Zod 4.4.3, React Hook Form 7.81.0, Decimal.js 10.6.0, TanStack Query 5.101.2, @react-pdf/renderer 4.5.1, pdf-lib 1.17.1, file-type 22.0.1, sharp 0.35.3, tus-js-client 4.3.1, customized shadcn/ui, Phosphor Icons 2.1.10, Vitest 4.1.10, pgTAP, and Playwright 1.61.1.

---

## Required baseline from Plans 01 and 02

Do not begin Task 1 until both prior plans pass their complete verification commands. This plan consumes these exact contracts and must not create alternate helpers:

- Auth context and guards: src/modules/auth/domain/access-context.ts and src/modules/auth/server/{get-access-context,guards}.ts. Use requireCompanyContext('administrative') for every page, route handler, service entry point, and server-side document operation.
- Normal company requests use the request-scoped client from src/lib/supabase/server.ts and remain subject to RLS. src/lib/supabase/admin.ts is allowed only inside the already-audited internal file promotion and generated-document writer, never in client, catalog, proposal, or contract CRUD.
- Mutation defenses: src/lib/security/{csrf,origin}.ts. POST, PATCH, and DELETE handlers validate Origin and x-csrf-token before parsing domain input.
- Sensitive responses: src/lib/security/no-store.ts. Every authenticated GET and mutation response must emit Cache-Control: private, no-store, max-age=0 and Vary for the session-bearing headers.
- HTTP failures: src/lib/http/{api-error,error-response,correlation-id}.ts with the envelope { error: { code, message, correlationId, fieldErrors? } }. Return 404 for foreign-tenant IDs, 409 for versions and linked-resource conflicts, 422 for validation, and never expose SQLSTATE, table names, stack traces, or resource existence across tenants.
- Audit: src/modules/audit/server/write-audit-event.ts. Record actor, tenant, resource, result, UTC time, correlation ID, and a redacted reason for every create, update, archive, restore, delete, status transition, close, PDF generation/download, and attachment upload/download.
- Query scope: src/lib/query/{query-keys,mutation-sync}.tsx. Every key starts with ['axsys', userId, companyId, domainName, resourceName]. Successful mutations invalidate all affected lists, details, aggregate cards, dashboard counters, proposal selectors, contract selectors, and notification projections; mutation-sync broadcasts the invalidation to other tabs.
- Realtime: src/lib/realtime/invalidation-channel.ts only signals a no-store refetch. Never copy an event payload into authoritative UI state.
- File model: public.file_objects and public.file_upload_intents plus src/modules/files/domain/{file-types,upload-policy}.ts, src/modules/files/server/{create-upload-intent,finalize-upload-intent,authorize-file-download,clamav-client,image-normalizer,file-repository}.ts, src/modules/files/ui/use-resumable-upload.ts, and the /api/files handlers.
- File purposes are already reserved: profile_avatar, company_letterhead, company_signature, contract_attachment, payment_invoice, certificate, and generated_document. Contract uploads use createUploadIntent({ context, purpose, targetResourceId, declaredName, declaredMime, declaredSize, correlationId }), then finalizeUploadIntent({ context, intentId, correlationId }). Every purpose-specific download authorizer calls Plan 02's owner-only audit-attempt core and returns attemptId/completionNonce with exact metadata only to server code; every route uses the shared audited hash/size-verifying streamer. No Storage URL reaches the browser.
- Company PDF branding comes from public.company_settings: representative_name, representative_role, consolidated_address, letterhead_file_id, and signature_file_id. Read branding bytes through file_objects after checking company_id, purpose, status = ready, and scan_status = clean; never persist a Storage URL in a snapshot.
- Existing SQL authorization helpers are private.has_platform_role(), private.is_active_company_member(uuid), private.has_company_role(uuid, membership_role), and private.has_module(uuid, module_key). RLS expressions wrap stable helpers in SELECT where applicable.
- The route group is src/app/(protected)/app, whose URL remains /app. Server Components are the default; add 'use client' only to interactive leaves.
- npm 11.6.2 and Node 24.13.0 are fixed. Use package-lock.json and npm commands only.

## Migration path rule

Every migration in this plan is created by the CLI. Never type or predict a timestamp. For each migration task, run the named command, capture the path printed by Supabase, and bind that concrete path before editing:

    OUTPUT="$(npx supabase migration new administrative_commercial)"
    printf '%s\n' "$OUTPUT"
    MIGRATION="$(find supabase/migrations -maxdepth 1 -type f -name '*_administrative_commercial.sql' -print | sort | tail -n 1)"
    test -n "$MIGRATION" && test -f "$MIGRATION"
    printf '%s\n' "$MIGRATION"

Expected: the first command prints a timestamped path ending in _administrative_commercial.sql, and the final command prints that same existing file. Repeat with the task-specific suffix. All file lists below refer to the actual path printed by the CLI, not to a manually named file.

## Exact file map

### Database and generated types

- Create through CLI: the generated migration ending in _administrative_commercial.sql
- Create through CLI: the generated migration ending in _administrative_proposals.sql
- Create through CLI: the generated migration ending in _administrative_contracts_documents.sql
- Create through CLI: the generated migration ending in _administrative_rls.sql
- Create: supabase/tests/database/03_administrative_schema.test.sql
- Create: supabase/tests/database/03_administrative_numbering.test.sql
- Create: supabase/tests/database/03_administrative_rls.test.sql
- Create: supabase/tests/database/03_administrative_query_plans.test.sql
- Modify: src/lib/supabase/database.types.ts by running npm run db:types

### Shared package and navigation changes

- Modify: package.json
- Modify: package-lock.json
- Modify: src/components/layout/company-shell.tsx
- Modify: src/lib/query/query-keys.ts
- Create: src/lib/capabilities/product-capabilities.ts
- Modify: src/lib/query/mutation-sync.tsx
- Modify: src/modules/files/domain/upload-policy.ts
- Modify: src/modules/files/server/create-upload-intent.ts
- Modify: src/modules/files/server/finalize-upload-intent.ts
- Modify: src/modules/files/server/authorize-file-download.ts
- Modify: src/lib/db/bff.ts
- Create via CLI: migration with suffix `_contract_upload_authorization.sql`
- Create: tests/contracts/administrative-bff-boundary.test.ts

### Clients and catalog

- Create: src/modules/administrative/domain/cnpj.ts
- Create: src/modules/administrative/schemas/client-input.ts
- Create: src/modules/administrative/schemas/catalog-item-input.ts
- Create: src/modules/administrative/server/client-repository.ts
- Create: src/modules/administrative/server/client-service.ts
- Create: src/modules/administrative/server/catalog-item-repository.ts
- Create: src/modules/administrative/server/catalog-item-service.ts
- Create: src/modules/administrative/ui/client-list-client.tsx
- Create: src/modules/administrative/ui/client-card.tsx
- Create: src/modules/administrative/ui/client-form-sheet.tsx
- Create: src/modules/administrative/ui/client-detail.tsx
- Create: src/modules/administrative/ui/client-filters.tsx
- Create: src/modules/administrative/ui/catalog-list-client.tsx
- Create: src/modules/administrative/ui/catalog-card.tsx
- Create: src/modules/administrative/ui/catalog-form-sheet.tsx
- Create: src/modules/administrative/ui/administrative-screen-states.tsx

### Proposals and documents

- Create: src/lib/money/money.ts
- Create: src/lib/dates/company-local-date.ts
- Create: src/modules/proposals/domain/proposal-status.ts
- Create: src/modules/proposals/schemas/proposal-input.ts
- Create: src/modules/proposals/server/proposal-repository.ts
- Create: src/modules/proposals/server/proposal-service.ts
- Create: src/modules/proposals/server/proposal-snapshot.ts
- Create: src/modules/proposals/ui/proposal-list-client.tsx
- Create: src/modules/proposals/ui/proposal-card.tsx
- Create: src/modules/proposals/ui/proposal-form.tsx
- Create: src/modules/proposals/ui/proposal-items-editor.tsx
- Create: src/modules/proposals/ui/proposal-detail.tsx
- Create: src/modules/proposals/ui/proposal-status-actions.tsx
- Create: src/modules/proposals/ui/proposal-document-history.tsx
- Create: src/modules/documents/server/proposal-pdf-template.tsx
- Create: src/modules/documents/server/proposal-pdf-service.ts
- Create: src/modules/documents/server/generated-document-repository.ts
- Modify: src/lib/db/bff.ts
- Create via CLI: migration with suffix `_proposal_document_writer.sql`

### Contracts and attachments

- Create: src/modules/contracts/domain/contract-lifecycle.ts
- Create: src/modules/contracts/domain/contract-cursor.ts
- Create: src/modules/contracts/schemas/contract-input.ts
- Create: src/modules/contracts/server/contract-repository.ts
- Create: src/modules/contracts/server/contract-service.ts
- Create: src/modules/contracts/server/contract-attachment-service.ts
- Create: src/modules/contracts/ui/contract-list-client.tsx
- Create: src/modules/contracts/ui/contract-card.tsx
- Create: src/modules/contracts/ui/contract-filters.tsx
- Create: src/modules/contracts/ui/contract-form.tsx
- Create: src/modules/contracts/ui/contract-detail.tsx
- Create: src/modules/contracts/ui/contract-attachment-panel.tsx
- Create: src/modules/contracts/ui/contract-payment-shortcuts.tsx

### App routes and BFF

- Create: src/app/(protected)/app/administrativo/clientes/{page,loading,error}.tsx
- Create: src/app/(protected)/app/administrativo/clientes/[clientId]/page.tsx
- Create: src/app/(protected)/app/administrativo/servicos/{page,loading,error}.tsx
- Create: src/app/(protected)/app/administrativo/propostas/{page,loading,error}.tsx
- Create: src/app/(protected)/app/administrativo/propostas/nova/page.tsx
- Create: src/app/(protected)/app/administrativo/propostas/[proposalId]/page.tsx
- Create: src/app/(protected)/app/administrativo/contratos/{page,loading,error}.tsx
- Create: src/app/(protected)/app/administrativo/contratos/novo/page.tsx
- Create: src/app/(protected)/app/administrativo/contratos/[contractId]/page.tsx
- Create: src/app/api/administrative/clients/route.ts
- Create: src/app/api/administrative/clients/[clientId]/route.ts
- Create: src/app/api/administrative/clients/[clientId]/{archive,restore}/route.ts
- Create: src/app/api/administrative/catalog-items/route.ts
- Create: src/app/api/administrative/catalog-items/[itemId]/route.ts
- Create: src/app/api/administrative/catalog-items/[itemId]/{archive,restore}/route.ts
- Create: src/app/api/administrative/proposals/route.ts
- Create: src/app/api/administrative/proposals/[proposalId]/route.ts
- Create: src/app/api/administrative/proposals/[proposalId]/status/route.ts
- Create: src/app/api/administrative/proposals/[proposalId]/documents/route.ts
- Create: src/app/api/administrative/proposals/[proposalId]/documents/[documentId]/download/route.ts
- Create: src/app/api/administrative/contracts/route.ts
- Create: src/app/api/administrative/contracts/[contractId]/route.ts
- Create: src/app/api/administrative/contracts/[contractId]/close/route.ts
- Create: src/app/api/administrative/contracts/[contractId]/attachments/route.ts

### Automated tests

- Create: tests/unit/modules/administrative/{cnpj,client-input,catalog-item-input}.test.ts
- Create: tests/unit/lib/money.test.ts
- Create: tests/unit/lib/company-local-date.test.ts
- Create: tests/unit/modules/proposals/{proposal-status,proposal-input,proposal-snapshot}.test.ts
- Create: tests/unit/modules/contracts/{contract-lifecycle,contract-cursor,contract-input}.test.ts
- Create: tests/unit/modules/documents/proposal-pdf-template.test.tsx
- Create: tests/integration/administrative/{clients,catalog-items,cache-conflicts}.test.ts
- Create: tests/integration/proposals/{proposal-numbering,proposal-routes,proposal-pdf}.test.ts
- Create: tests/integration/contracts/{contract-routes,contract-pagination,contract-attachments}.test.ts
- Create: tests/integration/security/administrative-idor-xss.test.ts
- Create: tests/e2e/administrative-clients-catalog.spec.ts
- Create: tests/e2e/administrative-proposals.spec.ts
- Create: tests/e2e/administrative-contracts.spec.ts
- Create: tests/e2e/administrative-responsive-sync.spec.ts

## Stable domain contracts

Use these names and representations throughout all later tasks:

    export type Money = string;
    export type ProposalStatus = 'draft' | 'sent' | 'approved' | 'rejected';
    export type CatalogItemKind = 'service' | 'product';
    export type ContractStatus = 'closed' | 'expired' | 'expiring' | 'active';

    export type ProposalLineInput =
      | { kind: 'service'; catalogItemId: string; description: string; months: number; monthlyAmount: Money }
      | { kind: 'product'; catalogItemId: string; description: string; quantity: string; unitAmount: Money };

    export type ContractCursor = {
      endsOn: string;
      id: string;
    };

Money crosses browser, BFF, service, PDF snapshot, and tests as a canonical decimal string. Never use binary floating-point multiplication or addition for monetary behavior. Database columns use numeric(14,2); product quantity uses numeric(12,3). Dates cross domain boundaries as ISO date-only strings and are converted to UTC day ordinals only inside contract-lifecycle.ts.

### Task 1: Pin Administrative dependencies and prove the inherited baseline

**Files:**
- Modify: package.json
- Modify: package-lock.json
- Verify: all files listed in Required baseline from Plans 01 and 02

- [ ] **Step 1: Run the inherited verification before changing dependencies**

Run:

    npm run lint
    npm run typecheck
    npm run test:unit
    npm run test:integration
    npm run test:rls
    npm run build

Expected: every command exits 0. If any command fails, repair the corresponding prior-plan work before implementing Administrative code; do not hide or rebaseline a failure in this plan.

- [ ] **Step 2: Install the exact new runtime dependencies**

Run:

    npm install --save-exact decimal.js@10.6.0 @react-pdf/renderer@4.5.1 pdf-lib@1.17.1

Expected: package.json contains exact versions without caret or tilde, package-lock.json changes, and npm reports zero known install errors.

- [ ] **Step 3: Verify the complete relevant dependency graph**

Run:

    npm ls next react zod react-hook-form @hookform/resolvers @tanstack/react-query decimal.js @react-pdf/renderer pdf-lib file-type sharp tus-js-client @phosphor-icons/react

Expected: Next 16.2.10, React 19.2.7, Zod 4.4.3, React Hook Form 7.81.0, resolvers 5.4.0, TanStack Query 5.101.2, Decimal.js 10.6.0, React PDF 4.5.1, pdf-lib 1.17.1, file-type 22.0.1, sharp 0.35.3, tus-js-client 4.3.1, and Phosphor Icons 2.1.10 appear with no invalid or unmet dependency.

- [ ] **Step 4: Commit the dependency boundary**

Run:

    git add package.json package-lock.json
    git commit -m "build: add administrative document dependencies"

Expected: one commit records only package.json and package-lock.json.

### Task 2: Create clients and catalog schema from failing pgTAP tests

**Files:**
- Create: supabase/tests/database/03_administrative_schema.test.sql
- Create through CLI: generated migration ending in _administrative_commercial.sql
- Modify: src/lib/supabase/database.types.ts

- [ ] **Step 1: Write the failing schema contract**

Create supabase/tests/database/03_administrative_schema.test.sql with a transaction, plan(20), and these concrete assertions:

    begin;
    select plan(20);
    select has_table('public', 'clients', 'clients exists');
    select has_table('public', 'catalog_items', 'catalog_items exists');
    select has_column('public', 'clients', 'company_id', 'clients carries tenant');
    select has_column('public', 'clients', 'cnpj_normalized', 'client CNPJ is normalized');
    select has_column('public', 'clients', 'segment', 'client segment exists');
    select has_column('public', 'clients', 'archived_at', 'clients can be archived');
    select has_column('public', 'clients', 'version', 'clients use optimistic version');
    select has_column('public', 'catalog_items', 'item_kind', 'catalog kind exists');
    select has_column('public', 'catalog_items', 'segment', 'catalog segment exists');
    select has_column('public', 'catalog_items', 'archived_at', 'catalog can be archived');
    select col_type_is('public', 'clients', 'company_id', 'uuid', 'client company is uuid');
    select col_type_is('public', 'clients', 'version', 'bigint', 'client version is bigint');
    select col_type_is('public', 'catalog_items', 'version', 'bigint', 'catalog version is bigint');
    select ok(exists (
      select 1 from pg_constraint
      where conname = 'clients_company_cnpj_key'
        and conrelid = 'public.clients'::regclass
    ), 'CNPJ is unique inside a company');
    select ok(exists (
      select 1 from pg_constraint
      where conname = 'clients_company_id_id_key'
        and conrelid = 'public.clients'::regclass
    ), 'client exposes composite tenant key');
    select ok(exists (
      select 1 from pg_constraint
      where conname = 'catalog_items_company_id_id_key'
        and conrelid = 'public.catalog_items'::regclass
    ), 'catalog exposes composite tenant key');
    select has_index('public', 'clients', 'clients_company_search_idx', 'client search is indexed');
    select has_index('public', 'clients', 'clients_company_active_idx', 'active clients are indexed');
    select has_index('public', 'catalog_items', 'catalog_items_company_filter_idx', 'catalog filters are indexed');
    select has_index('public', 'catalog_items', 'catalog_items_active_name_uidx', 'active catalog names are unique');
    select * from finish();
    rollback;

- [ ] **Step 2: Run the schema test and observe the intended red state**

Run:

    npm run db:start
    npm run db:reset
    npx supabase test db supabase/tests/database/03_administrative_schema.test.sql

Expected: FAIL because public.clients and public.catalog_items do not exist.

- [ ] **Step 3: Create the migration with the CLI and capture its real path**

Run:

    npx supabase migration new administrative_commercial
    MIGRATION="$(find supabase/migrations -maxdepth 1 -type f -name '*_administrative_commercial.sql' -print | sort | tail -n 1)"
    test -f "$MIGRATION"

Expected: Supabase creates one timestamped migration and test -f exits 0.

- [ ] **Step 4: Add the client and catalog enums, tables, constraints, and indexes**

Write this complete relational core into the CLI-generated file:

    create type public.catalog_item_kind as enum ('service', 'product');
    create type public.proposal_status as enum ('draft', 'sent', 'approved', 'rejected');

    create table public.clients (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete restrict,
      legal_name text not null check (char_length(btrim(legal_name)) between 2 and 200),
      trade_name text check (trade_name is null or char_length(btrim(trade_name)) between 2 and 200),
      cnpj_normalized text not null check (cnpj_normalized ~ '^[0-9]{14}$'),
      segment text not null check (char_length(btrim(segment)) between 2 and 80),
      email text,
      phone text,
      address_street text,
      address_number text,
      address_complement text,
      address_neighborhood text,
      municipality text not null check (char_length(btrim(municipality)) between 2 and 120),
      state text not null check (state ~ '^[A-Z]{2}$'),
      postal_code text check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
      archived_at timestamptz,
      archived_by uuid references auth.users(id) on delete restrict,
      version bigint not null default 1 check (version > 0),
      created_by uuid not null references auth.users(id) on delete restrict,
      updated_by uuid not null references auth.users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint clients_company_cnpj_key unique (company_id, cnpj_normalized),
      constraint clients_company_id_id_key unique (company_id, id),
      constraint clients_company_id_id_segment_key unique (company_id, id, segment),
      constraint clients_archive_actor_check check (
        (archived_at is null and archived_by is null)
        or (archived_at is not null and archived_by is not null)
      )
    );

    create table public.catalog_items (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete restrict,
      item_kind public.catalog_item_kind not null,
      segment text not null check (char_length(btrim(segment)) between 2 and 80),
      name text not null check (char_length(btrim(name)) between 2 and 160),
      description text not null check (char_length(btrim(description)) between 2 and 2000),
      archived_at timestamptz,
      archived_by uuid references auth.users(id) on delete restrict,
      version bigint not null default 1 check (version > 0),
      created_by uuid not null references auth.users(id) on delete restrict,
      updated_by uuid not null references auth.users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint catalog_items_company_id_id_key unique (company_id, id),
      constraint catalog_items_company_id_id_segment_kind_key
        unique (company_id, id, segment, item_kind),
      constraint catalog_items_archive_actor_check check (
        (archived_at is null and archived_by is null)
        or (archived_at is not null and archived_by is not null)
      )
    );

    create index clients_company_search_idx
      on public.clients (company_id, legal_name, id);
    create index clients_company_trade_name_prefix_idx
      on public.clients (company_id, lower(trade_name) text_pattern_ops, id);
    create index clients_company_legal_name_prefix_idx
      on public.clients (company_id, lower(legal_name) text_pattern_ops, id);
    create index clients_company_active_idx
      on public.clients (company_id, segment, legal_name, id)
      where archived_at is null;
    create index catalog_items_company_filter_idx
      on public.catalog_items (company_id, segment, item_kind, name, id);
    create index catalog_items_company_name_prefix_idx
      on public.catalog_items (company_id, lower(name) text_pattern_ops, id);
    create unique index catalog_items_active_name_uidx
      on public.catalog_items (company_id, segment, item_kind, lower(name))
      where archived_at is null;

    create or replace function private.bump_version_and_updated_at()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
    as $$
    begin
      new.version := old.version + 1;
      new.updated_at := now();
      return new;
    end;
    $$;

    revoke all on function private.bump_version_and_updated_at() from public, anon, authenticated;

    create trigger clients_bump_version
      before update on public.clients
      for each row execute function private.bump_version_and_updated_at();
    create trigger catalog_items_bump_version
      before update on public.catalog_items
      for each row execute function private.bump_version_and_updated_at();

    alter table public.clients enable row level security;
    alter table public.catalog_items enable row level security;

These tables are default-deny immediately. Task 5 adds the operation-specific policies and FORCE posture.

- [ ] **Step 5: Reset, run only the schema contract, and generate types**

Run:

    npm run db:reset
    npx supabase test db supabase/tests/database/03_administrative_schema.test.sql
    npm run db:types

Expected: all 20 pgTAP assertions pass and database.types.ts contains clients, catalog_items, catalog_item_kind, and proposal_status.

- [ ] **Step 6: Commit the first green database slice**

Run:

    git add "$MIGRATION" supabase/tests/database/03_administrative_schema.test.sql src/lib/supabase/database.types.ts
    git commit -m "feat: add client and catalog schema"

Expected: the commit includes the CLI-generated migration path and no manually timestamped migration.

### Task 3: Add proposal items, database totals, and gap-free tenant numbering

**Files:**
- Create through CLI: generated migration ending in _administrative_proposals.sql
- Create: supabase/tests/database/03_administrative_numbering.test.sql
- Modify: src/lib/supabase/database.types.ts

- [ ] **Step 1: Extend the schema test with proposal structure assertions**

Increase the plan in supabase/tests/database/03_administrative_schema.test.sql from 20 to 32 and add assertions for proposals, proposal_items, the company/client/segment composite foreign key, the proposal/catalog/segment/kind composite foreign key, numeric total columns, the unique company proposal number, and indexes proposals_company_status_idx and proposal_items_proposal_idx.

Use catalog queries so constraint names are asserted exactly:

    select has_table('public', 'proposals', 'proposals exists');
    select has_table('public', 'proposal_items', 'proposal_items exists');
    select col_type_is('public', 'proposals', 'total', 'numeric(14,2)', 'proposal total is exact');
    select col_type_is('public', 'proposal_items', 'line_total', 'numeric(14,2)', 'line total is exact');
    select ok(exists (
      select 1 from pg_constraint
      where conname = 'proposals_company_number_key'
        and conrelid = 'public.proposals'::regclass
    ), 'proposal number is tenant unique');

- [ ] **Step 2: Write the failing concurrency and rollback test**

Create supabase/tests/database/03_administrative_numbering.test.sql. Inside one transaction, seed two active companies, administrative users, and distinct registered app sessions with the Plan 01 auth helpers. Invoke the private BFF writer as `axsys_bff`, passing the verified actor/session pair; never create a public or authenticated proposal RPC. Call `private.create_proposal` for Company A twice and Company B once, and assert returned numbers 1, 2, and 1. Then call it with a product line whose quantity is zero inside a pgTAP throws_ok assertion, create another valid Company A proposal, and assert its number is 3 rather than 4.

The valid JSON item is exact:

    jsonb_build_array(jsonb_build_object(
      'catalogItemId', current_setting('test.catalog_item_id')::uuid,
      'kind', 'service',
      'description', 'Assessoria mensal',
      'months', 3,
      'monthlyAmount', '1250.40'
    ))

Assert that its stored line_total is 3751.20 and proposal total is 3751.20.

- [ ] **Step 3: Run both tests and confirm the new assertions fail**

Run:

    npx supabase test db supabase/tests/database/03_administrative_schema.test.sql
    npx supabase test db supabase/tests/database/03_administrative_numbering.test.sql

Expected: FAIL because proposals, proposal_items, and the restricted `private.create_proposal` BFF writer do not exist.

- [ ] **Step 4: Generate the incremental proposal migration**

Run:

    npx supabase migration new administrative_proposals
    PROPOSALS_MIGRATION="$(find supabase/migrations -maxdepth 1 -type f -name '*_administrative_proposals.sql' -print | sort | tail -n 1)"
    test -f "$PROPOSALS_MIGRATION"

Expected: one CLI-generated migration created after the already committed commercial migration; never reopen `_administrative_commercial.sql`.

- [ ] **Step 5: Add proposal tables and exact type-specific checks**

Add this schema to `$PROPOSALS_MIGRATION`:

    create table private.proposal_number_counters (
      company_id uuid primary key references public.companies(id) on delete cascade,
      last_number bigint not null check (last_number > 0)
    );

    revoke all on table private.proposal_number_counters from public, anon, authenticated;

    create table public.proposals (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete restrict,
      client_id uuid not null,
      segment text not null check (char_length(btrim(segment)) between 2 and 80),
      number bigint not null check (number > 0),
      issued_on date not null,
      status public.proposal_status not null default 'draft',
      total numeric(14,2) not null default 0 check (total >= 0),
      sent_at timestamptz,
      version bigint not null default 1 check (version > 0),
      created_by uuid not null references auth.users(id) on delete restrict,
      updated_by uuid not null references auth.users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint proposals_company_number_key unique (company_id, number),
      constraint proposals_company_id_id_key unique (company_id, id),
      constraint proposals_company_id_id_segment_key unique (company_id, id, segment),
      constraint proposals_client_segment_fk foreign key (company_id, client_id, segment)
        references public.clients(company_id, id, segment) on delete restrict,
      constraint proposals_sent_state_check check (
        (status = 'draft' and sent_at is null)
        or (status <> 'draft' and sent_at is not null)
      )
    );

    create table public.proposal_items (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete restrict,
      proposal_id uuid not null,
      segment text not null,
      catalog_item_id uuid not null,
      item_kind public.catalog_item_kind not null,
      position integer not null check (position > 0),
      description_snapshot text not null
        check (char_length(btrim(description_snapshot)) between 2 and 2000),
      months integer,
      monthly_amount numeric(14,2),
      quantity numeric(12,3),
      unit_amount numeric(14,2),
      line_total numeric(14,2) generated always as (
        round(
          case item_kind
            when 'service' then months::numeric * monthly_amount
            when 'product' then quantity * unit_amount
          end,
          2
        )
      ) stored,
      created_at timestamptz not null default now(),
      constraint proposal_items_company_id_id_key unique (company_id, id),
      constraint proposal_items_position_key unique (proposal_id, position),
      constraint proposal_items_proposal_segment_fk
        foreign key (company_id, proposal_id, segment)
        references public.proposals(company_id, id, segment) on delete cascade,
      constraint proposal_items_catalog_segment_kind_fk
        foreign key (company_id, catalog_item_id, segment, item_kind)
        references public.catalog_items(company_id, id, segment, item_kind) on delete restrict,
      constraint proposal_items_kind_values_check check (
        (
          item_kind = 'service'
          and months is not null and months > 0
          and monthly_amount is not null and monthly_amount >= 0
          and quantity is null and unit_amount is null
        )
        or
        (
          item_kind = 'product'
          and quantity is not null and quantity > 0
          and unit_amount is not null and unit_amount >= 0
          and months is null and monthly_amount is null
        )
      )
    );

    create index proposals_company_status_idx
      on public.proposals (company_id, status, issued_on desc, id desc);
    create index proposals_client_idx
      on public.proposals (company_id, client_id, issued_on desc);
    create index proposal_items_proposal_idx
      on public.proposal_items (company_id, proposal_id, position);
    create index proposal_items_catalog_idx
      on public.proposal_items (company_id, catalog_item_id);

    create trigger proposals_bump_version
      before update on public.proposals
      for each row execute function private.bump_version_and_updated_at();

    alter table public.proposals enable row level security;
    alter table public.proposal_items enable row level security;

- [ ] **Step 6: Add transactional number assignment and total confirmation**

Append owner-only helpers with fixed empty search paths. `private.next_proposal_number(company_id)` is callable only by the migration owner and atomically uses `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` on the tenant counter. It performs no authorization itself and is called only after the restricted writer has verified actor, registered active session, membership, module, company/client/catalog relationships, and exact item shape. Revoke it from public, anon, authenticated, service_role, and axsys_bff; do not install a numbering trigger or any public/authenticated creation function.

    create or replace function private.refresh_proposal_total()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
    as $$
    begin
      update public.proposals
      set total = (
        select coalesce(sum(pi.line_total), 0)::numeric(14,2)
        from public.proposal_items pi
        where pi.company_id = coalesce(new.company_id, old.company_id)
          and pi.proposal_id = coalesce(new.proposal_id, old.proposal_id)
      )
      where company_id = coalesce(new.company_id, old.company_id)
        and id = coalesce(new.proposal_id, old.proposal_id);
      return coalesce(new, old);
    end;
    $$;

    revoke all on function private.refresh_proposal_total() from public, anon, authenticated;

    create trigger proposal_items_refresh_total
      after insert or update or delete on public.proposal_items
      for each row execute function private.refresh_proposal_total();

Create `private.create_proposal(p_actor_id uuid, p_session_id uuid, p_client_id uuid, p_segment text, p_issued_on date, p_items jsonb, p_correlation_id uuid)` as SECURITY DEFINER with an empty search path and EXECUTE only for `axsys_bff`. It validates the actor/session through the Plan 01 request-bound helper, derives `company_id` from the active membership (never from request JSON), requires the administrative module, enforces a non-empty bounded JSON array with exact keys/types, locks and verifies the client and every catalog item against the same company/segment/kind, obtains the next tenant number through `private.next_proposal_number`, inserts proposal/items, recomputes totals in PostgreSQL, writes the success audit and canonical invalidation scopes, and returns a typed proposal summary. Any failure rolls back rows, counter, audit, and outbox together. Revoke the function from public, anon, authenticated, and service_role; add source/catalog tests proving no `public.create_proposal` routine and no authenticated mutation grant exists.

- [ ] **Step 7: Add immutable snapshots and legal status transitions**

Add a BEFORE UPDATE trigger on proposals and a BEFORE UPDATE OR DELETE trigger on proposal_items. The proposal trigger permits draft field edits, permits only draft to sent and sent to approved or rejected, sets sent_at on the first sent transition, requires at least one generated proposal document before sent, and blocks company_id, number, client_id, segment, issued_on, or total changes after emission. Because generated_documents is created in Task 4, create the trigger function in Task 4 after that relation exists.

Document the exact transition predicate in a SQL comment and test it later:

    (old.status = 'draft' and new.status in ('draft', 'sent'))
    or (old.status = 'sent' and new.status in ('sent', 'approved', 'rejected'))
    or (old.status = new.status and old.status in ('approved', 'rejected'))

The item trigger raises SQLSTATE 23514 when the parent proposal is not draft. It must not permit direct mutation after emission even when a caller bypasses the UI.

- [ ] **Step 8: Reset and prove numbering, rollback, totals, and schema**

Run:

    npm run db:reset
    npx supabase test db supabase/tests/database/03_administrative_schema.test.sql
    npx supabase test db supabase/tests/database/03_administrative_numbering.test.sql
    npm run db:types

Expected: all 32 schema assertions pass; numbering is 1, 2, 1 across the two tenants; the rejected insert consumes no number; line and proposal totals are 3751.20.

- [ ] **Step 9: Commit the proposal database slice**

Run:

    git add "$PROPOSALS_MIGRATION" supabase/tests/database/03_administrative_schema.test.sql supabase/tests/database/03_administrative_numbering.test.sql src/lib/supabase/database.types.ts
    git commit -m "feat: add transactional proposals and numbering"

Expected: one green commit contains proposal schema, numbering, total triggers, and tests.

### Task 4: Add contracts, attachment history, and the shared generated-document base

**Files:**
- Create through CLI: generated migration ending in _administrative_contracts_documents.sql
- Modify: supabase/tests/database/03_administrative_schema.test.sql
- Modify: src/lib/supabase/database.types.ts

- [ ] **Step 1: Write failing structure and immutability assertions**

Increase the schema test plan to cover these exact requirements:

- contracts has a composite tenant/client foreign key, `contracts_company_id_id_client_key` for the later payment triple FK, numeric(14,2) amount, coherent date check, unique company/number, closure actor/reason check, and bigint version.
- contract_attachments has composite tenant links to contracts and file_objects, attachment_group_id, positive version, partial uniqueness for one current version, and no cascading deletion of file history.
- public.document_kind contains proposal, payment_letter, and payment_process now, so Plan 05 extends the table without recreating the enum.
- generated_documents has company_id, kind, proposal_id, payment_request_id, file_object_id, version, checksum_sha256, immutable_snapshot, template_version, created_by, and created_at.
- a generated document has exactly one parent appropriate to its kind, a proposal document has a composite company/proposal foreign key, and each parent/kind/version is unique.
- generated_documents UPDATE and DELETE raise SQLSTATE 23514.

- [ ] **Step 2: Run the expanded schema test in red**

Run:

    npx supabase test db supabase/tests/database/03_administrative_schema.test.sql

Expected: FAIL because contracts, contract_attachments, document_kind, and generated_documents do not exist.

- [ ] **Step 3: Create the second migration only through the CLI**

Run:

    npx supabase migration new administrative_contracts_documents
    CONTRACTS_MIGRATION="$(find supabase/migrations -maxdepth 1 -type f -name '*_administrative_contracts_documents.sql' -print | sort | tail -n 1)"
    test -f "$CONTRACTS_MIGRATION"

Expected: Supabase prints and creates one timestamped file ending in _administrative_contracts_documents.sql.

- [ ] **Step 4: Add contract and versioned attachment relations**

Write this relational core into the generated migration:

    create table public.contracts (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete restrict,
      client_id uuid not null,
      number text not null check (char_length(btrim(number)) between 1 and 80),
      object text not null check (char_length(btrim(object)) between 3 and 4000),
      starts_on date not null,
      ends_on date not null,
      amount numeric(14,2) not null check (amount >= 0),
      closed_at timestamptz,
      closed_by uuid references auth.users(id) on delete restrict,
      close_reason text,
      version bigint not null default 1 check (version > 0),
      created_by uuid not null references auth.users(id) on delete restrict,
      updated_by uuid not null references auth.users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint contracts_company_number_key unique (company_id, number),
      constraint contracts_company_id_id_key unique (company_id, id),
      constraint contracts_company_id_id_client_key unique (company_id, id, client_id),
      constraint contracts_client_fk foreign key (company_id, client_id)
        references public.clients(company_id, id) on delete restrict,
      constraint contracts_dates_check check (ends_on >= starts_on),
      constraint contracts_closure_check check (
        (closed_at is null and closed_by is null and close_reason is null)
        or (
          closed_at is not null and closed_by is not null
          and char_length(btrim(close_reason)) between 3 and 1000
        )
      )
    );

    create table public.contract_attachments (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete restrict,
      contract_id uuid not null,
      file_object_id uuid not null,
      attachment_group_id uuid not null default gen_random_uuid(),
      version integer not null check (version > 0),
      superseded_at timestamptz,
      superseded_by uuid references auth.users(id) on delete restrict,
      created_by uuid not null references auth.users(id) on delete restrict,
      created_at timestamptz not null default now(),
      constraint contract_attachments_company_id_id_key unique (company_id, id),
      constraint contract_attachments_contract_fk foreign key (company_id, contract_id)
        references public.contracts(company_id, id) on delete restrict,
      constraint contract_attachments_file_fk foreign key (company_id, file_object_id)
        references public.file_objects(company_id, id) on delete restrict,
      constraint contract_attachments_group_version_key
        unique (company_id, contract_id, attachment_group_id, version),
      constraint contract_attachments_file_once_key
        unique (company_id, file_object_id),
      constraint contract_attachments_superseded_actor_check check (
        (superseded_at is null and superseded_by is null)
        or (superseded_at is not null and superseded_by is not null)
      )
    );

    create unique index contract_attachments_one_current_uidx
      on public.contract_attachments(company_id, contract_id, attachment_group_id)
      where superseded_at is null;
    create index contracts_company_ends_cursor_idx
      on public.contracts(company_id, ends_on, id);
    create index contracts_company_client_idx
      on public.contracts(company_id, client_id, ends_on, id);
    create index contracts_company_open_idx
      on public.contracts(company_id, ends_on, id)
      where closed_at is null;
    create index contracts_company_object_prefix_idx
      on public.contracts(company_id, lower(object) text_pattern_ops, id);
    create index contracts_company_number_prefix_idx
      on public.contracts(company_id, lower(number) text_pattern_ops, id);
    create index contract_attachments_contract_idx
      on public.contract_attachments(company_id, contract_id, attachment_group_id, version desc);

    create trigger contracts_bump_version
      before update on public.contracts
      for each row execute function private.bump_version_and_updated_at();

- [ ] **Step 5: Create the reusable generated_documents model now**

Continue in the same migration. payment_request_id intentionally has no foreign key until Plan 05 creates payment_requests; the exactly-one-parent check is already active and permits no orphan document.

    create type public.document_kind as enum (
      'proposal',
      'payment_letter',
      'payment_process'
    );

    create table public.generated_documents (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete restrict,
      kind public.document_kind not null,
      proposal_id uuid,
      payment_request_id uuid,
      file_object_id uuid not null,
      version integer not null check (version > 0),
      checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
      immutable_snapshot jsonb not null
        check (jsonb_typeof(immutable_snapshot) = 'object'),
      template_version text not null
        check (char_length(btrim(template_version)) between 1 and 40),
      created_by uuid not null references auth.users(id) on delete restrict,
      created_at timestamptz not null default now(),
      constraint generated_documents_company_id_id_key unique (company_id, id),
      constraint generated_documents_file_fk foreign key (company_id, file_object_id)
        references public.file_objects(company_id, id) on delete restrict,
      constraint generated_documents_proposal_fk foreign key (company_id, proposal_id)
        references public.proposals(company_id, id) on delete restrict,
      constraint generated_documents_exact_parent_check check (
        (
          kind = 'proposal'
          and proposal_id is not null
          and payment_request_id is null
        )
        or
        (
          kind in ('payment_letter', 'payment_process')
          and proposal_id is null
          and payment_request_id is not null
        )
      ),
      constraint generated_documents_parent_version_key
        unique nulls not distinct (
          company_id, kind, proposal_id, payment_request_id, version
        )
    );

    create index generated_documents_proposal_idx
      on public.generated_documents(company_id, proposal_id, version desc)
      where proposal_id is not null;
    create index generated_documents_payment_idx
      on public.generated_documents(company_id, payment_request_id, kind, version desc)
      where payment_request_id is not null;

    create or replace function private.reject_generated_document_mutation()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
    as $$
    begin
      raise exception using
        errcode = '23514',
        message = 'generated documents are immutable';
    end;
    $$;

    revoke all on function private.reject_generated_document_mutation()
      from public, anon, authenticated;

    create trigger generated_documents_immutable
      before update or delete on public.generated_documents
      for each row execute function private.reject_generated_document_mutation();

    alter table public.contracts enable row level security;
    alter table public.contract_attachments enable row level security;
    alter table public.generated_documents enable row level security;

- [ ] **Step 6: Finish the emitted-proposal and clean-file database guards**

Add three triggers:

1. generated_documents BEFORE INSERT checks file purpose = generated_document, status = ready, scan_status = clean, company equality, and SHA-256 equality. Dispatch by kind: proposal requires proposal_id, locks the proposal row, and assigns max proposal version + 1; payment_letter/payment_process require payment_request_id and, after Plan 05 adds the parent table/FK, lock that payment row and assign the max version for the same payment+kind. The trigger must never dereference or lock proposal_id for a payment document. Until Plan 05 installs the payment branch, payment kinds fail closed with `PAYMENT_DOCUMENT_WRITER_NOT_INSTALLED`.
2. proposals BEFORE UPDATE implements the exact Task 3 transition predicate and rejects draft to sent unless at least one generated_documents proposal row exists.
3. contract_attachments BEFORE INSERT checks file purpose = contract_attachment, status = ready, scan_status = clean, and that the originating file_upload_intents.target_resource_id equals contract_id.

The generated document trigger must reject any caller-supplied version and assign it while the proposal row is locked. The contract attachment trigger is defense in depth; the service transaction in Task 13 also performs these checks.

- [ ] **Step 7: Reset, rerun schema tests, regenerate types, and inspect advisors**

Run:

    npm run db:reset
    npx supabase test db supabase/tests/database/03_administrative_schema.test.sql
    npm run db:types
    npm run db:lint
    npm run db:advisors

Expected: every schema assertion passes; generated_documents rejects UPDATE and DELETE; all new exposed tables already have default-deny RLS; lint and advisors report no warning or exposed security-definer function.

- [ ] **Step 8: Commit the contracts and document foundation**

Run:

    git add "$CONTRACTS_MIGRATION" supabase/tests/database/03_administrative_schema.test.sql src/lib/supabase/database.types.ts
    git commit -m "feat: add contracts attachments and generated documents"

Expected: one commit adds reusable document kinds and table; Plan 05 will add the payment_requests foreign key rather than recreate this model.

### Task 5: Prove tenant isolation, module authorization, and immutable history with RLS

**Files:**
- Create: supabase/tests/database/03_administrative_rls.test.sql
- Create through CLI: generated migration ending in _administrative_rls.sql
- Modify: src/lib/supabase/database.types.ts
- Modify: src/lib/db/bff.ts
- Create: tests/contracts/administrative-bff-boundary.test.ts

- [ ] **Step 1: Write the failing four-profile RLS fixture**

Create supabase/tests/database/03_administrative_rls.test.sql inside a transaction. Reuse the Plan 01 pgTAP auth helpers to seed Company A, Company B, an A member with administrative, an A member without administrative, a B member with administrative, and a platform user. Register a distinct active app session for every actor with `private.register_auth_session` and put that exact session_id in each JWT; also prove revoked and must-change sessions see zero rows. Seed one row per business table as the database owner, then switch to authenticated and set request.jwt.claims for each actor.

The test plan must name every assertion and cover this matrix:

| Actor and operation | clients | catalog_items | proposals/items | contracts | attachments | generated_documents |
|---|---:|---:|---:|---:|---:|---:|
| A administrative SELECT own | allow | allow | allow | allow | allow | allow |
| A administrative INSERT own via Data API | deny; BFF RPC only | deny; BFF RPC only | deny; BFF RPC only | deny; BFF RPC only | deny; BFF RPC only | internal generator only |
| A administrative UPDATE own via Data API | deny; BFF RPC only | deny; BFF RPC only | deny; BFF RPC only | deny; BFF RPC only | deny; BFF RPC only | deny |
| A administrative DELETE own via Data API | deny; BFF RPC only | deny; BFF RPC only | deny; BFF RPC only | deny; BFF RPC only | deny | deny |
| A administrative any B row | deny | deny | deny | deny | deny | deny |
| A without module any row | deny | deny | deny | deny | deny | deny |
| Platform user any tenant row | deny | deny | deny | deny | deny | deny |
| anon any row | deny | deny | deny | deny | deny | deny |

Add explicit malicious checks for changing company_id on direct UPDATE, inserting a proposal with Company B client_id, inserting an item with Company B catalog_item_id, linking a Company B file to Company A contract, attempting to execute the private writer as authenticated/service_role, and invoking the BFF writer with an actor/session whose derived company does not own the client/catalog IDs. Assert that `to_regprocedure('public.create_proposal(...)')` is null.

- [ ] **Step 2: Run the RLS contract in red**

Run:

    npm run db:reset
    npx supabase test db supabase/tests/database/03_administrative_rls.test.sql

Expected: FAIL because the new public tables have no policies and grants.

- [ ] **Step 3: Create the RLS migration through the CLI**

Run:

    npx supabase migration new administrative_rls
    RLS_MIGRATION="$(find supabase/migrations -maxdepth 1 -type f -name '*_administrative_rls.sql' -print | sort | tail -n 1)"
    test -f "$RLS_MIGRATION"

Expected: one CLI-generated timestamped migration exists at the printed path.

- [ ] **Step 4: Enable and force RLS with least-privilege grants**

Add this exact table posture to the generated migration:

    alter table public.clients enable row level security;
    alter table public.clients force row level security;
    alter table public.catalog_items enable row level security;
    alter table public.catalog_items force row level security;
    alter table public.proposals enable row level security;
    alter table public.proposals force row level security;
    alter table public.proposal_items enable row level security;
    alter table public.proposal_items force row level security;
    alter table public.contracts enable row level security;
    alter table public.contracts force row level security;
    alter table public.contract_attachments enable row level security;
    alter table public.contract_attachments force row level security;
    alter table public.generated_documents enable row level security;
    alter table public.generated_documents force row level security;

    revoke all on public.clients, public.catalog_items, public.proposals,
      public.proposal_items, public.contracts, public.contract_attachments,
      public.generated_documents
      from public, anon, authenticated, service_role, axsys_bff;

    grant select on public.clients to authenticated;
    grant select on public.catalog_items to authenticated;
    grant select on public.proposals to authenticated;
    grant select on public.proposal_items to authenticated;
    grant select on public.contracts to authenticated;
    grant select on public.contract_attachments to authenticated;
    grant select (id, company_id, kind, proposal_id, payment_request_id,
      version, template_version, checksum_sha256, created_at)
      on public.generated_documents to authenticated;

There is deliberately no authenticated or service-role INSERT, UPDATE, or DELETE grant on any administrative business table. `generated_documents.file_object_id`, immutable_snapshot and actor/internal columns have no authenticated privilege; download goes through the authorizer. Every mutation uses a checked axsys_bff function; versioned attachments and generated PDFs use their dedicated writers.

- [ ] **Step 5: Add SELECT-only policies and locked business writers**

Use explicit SELECT policies only. The complete client policy is:

    create policy clients_select_administrative
      on public.clients for select to authenticated
      using ((select private.has_module(company_id, 'administrative'::public.module_key)));

Create equivalent SELECT-only policies for catalog_items, proposals, proposal_items, contracts and contract_attachments using the administrative module. For generated_documents, this plan's SELECT policy must require `kind='proposal'`, non-null proposal_id, and the administrative module; it must not expose payment_letter/payment_process rows. Plan 05 adds a separate financial-kind SELECT policy after payment_requests exists. Composite foreign keys remain mandatory defense in depth even after a policy passes.

In the same migration create fixed-empty-search-path SECURITY DEFINER functions with EXECUTE only for axsys_bff: `create_client`, `update_client`, `archive_client`, `restore_client`, `delete_client`, `create_catalog_item`, `update_catalog_item`, `archive_catalog_item`, `restore_catalog_item`, `delete_catalog_item`, `update_draft_proposal`, `delete_draft_proposal`, `save_proposal_items`, `transition_proposal_status`, `create_contract`, `update_contract`, `close_contract`, and `delete_contract`. Task 3's single `private.create_proposal` remains the only proposal creator; do not create a second alias. Each accepts actor+session, derives tenant from the locked target/verified membership, requires the administrative module, sets `app.actor_id` only after authorization, allowlists fields, derives creator/updater/status/company, applies expectedVersion CAS where applicable, enforces historical/delete rules and composite parents, writes exactly one safe success audit row, and returns canonical invalidation scopes in the same transaction. No function accepts trusted company/actor/role/status totals or arbitrary JSON; the proposal-item array is parsed against an exact SQL shape/count/size and totals are recomputed in PostgreSQL. Add typed bffDb methods plus catalog/source tests for every exact signature/grant, absence of aliases/public writers, route usage, and one audit/outbox on success or idempotent replay.

Freeze this normative routine contract. `common` means `(p_actor_id uuid,p_session_id uuid,p_correlation_id uuid)`; every `p_input jsonb` is parsed with exact-key equality into the named Zod/SQL shape and bounded bytes, never merged dynamically. Every mutation returns one JSON object `{ record: <safe persisted DTO|null>, scopes: <frozen text[]> }`; no internal path/actor/security column is in `record`.

| Routine | Arguments after common | Required return/scopes | Audit action |
|---|---|---|---|
| `create_client` | `p_input jsonb(clientCreate)` | client; clients,proposals,contracts,dashboard | client.created |
| `update_client` | `p_client_id uuid,p_expected_version bigint,p_input jsonb(clientUpdateFields)` | client; clients,proposals,contracts,dashboard | client.updated |
| `archive_client` / `restore_client` | `p_client_id uuid,p_expected_version bigint` | client; clients,proposals,contracts,dashboard | client.archived/restored |
| `delete_client` | `p_client_id uuid,p_expected_version bigint` | null; clients,proposals,contracts,dashboard | client.deleted |
| `create_catalog_item` | `p_input jsonb(catalogCreate)` | catalog item; catalog,proposals | catalog.created |
| `update_catalog_item` | `p_item_id uuid,p_expected_version bigint,p_input jsonb(catalogUpdateFields)` | catalog item; catalog,proposals | catalog.updated |
| `archive_catalog_item` / `restore_catalog_item` | `p_item_id uuid,p_expected_version bigint` | catalog item; catalog,proposals | catalog.archived/restored |
| `delete_catalog_item` | `p_item_id uuid,p_expected_version bigint` | null; catalog,proposals | catalog.deleted |
| `create_proposal` | exact Task 3 actor/session/client/segment/date/items/correlation signature | proposal; proposals,dashboard | proposal.created |
| `update_draft_proposal` | `p_proposal_id uuid,p_expected_version bigint,p_input jsonb(proposalHeaderUpdate)` | proposal; proposals,dashboard | proposal.updated |
| `save_proposal_items` | `p_proposal_id uuid,p_expected_version bigint,p_items jsonb` | proposal+items+total; proposals,dashboard | proposal.items_saved |
| `transition_proposal_status` | `p_proposal_id uuid,p_expected_version bigint,p_next_status proposal_status` | proposal; proposals,dashboard | proposal.status_changed |
| `delete_draft_proposal` | `p_proposal_id uuid,p_expected_version bigint` | null; proposals,dashboard | proposal.deleted |
| `create_contract` | `p_input jsonb(contractCreate)` | contract; contracts,notifications,dashboard | contract.created |
| `update_contract` | `p_contract_id uuid,p_expected_version bigint,p_input jsonb(contractUpdateFields)` | contract; contracts,notifications,dashboard,payments | contract.updated |
| `close_contract` | `p_contract_id uuid,p_expected_version bigint,p_reason text` | contract; contracts,notifications,dashboard,payments | contract.closed |
| `delete_contract` | `p_contract_id uuid,p_expected_version bigint` | null; contracts,notifications,dashboard,payments | contract.deleted |

Catalog tests assert exact `to_regprocedure` signatures, SECURITY DEFINER/search_path, owner, `axsys_bff`-only EXECUTE, stable return keys/scopes, action allowlist, and that every typed facade method maps one-to-one. Any signature/return/scope drift fails CI.

- [ ] **Step 6: Add restricted attachment-version execution**

Create `private.version_contract_attachment(actor,session,contract_id,file_id,attachment_group_id,correlation_id)` with SECURITY DEFINER, search_path empty, and explicit active-session/module checks, derived company, exact contract/file company, purpose contract_attachment, ready/clean file, and matching consumed upload-intent target. Lock the contract row first and require `closed_at is null`, then lock the file/claim and current attachment group, mark only the prior version superseded, insert version+1 (or 1), set `app.actor_id`, and audit atomically. A reservation made while open grants no right to link after closure.

Revoke EXECUTE from public, anon, authenticated, and service_role; grant only to axsys_bff and expose a typed method. Do not create any public/Data API wrapper. The private routine repeats every identity, module, tenant, target, purpose, scan, replay and status check.

- [ ] **Step 7: Run RLS, lint, advisors, and the full database suite**

Run:

    npm run db:reset
    npx supabase test db supabase/tests/database/03_administrative_rls.test.sql
    npm run test:rls
    npm run db:lint
    npm run db:advisors
    npm run db:types

Expected: the matrix passes; A sees no B row; users without administrative and platform users see zero operational rows; tenant swaps and cross-tenant FKs fail; immutable tables reject direct mutation; lint and advisors emit no warning.

- [ ] **Step 8: Commit the authorization boundary**

Run:

    git add "$RLS_MIGRATION" supabase/tests/database/03_administrative_rls.test.sql src/lib/supabase/database.types.ts src/lib/db/bff.ts tests/contracts/administrative-bff-boundary.test.ts
    git commit -m "security: enforce administrative tenant isolation"

Expected: one commit contains all per-operation policies, restricted execution, and adversarial pgTAP coverage.

### Task 6: Implement pure validation, Decimal calculations, status, progress, and cursors

**Files:**
- Create: src/modules/administrative/domain/cnpj.ts
- Create: src/modules/administrative/schemas/client-input.ts
- Create: src/modules/administrative/schemas/catalog-item-input.ts
- Create: src/lib/money/money.ts
- Create: src/lib/dates/company-local-date.ts
- Create: src/modules/proposals/domain/proposal-status.ts
- Create: src/modules/proposals/schemas/proposal-input.ts
- Create: src/modules/contracts/domain/contract-lifecycle.ts
- Create: src/modules/contracts/domain/contract-cursor.ts
- Create: src/modules/contracts/schemas/contract-input.ts
- Test: tests/unit/modules/administrative/{cnpj,client-input,catalog-item-input}.test.ts
- Test: tests/unit/lib/money.test.ts
- Test: tests/unit/lib/company-local-date.test.ts
- Test: tests/unit/modules/proposals/{proposal-status,proposal-input}.test.ts
- Test: tests/unit/modules/contracts/{contract-lifecycle,contract-cursor,contract-input}.test.ts

- [ ] **Step 1: Write failing CNPJ and input-schema tests**

Assert that 04.252.011/0001-10 normalizes to 04252011000110 and passes both check digits; 04.252.011/0001-11, repeated digits, non-digits, and 13 or 15 digits fail. Client input must uppercase state, normalize CNPJ/postal code, trim text, reject unknown companyId/createdBy fields, reject version below 1, and require legal name, segment, municipality, and state. Catalog input must be a service or product with trimmed name, description, segment, and positive version on updates.

Run:

    npm run test:unit -- tests/unit/modules/administrative

Expected: FAIL because the domain and schema modules do not exist.

- [ ] **Step 2: Implement CNPJ normalization and check digits**

Use this complete algorithm in cnpj.ts:

    const NON_DIGITS = /\D/g;

    function calculateDigit(base: string, weights: readonly number[]): number {
      const sum = weights.reduce(
        (total, weight, index) => total + Number(base[index]) * weight,
        0,
      );
      const remainder = sum % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    }

    export function normalizeCnpj(value: string): string {
      return value.replace(NON_DIGITS, '');
    }

    export function isValidCnpj(value: string): boolean {
      const digits = normalizeCnpj(value);
      if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
      const first = calculateDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
      const second = calculateDigit(digits.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
      return digits.endsWith(String(first) + String(second));
    }

- [ ] **Step 3: Implement strict Zod schemas**

clientCreateSchema and catalogItemCreateSchema use .strict() so identity, tenant, actor, archive, total, and status fields cannot be injected. Update schemas add version: z.number().int().positive(). Client fields use the SQL limits from Task 2. proposalCreateSchema is a discriminated union by kind and accepts monetary strings matching /^\d{1,12}(\.\d{1,2})?$/; product quantity matches /^\d{1,9}(\.\d{1,3})?$/.

The proposal schema must refine that every selected client and catalog item belongs to the selected segment only after repository lookup; do not trust display data submitted by the form.

- [ ] **Step 4: Write failing Decimal and proposal transition tests**

Cover these exact values:

- service 3 × 1250.40 = 3751.20;
- product 2.555 × 10.015 rounds half-up to 25.59;
- 0.1 + 0.2 represented as line totals equals 0.30, not a binary float artifact;
- negative, NaN, Infinity, exponent notation, and more than allowed input scale reject;
- `999999999999.99` succeeds, `1000000000000.00` rejects, and a multiplication or proposal sum that rounds above `999999999999.99` rejects before SQL;
- draft to sent, sent to approved, and sent to rejected allow;
- draft to approved, approved to sent, and rejected to draft reject.

Run:

    npm run test:unit -- tests/unit/lib/money.test.ts tests/unit/modules/proposals

Expected: FAIL because the shared money module and proposal-status.ts do not exist.

- [ ] **Step 5: Implement canonical Decimal calculations**

Use strings at every boundary in src/lib/money/money.ts:

    import Decimal from 'decimal.js';

    Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

    export const MAX_MONEY = new Decimal('999999999999.99');

    export function toMoney(value: Decimal.Value): string {
      const decimal = new Decimal(value);
      if (!decimal.isFinite() || decimal.isNegative()) {
        throw new Error('INVALID_MONEY');
      }
      const rounded = decimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      if (rounded.greaterThan(MAX_MONEY)) throw new Error('MONEY_OUT_OF_RANGE');
      return rounded.toFixed(2);
    }

    export function calculateServiceTotal(months: number, monthlyAmount: string): string {
      if (!Number.isInteger(months) || months <= 0) throw new Error('INVALID_MONTHS');
      return toMoney(new Decimal(monthlyAmount).times(months));
    }

    export function calculateProductTotal(quantity: string, unitAmount: string): string {
      const parsedQuantity = new Decimal(quantity);
      if (!parsedQuantity.isFinite() || !parsedQuantity.isPositive()) {
        throw new Error('INVALID_QUANTITY');
      }
      return toMoney(parsedQuantity.times(unitAmount));
    }

    export function calculateProposalTotal(lines: readonly string[]): string {
      return toMoney(lines.reduce((sum, value) => sum.plus(value), new Decimal(0)));
    }

The same post-rounding bound is used by contract/payment schemas and every arithmetic helper so TypeScript cannot accept a value PostgreSQL `numeric(14,2)` will reject. Services map `MONEY_OUT_OF_RANGE` to a stable 422 response. `proposal-status.ts` exports `canTransitionProposal(from, to)` from one constant transition map. It does not create a contract on approval.

- [ ] **Step 6: Write failing contract lifecycle and cursor tests**

First freeze `getCompanyLocalDate(timeZone, now)` in `src/lib/dates/company-local-date.ts` using the canonical timezone persisted by Plan 02 and an injected `Date`; it returns strict YYYY-MM-DD and never uses process/session timezone. Unit tests cross both sides of UTC midnight for America/Fortaleza. Inject its result `today = 2026-07-10` and assert:

- closed_at present returns closed regardless of date;
- ends_on 2026-07-09 returns expired;
- ends_on 2026-07-10 and 2026-08-24 return expiring;
- ends_on 2026-08-25 returns active;
- before starts_on progress is 0;
- on ends_on progress is 100;
- a one-day contract is 0 before its date and 100 on its date;
- an early closure freezes progress at the closure calendar day;
- cursor round-trip preserves endsOn and UUID;
- malformed Base64URL, invalid date, extra key, and non-UUID cursor reject.

Run:

    npm run test:unit -- tests/unit/modules/contracts

Expected: FAIL because lifecycle and cursor modules do not exist.

- [ ] **Step 7: Implement date-only lifecycle and typed keyset cursors**

contract-lifecycle.ts must not parse date-only values through local timezone:

    const DAY_MS = 86_400_000;

    function dayOrdinal(value: string): number {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!match) throw new Error('INVALID_DATE_ONLY');
      return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
    }

    export function deriveContractLifecycle(input: {
      startsOn: string;
      endsOn: string;
      today: string;
      closedOn?: string | null;
    }): { status: ContractStatus; progress: number } {
      const start = dayOrdinal(input.startsOn);
      const end = dayOrdinal(input.endsOn);
      const today = dayOrdinal(input.today);
      if (end < start) throw new Error('INVALID_CONTRACT_RANGE');
      const effective = input.closedOn
        ? Math.min(today, dayOrdinal(input.closedOn))
        : today;
      const progress = start === end
        ? (effective < start ? 0 : 100)
        : Math.round(Math.max(0, Math.min(1, (effective - start) / (end - start))) * 100);
      const status: ContractStatus = input.closedOn
        ? 'closed'
        : end < today
          ? 'expired'
          : end <= today + 45
            ? 'expiring'
            : 'active';
      return { status, progress };
    }

contract-cursor.ts uses a strict Zod object and Buffer.from(JSON.stringify(value)).toString('base64url'); decode performs the inverse and converts every parse failure to ApiError code INVALID_CURSOR with status 422.

- [ ] **Step 8: Implement contract schemas and rerun all pure tests**

contractCreateSchema requires clientId UUID, number 1–80 chars, object 3–4000 chars, ISO startsOn/endsOn, Decimal money, and endsOn greater than or equal to startsOn. contractUpdateSchema adds a positive version. closeContractSchema requires positive version and a trimmed 3–1000-character reason. listContractSchema accepts q, clientId, one ContractStatus, cursor, and limit default 25/max 100.

Run:

    npm run test:unit -- tests/unit/lib/money.test.ts tests/unit/modules/administrative tests/unit/modules/proposals tests/unit/modules/contracts

Expected: all validation, Decimal, transition, lifecycle, and cursor tests pass.

- [ ] **Step 9: Commit the pure domain slice**

Run:

    git add src/lib/money src/lib/dates src/modules/administrative/domain src/modules/administrative/schemas src/modules/proposals/domain src/modules/proposals/schemas src/modules/contracts/domain src/modules/contracts/schemas tests/unit/lib/money.test.ts tests/unit/lib/company-local-date.test.ts tests/unit/modules
    git commit -m "feat: add administrative domain rules"

Expected: one commit contains no database or UI code, and every included unit test is green.

### Task 7: Build client CRUD, archive, link guards, and aggregate detail

**Files:**
- Create: src/modules/administrative/server/client-repository.ts
- Create: src/modules/administrative/server/client-service.ts
- Create: src/app/api/administrative/clients/route.ts
- Create: src/app/api/administrative/clients/[clientId]/route.ts
- Create: src/app/api/administrative/clients/[clientId]/{archive,restore}/route.ts
- Test: tests/integration/administrative/clients.test.ts

- [ ] **Step 1: Write failing route and service tests**

Test create, normalized CNPJ uniqueness within one tenant, the same CNPJ in a second tenant, list search by legal name/trade name/CNPJ, active/archived filter, update by expected version, archive, restore, and hard-delete of an unlinked client. Assert a client linked to a proposal or contract returns 409 RESOURCE_IN_USE and remains present. Assert detail returns:

    {
      client,
      aggregates: {
        proposalCount,
        proposalTotal,
        contractCount,
        contractTotal
      },
      recentProposals,
      recentContracts
    }

The detail query must use bounded recent arrays of five and totals represented as money strings.

Run:

    npm run test:integration -- tests/integration/administrative/clients.test.ts

Expected: FAIL because the repository, service, and routes do not exist.

- [ ] **Step 2: Implement explicitly tenant-scoped repository reads**

Every select includes both context.companyId and the resource ID even though RLS also applies:

    const result = await supabase
      .from('clients')
      .select('*')
      .eq('company_id', context.companyId)
      .eq('id', clientId)
      .maybeSingle();

Map no row to NOT_FOUND. `listClients` accepts q, archived, segment, and a 25-row keyset cursor ordered by legal_name then id. Freeze search semantics as case-folded prefix on legal/trade name and normalized digit prefix on CNPJ; it never prepends `%`. Escape `%`, `_`, comma, parentheses, and backslash before constructing the PostgREST OR expression, append only the trailing `%`, and test each metacharacter plus the named prefix indexes.

- [ ] **Step 3: Implement aggregate detail without N+1 queries**

After the authorized client row is found, issue one parallel group for proposal aggregate/recent proposals and contract aggregate/recent contracts. Each query repeats company_id and client_id. Convert every numeric total through Decimal and toFixed(2). Do not fetch child rows one at a time.

Use Promise.all with exactly four bounded queries; return a typed ClientDetailDTO and no Storage or internal audit columns.

- [ ] **Step 4: Implement optimistic writes and linked-delete conflicts**

All client mutations call the exact typed `bffDb` writers created in Task 5. The SQL writer locks the tenant row, compares `expectedVersion`, distinguishes inaccessible from stale without exposing foreign rows, sets actor fields server-side, and in this plan checks only linked proposals/contracts (the relations that exist now). It also catches any SQLSTATE 23503 and maps it to `RESOURCE_IN_USE`, so the Plan 05 payment FK protects deletion without reopening this applied migration. It writes audit/outbox and returns the persisted DTO. Repositories may use RLS-safe `.from(...).select(...)` for reads only; a source test rejects `.insert`, `.update`, `.upsert`, or `.delete` anywhere in Administrative repositories/services/routes. Plan 05 adds an integration case proving a payment-linked client returns 409 via that FK path.

- [ ] **Step 5: Implement all client handlers with BFF defenses**

GET /api/administrative/clients validates query parameters and returns no-store. POST validates Origin and CSRF before body parsing. GET/PATCH/DELETE /[clientId] validate UUID and never accept companyId. Archive and restore accept { version } only. Every handler obtains correlationId, calls requireCompanyContext('administrative'), and emits the standard error envelope. Success audit/outbox is written exclusively by the SQL writer in the business transaction; a handler may emit only redacted denial/security telemetry, never a duplicate success event.

Use status codes 200 for reads/updates/archive/restore, 201 for create, 204 for successful unlinked delete, 404 for inaccessible IDs, 409 for version/link conflicts, and 422 for input failures.

- [ ] **Step 6: Prove no-store, CSRF, IDOR shape, and conflict behavior**

Run:

    npm run test:integration -- tests/integration/administrative/clients.test.ts

Expected: all client tests pass; authenticated responses include private no-store; missing CSRF and foreign Origin mutations reject; a B UUID queried by A returns the same 404 envelope as a random UUID; stale update returns 409 and does not overwrite.

- [ ] **Step 7: Commit client server behavior**

Run:

    git add src/modules/administrative/server/client-repository.ts src/modules/administrative/server/client-service.ts src/app/api/administrative/clients tests/integration/administrative/clients.test.ts
    git commit -m "feat: add secure client management"

Expected: one commit delivers the complete client BFF slice and aggregate detail.

### Task 8: Build responsive client pages and conflict-preserving forms

**Files:**
- Create: src/modules/administrative/ui/{client-list-client,client-card,client-form-sheet,client-detail,client-filters,administrative-screen-states}.tsx
- Create: src/app/(protected)/app/administrativo/clientes/{page,loading,error}.tsx
- Create: src/app/(protected)/app/administrativo/clientes/[clientId]/page.tsx
- Modify: src/components/layout/company-shell.tsx
- Modify: src/lib/query/query-keys.ts
- Test: tests/e2e/administrative-clients-catalog.spec.ts

- [ ] **Step 1: Write the failing client journey**

In Playwright, sign in as an administrative member, create a client, search it without reload, edit it, archive it, show archived, restore it, open aggregate detail, and delete an unlinked second client. In a second browser context update the first client, then submit the stale first-context form; assert 409 opens a comparison panel, keeps every local field value, and shows the refetched server version.

Run:

    npm run test:e2e -- tests/e2e/administrative-clients-catalog.spec.ts

Expected: FAIL because the client routes and components do not exist.

- [ ] **Step 2: Add module navigation and guarded Server Components**

Add Clientes, Serviços, Propostas, and Contratos to company-shell.tsx only when AccessContext.modules contains administrative. Use House, UsersThree, Briefcase, FileText, and Handshake from @phosphor-icons/react as appropriate; icons are aria-hidden and each item has visible text.

Each page exports dynamic = 'force-dynamic', calls requireCompanyContext('administrative'), fetches initial data through its service with no-store semantics, and passes serializable DTOs to a client leaf. A direct URL without the module renders the established access-denied boundary rather than partial data.

- [ ] **Step 3: Implement desktop table and mobile cards**

At 1024 px and above render a semantic table with name, CNPJ, segment, municipality/UF, link counts, state, and actions. Below 640 px render client-card with the same facts in reading order. From 640–1023 px use the card/list form that fits without horizontal scrolling. Do not hide data solely in hover.

All action buttons have a 44 × 44 px minimum target. Status uses text plus ArchiveBox or CheckCircle icon, never color alone.

- [ ] **Step 4: Implement filters and long-form behavior**

Desktop filters remain inline. Mobile filters open a full-height Sheet, and applied q/segment/archive filters appear as individually removable chips. The create/edit Sheet is full-screen on mobile, sectioned into Identity, Contact, and Address, with a sticky action footer; labels, descriptions, and errors use matching id/aria-describedby.

Escape closes only when no submission is running, focus is trapped, and closing returns focus to the triggering button.

- [ ] **Step 5: Implement loading, empty, no-result, error, denied, and unavailable states**

administrative-screen-states.tsx provides distinct components. loading.tsx uses stable skeleton dimensions; an empty tenant offers Criar cliente; a filtered empty result offers Limpar filtros; error.tsx has a safe retry; denied has no mutation control; unavailable displays the correlation ID from the safe envelope.

Success and validation changes use an aria-live polite region. Errors focus the summary and then the first invalid field.

- [ ] **Step 6: Wire scoped query keys and mutation synchronization**

Add exact roots:

    clients: (userId: string, companyId: string) =>
      ['axsys', userId, companyId, 'administrative', 'clients'] as const,
    client: (userId: string, companyId: string, clientId: string) =>
      ['axsys', userId, companyId, 'administrative', 'clients', clientId] as const,

Successful create/update/archive/restore/delete invalidates clients, the affected client, proposals selectors, contracts selectors, and app dashboard counters. mutation-sync broadcasts only invalidation metadata; the receiving tab performs a no-store refetch.

- [ ] **Step 7: Rerun the journey at phone, tablet, and desktop**

Run:

    npm run test:e2e -- tests/e2e/administrative-clients-catalog.spec.ts --project=chromium

Expected: the client journey passes at configured 390 × 844, 768 × 1024, and 1440 × 900 viewports with no horizontal document overflow, trapped focus in sheets, and preserved stale edits.

- [ ] **Step 8: Commit the client UI**

Run:

    git add src/modules/administrative/ui src/app/\(protected\)/app/administrativo/clientes src/components/layout/company-shell.tsx src/lib/query/query-keys.ts tests/e2e/administrative-clients-catalog.spec.ts
    git commit -m "feat: add responsive client experience"

Expected: one commit contains the client UI, route states, navigation, and E2E journey.

### Task 9: Deliver catalog CRUD, archival rules, and proposal-safe links

**Files:**
- Create: src/modules/administrative/server/{catalog-item-repository,catalog-item-service}.ts
- Create: src/modules/administrative/ui/{catalog-list-client,catalog-card,catalog-form-sheet}.tsx
- Create: src/app/api/administrative/catalog-items/route.ts
- Create: src/app/api/administrative/catalog-items/[itemId]/route.ts
- Create: src/app/api/administrative/catalog-items/[itemId]/{archive,restore}/route.ts
- Create: src/app/(protected)/app/administrativo/servicos/{page,loading,error}.tsx
- Modify: tests/integration/administrative/catalog-items.test.ts
- Modify: tests/e2e/administrative-clients-catalog.spec.ts

- [ ] **Step 1: Write failing catalog API tests**

Cover create/list/search/update/archive/restore/delete for service and product, filters by segment/kind/state, active-name uniqueness, same name in another segment, stale version 409, and unknown fields. Create a proposal item snapshot, change the catalog description, and assert the snapshot does not change. Attempt delete of the used catalog item and expect 409 RESOURCE_IN_USE; archive must succeed and existing proposals must still read.

Run:

    npm run test:integration -- tests/integration/administrative/catalog-items.test.ts

Expected: FAIL because catalog server code and handlers do not exist.

- [ ] **Step 2: Implement catalog repository and service**

Repeat explicit company_id scoping and RLS-safe SELECT usage from the client repository. `listCatalogItems` supports q, segment, itemKind, archived, and a name/id keyset cursor. Every create/update/archive/restore/delete delegates to its exact Task 5 `bffDb` writer; uniqueness, expected-version CAS, usage checks, FK conflicts, audit, and invalidation are resolved in that one SQL transaction. Archive keeps the row selectable for historical snapshots but excludes it from new proposal selectors.

- [ ] **Step 3: Implement catalog BFF methods and audit**

GET/POST collection, GET/PATCH/DELETE item, POST archive, and POST restore follow the exact auth/no-store/Origin/CSRF/error sequence from Task 7. The browser cannot submit company_id, created_by, archived_by, or version replacement values. Audit data includes kind and segment but excludes full descriptions.

- [ ] **Step 4: Write the failing responsive catalog journey**

Extend the Playwright spec to create one service and one product, filter by kind and segment, edit each, archive the service, verify it disappears from an active proposal selector, and verify a proposal that already used it retains the snapshot. At phone width the table must become cards and filters a Sheet with active chips.

Expected before UI: FAIL on the missing Serviços screen.

- [ ] **Step 5: Implement the catalog screen**

Use a Server Component for initial no-store data and a client list leaf. Forms show the kind choice with text and icon, segment, name, and description. Desktop uses a table; mobile/tablet use cards. Archive is the primary lifecycle action. Delete appears only in a danger menu and surfaces a linked-proposal conflict without removing the item.

- [ ] **Step 6: Add catalog query keys and cross-domain invalidation**

Add catalog list/detail roots under ['axsys', userId, companyId, 'administrative', 'catalog-items']. A catalog mutation invalidates the list, item, proposal form selectors, and open proposal details that display source metadata. Historical snapshot text remains untouched because it comes from proposal_items.

- [ ] **Step 7: Verify catalog API and UI**

Run:

    npm run test:integration -- tests/integration/administrative/catalog-items.test.ts
    npm run test:e2e -- tests/e2e/administrative-clients-catalog.spec.ts

Expected: all catalog CRUD, archive, link protection, snapshot, responsive, focus, and invalidation assertions pass.

- [ ] **Step 8: Commit the catalog slice**

Run:

    git add src/modules/administrative src/app/api/administrative/catalog-items src/app/\(protected\)/app/administrativo/servicos src/lib/query/query-keys.ts tests/integration/administrative/catalog-items.test.ts tests/e2e/administrative-clients-catalog.spec.ts
    git commit -m "feat: add catalog management and archival"

Expected: one commit delivers both item kinds without allowing history loss.

### Task 10: Implement proposal creation, edits, lists, and legal status handlers

**Files:**
- Create: src/modules/proposals/server/{proposal-repository,proposal-service}.ts
- Create: src/app/api/administrative/proposals/route.ts
- Create: src/app/api/administrative/proposals/[proposalId]/route.ts
- Create: src/app/api/administrative/proposals/[proposalId]/status/route.ts
- Create: tests/integration/proposals/{proposal-numbering,proposal-routes}.test.ts

- [ ] **Step 1: Write the failing concurrent numbering integration test**

Create 20 valid proposals concurrently for Company A and 7 for Company B through the service using independent authenticated clients. Sort numbers and assert A is 1–20, B is 1–7, all IDs are UUIDs, and no duplicate exists. Submit one invalid mixed-segment proposal between two valid calls and assert it rolls back both rows and counter. Test service and product totals against Decimal expected strings and database totals.

Run:

    npm run test:integration -- tests/integration/proposals/proposal-numbering.test.ts

Expected: FAIL because proposal repository and service do not exist.

- [ ] **Step 2: Implement proposal repository transaction boundaries**

Creation calls typed `bffDb.createProposal` once with verified actor/session and domain input; it never accepts `companyId`. Then fetch the created proposal and ordered items through RLS-safe SELECTs scoped by derived company/id. Draft replacement calls only `bffDb.saveProposalItems`, the restricted Task 5 writer that locks the proposal, checks expected version/draft state and same-company catalog references, replaces all items, recomputes the total, and commits audit/outbox in one transaction.

The repository maps numeric values to two-decimal strings and asserts the database total equals calculateProposalTotal. A mismatch raises INTERNAL_TOTAL_MISMATCH, records a security event, and returns 503 without trusting the browser total.

- [ ] **Step 3: Write failing proposal route and transition tests**

Test list by q/client/segment/status/issued range, detail with ordered snapshots, draft update, a stale draft update 409, draft to approved rejection, sent without PDF rejection, and approved/rejected terminal behavior. Test that approving a proposal leaves contract count unchanged.

Run:

    npm run test:integration -- tests/integration/proposals/proposal-routes.test.ts

Expected: FAIL on missing routes and service.

- [ ] **Step 4: Implement proposal list/detail and status services**

Every lookup includes company_id. listProposals uses issued_on/id keyset pagination and returns client name, status, number, total string, and item count. New proposal selectors query only non-archived clients and catalog items matching the selected segment. Detail always reads proposal_items snapshots, never current catalog text.

transitionStatus loads the proposal for presentation, calls only `bffDb.transitionProposalStatus`, and distinguishes NOT_FOUND, VERSION_CONFLICT, DOCUMENT_REQUIRED, and INVALID_STATUS_TRANSITION from the safe result. The SQL writer alone locks/rechecks, writes exactly one audit/outbox in the transaction, and never inserts a contract; the service writes no second success audit.

- [ ] **Step 5: Implement proposal BFF contracts**

GET/POST /proposals, GET/PATCH/DELETE /[proposalId], and POST /status use administrative guard, no-store, correlation ID, safe errors, Origin, and CSRF. DELETE is allowed only for draft proposals with no generated documents; emitted proposals return 409 HISTORICAL_RESOURCE. Status body is exactly { expectedVersion, nextStatus }.

Successful responses include the persisted record and items, not echoed input. Use 201 create, 200 reads/mutations, 204 legal draft delete, 404 inaccessible ID, 409 conflicts, and 422 validation.

- [ ] **Step 6: Verify numbering, totals, snapshots, and transitions**

Run:

    npm run test:integration -- tests/integration/proposals/proposal-numbering.test.ts
    npm run test:integration -- tests/integration/proposals/proposal-routes.test.ts

Expected: both tenants receive independent sequences under concurrency; invalid transactions consume no number; service/product totals match Decimal and SQL; status rules pass; approval creates no contract.

- [ ] **Step 7: Commit proposal application behavior**

Run:

    git add src/modules/proposals/server src/app/api/administrative/proposals tests/integration/proposals
    git commit -m "feat: add proposal workflows and status rules"

Expected: one commit provides proposal server behavior without PDF or UI concerns.

### Task 11: Generate, persist, version, and download real proposal PDFs

**Files:**
- Create: src/modules/proposals/server/proposal-snapshot.ts
- Create: src/modules/documents/server/proposal-pdf-template.tsx
- Create: src/modules/documents/server/proposal-pdf-service.ts
- Create: src/modules/documents/server/generated-document-repository.ts
- Create: src/app/api/administrative/proposals/[proposalId]/documents/route.ts
- Create: src/app/api/administrative/proposals/[proposalId]/documents/[documentId]/download/route.ts
- Test: tests/unit/modules/proposals/proposal-snapshot.test.ts
- Test: tests/unit/modules/documents/proposal-pdf-template.test.tsx
- Test: tests/integration/proposals/proposal-pdf.test.ts

- [ ] **Step 1: Write failing snapshot and PDF security tests**

Build a proposal containing <script>alert(1)</script>, an HTML image handler, a javascript: URL-shaped string, accented Portuguese, and a 2000-character description. Assert the snapshot contains structured plain strings, exact money strings, company legal data, representative, client address, line snapshots, author, template version, and generation time, but no persistent Storage URL. Render and assert bytes start with %PDF-, PDFDocument.load succeeds, page count is positive, and the object graph contains no /JavaScript, /JS, /OpenAction, /Launch, or URI action.

Run:

    npm run test:unit -- tests/unit/modules/proposals/proposal-snapshot.test.ts tests/unit/modules/documents/proposal-pdf-template.test.tsx

Expected: FAIL because snapshot and renderer files do not exist.

- [ ] **Step 2: Implement the immutable snapshot builder**

proposal-snapshot.ts accepts already-authorized rows and returns a deep-frozen, JSON-serializable ProposalDocumentSnapshot. It copies proposal number/status/issued date/total, every proposal_items snapshot, client document/address fields, company legal identity, consolidated address, representative name/role, and SHA-256 identifiers for branding assets. It never copies file paths, signed URLs, tokens, audit internals, or current catalog descriptions.

Validate the completed object through a strict Zod schema before rendering and before persistence.

- [ ] **Step 3: Implement the network-free React PDF template**

proposal-pdf-template.tsx receives only snapshot plus optional in-memory letterhead/signature byte data. Use React PDF Text nodes for all user strings and Image only for validated buffers read from ready/clean branding file_objects. Do not accept a URL prop and do not call fetch. Render a real commercial document with company heading, proposal metadata, client block, item table, exact subtotals/total, representative block, page numbers, and an explicit Sem assinatura cadastrada label when absent.

Use fixed styles, embedded-safe fonts, wrapping, and repeated table headings. Text remains readable when descriptions span pages.

- [ ] **Step 4: Write failing persistence/version tests**

Generate twice and assert two immutable generated_documents rows with versions 1 and 2, distinct random object paths in axsys-private, kind proposal, purpose generated_document, status ready, scan_status clean, matching checksum, immutable snapshots, and template version proposal-v1. Attempt UPDATE/DELETE and expect rejection. Generate as Company A for Company B ID and expect generic 404 with no object created.

Run:

    npm run test:integration -- tests/integration/proposals/proposal-pdf.test.ts

Expected: FAIL because the document service and routes do not exist.

- [ ] **Step 5: Implement the internal generated-document writer**

proposal-pdf-service.ts obtains requireCompanyContext('administrative'), reloads proposal/client/items/settings under RLS, reads branding through file-repository, renders with renderToBuffer, validates with pdf-lib, computes SHA-256, and writes to axsys-private under companyId/generated-documents/randomUUID.pdf. The path contains no submitted filename.

Run `npx supabase migration new proposal_document_writer`, resolve the exact emitted `*_proposal_document_writer.sql` path, and create `private.store_proposal_document(...)` there as a fixed-empty-search_path SECURITY DEFINER function. It verifies actor/session against active tenant membership plus the administrative module, sets transaction-local `app.actor_id` only after that verification, locks the proposal and `private.company_storage_usage`, derives/validates the `${companyId}/generated-documents/${randomUUID}.pdf` prefix, requires `application/pdf`, positive size within the generated-document limit, matching SHA-256, an object-shaped strict snapshot, and template `proposal-v1`; it rejects quota overflow before metadata, increments `used_bytes` by the exact PDF size, then inserts the ready/clean `file_objects` row and immutable `generated_documents` row in one transaction.

In the same migration create `private.authorize_proposal_document_download(actor,session,document_id,correlation_id)`, which joins generated_documents(kind='proposal')→proposal→ready/clean file, derives company, requires the administrative module, calls Plan 02's owner-only `begin_download_audit_core`, and returns exact server metadata plus attemptId/completionNonce. Revoke both functions from public, anon, authenticated, and service_role; grant only to `axsys_bff`, and add typed methods to `src/lib/db/bff.ts`. Never modify a migration that was committed/applied by Task 4.

generated-document-repository.ts uploads/removes the exact object through the server-only Storage admin client, but persists metadata/quota only by calling `private.store_proposal_document` through the restricted BFF connection—never through direct service-role table CRUD. If Storage upload or the atomic database call/quota check fails, delete the promoted object; if cleanup fails, emit the existing redacted cleanup security event so the Plan 02 reconciler finds the uncounted orphan. Tests cover two concurrent PDFs at the quota boundary, exact used-byte increment, rejection without metadata, Storage compensation, and no double decrement. `src/lib/supabase/admin.ts` is confined to exact-path Storage operations in this writer.

- [ ] **Step 6: Implement document routes and status prerequisite**

POST /documents validates Origin/CSRF, generates a new version through its SQL writer (which audits checksum/version without snapshot contents), invalidates proposal detail/document history, and returns 201. GET /documents lists authorized versions no-store. GET /documents/[documentId]/download verifies proposal/document relation through `bffDb.authorizeProposalDocumentDownload`, delegates to the Plan 02 audited streamer, returns a no-store attachment with restrictive Content-Type/Content-Disposition/nosniff/CSP sandbox, and consumes the audit nonce exactly once on completion/abort/failure. Tests prove replay cannot duplicate audit, and financial-only, tenant B and random IDs receive the same 404 with no Storage path/existence leak.

After a document exists, POST /status can transition draft to sent; no document still returns DOCUMENT_REQUIRED.

- [ ] **Step 7: Verify real PDF, XSS resistance, rollback, and versioning**

Run:

    npm run test:unit -- tests/unit/modules/proposals/proposal-snapshot.test.ts tests/unit/modules/documents/proposal-pdf-template.test.tsx
    npm run test:integration -- tests/integration/proposals/proposal-pdf.test.ts

Expected: real PDFs load, malicious text remains inert, no active PDF actions exist, versions are immutable, failed persistence leaves no orphan, cross-tenant generation/download returns 404, and the final streamed response is no-store attachment/nosniff/sandbox with verified hash and size.

- [ ] **Step 8: Commit proposal documents**

Run:

    DOCUMENT_WRITER_MIGRATION="$(find supabase/migrations -type f -name '*_proposal_document_writer.sql' | sort | tail -1)"
    test -n "$DOCUMENT_WRITER_MIGRATION"
    git add "$DOCUMENT_WRITER_MIGRATION" src/modules/proposals/server/proposal-snapshot.ts src/modules/documents src/lib/db/bff.ts src/app/api/administrative/proposals tests/unit/modules/proposals/proposal-snapshot.test.ts tests/unit/modules/documents tests/integration/proposals/proposal-pdf.test.ts
    git commit -m "feat: generate immutable proposal PDFs"

Expected: one commit delivers the complete real-PDF lifecycle.

### Task 12: Build the responsive proposal editor, lifecycle, and document history

**Files:**
- Create: src/modules/proposals/ui/{proposal-list-client,proposal-card,proposal-form,proposal-items-editor,proposal-detail,proposal-status-actions,proposal-document-history}.tsx
- Create: src/app/(protected)/app/administrativo/propostas/{page,loading,error}.tsx
- Create: src/app/(protected)/app/administrativo/propostas/nova/page.tsx
- Create: src/app/(protected)/app/administrativo/propostas/[proposalId]/page.tsx
- Create: tests/e2e/administrative-proposals.spec.ts
- Modify: src/lib/query/query-keys.ts

- [ ] **Step 1: Write the failing proposal-to-PDF journey**

Create service and product catalog items in one segment, select a client, assert segment filters both selectors, add both item kinds, verify live Decimal preview and persisted total, save draft, generate/download a real PDF, send, approve, and assert no contract was auto-created. Verify emitted item text survives catalog edits. Exercise an invalid transition and a stale edit conflict.

Run:

    npm run test:e2e -- tests/e2e/administrative-proposals.spec.ts

Expected: FAIL because proposal pages do not exist.

- [ ] **Step 2: Implement guarded Server Components and scoped keys**

Pages are dynamic/no-store and guarded by administrative. Add proposal list/detail/document query keys under the user/company prefix. List filters include q, client, segment, status, issue dates, and cursor. Mutations invalidate proposals, proposal detail, client aggregate, dashboard counters, and document history; cross-tab receivers refetch.

- [ ] **Step 3: Implement the type-safe item editor**

Use useFieldArray with a discriminated kind. Service rows expose months/monthly amount only; product rows expose quantity/unit amount only. Changing segment clears incompatible client/catalog selections after confirmation. Calculations import src/lib/money/money.ts and show a preview, but the success view replaces it with the database-confirmed total.

All removed rows are announced, errors associate with the precise row, and keyboard users can add/reorder/remove without drag-only interaction.

- [ ] **Step 4: Implement lifecycle and document UI**

Draft shows Editar, Gerar PDF, and Excluir. A document enables Enviar. Sent shows Aprovar and Rejeitar. Terminal states show no edit action. Status badges combine text, icon, and color. Document history shows version, checksum prefix, author, time, and download; generating again adds a row without replacing earlier versions.

- [ ] **Step 5: Implement responsive layouts and states**

Desktop uses table/detail columns; mobile uses cards and a full-screen form with sticky total/action footer; tablet uses a single readable column. Long item descriptions wrap without horizontal scrolling. Define loading, empty, no-result, error, denied, conflict, and temporary PDF failure states with safe retry.

- [ ] **Step 6: Verify the full proposal journey at all breakpoints**

Run:

    npm run test:e2e -- tests/e2e/administrative-proposals.spec.ts

Expected: the service/product math, segment filtering, snapshots, statuses, PDF download/history, conflict preservation, keyboard controls, and three responsive viewports pass.

- [ ] **Step 7: Commit proposal UI**

Run:

    git add src/modules/proposals/ui src/app/\(protected\)/app/administrativo/propostas src/lib/query/query-keys.ts tests/e2e/administrative-proposals.spec.ts
    git commit -m "feat: add proposal editor lifecycle and PDF UI"

Expected: one commit completes the user-visible proposal workflow.

### Task 13: Implement contract CRUD, lifecycle filters, cursor pagination, and explicit closure

**Files:**
- Create: src/modules/contracts/server/{contract-repository,contract-service}.ts
- Create: src/app/api/administrative/contracts/route.ts
- Create: src/app/api/administrative/contracts/[contractId]/route.ts
- Create: src/app/api/administrative/contracts/[contractId]/close/route.ts
- Test: tests/integration/contracts/{contract-routes,contract-pagination}.test.ts

- [ ] **Step 1: Write failing validation and lifecycle route tests**

Test required client/number/object/dates/amount, end before start, duplicate number per tenant, same number across tenants, update/version conflict, delete unlinked, and explicit close with actor/reason/audit. Assert closed cannot reopen or edit protected fields. Seed today = 2026-07-10 and verify closed, expired, expiring inclusive through 2026-08-24, and active from 2026-08-25.

Run:

    npm run test:integration -- tests/integration/contracts/contract-routes.test.ts

Expected: FAIL because contract server code and routes do not exist.

- [ ] **Step 2: Write failing stable-pagination tests**

Seed 63 contracts with duplicate ends_on values. Traverse with limit 25 using encoded { endsOn, id } cursors; assert pages 25/25/13, no duplicate/omission, deterministic order, malformed cursor 422, and tenant-filtered client/status/q results. Insert a row behind the cursor between pages and assert already-returned rows do not shift.

Run:

    npm run test:integration -- tests/integration/contracts/contract-pagination.test.ts

Expected: FAIL on missing repository pagination.

- [ ] **Step 3: Implement parameterized filters and keyset access**

The service reads the company's canonical timezone under the same authorized request, calls `getCompanyLocalDate(timezone, injectedClock.now())` exactly once, and passes that immutable `today` to every lifecycle/filter/DTO calculation in the request. Repository queries company_id plus predicates from that value; never use browser date, Node local timezone, SQL session `current_date`, or a second clock read:

- closed: closed_at is not null;
- expired: closed_at is null and ends_on < today;
- expiring: closed_at is null and ends_on between today and today + 45 days inclusive;
- active: closed_at is null and ends_on > today + 45 days.

Order by ends_on then id and request limit + 1. `q` is normalized/escaped prefix search across contract number/object plus an authorized client-name prefix lookup; never prepend `%` or concatenate SQL. Use the two prefix indexes already created before Task 4's migration commit and assert them in the performance gate; never modify that migration here. Return nextCursor only when an extra row exists.

- [ ] **Step 4: Implement writes, close, and linked deletion**

All mutations call exactly `bffDb.createContract`, `updateContract`, `closeContract`, or `deleteContract`; a source test rejects direct `.insert/.update/.delete`. The SQL writer derives company/actors, locks and applies expected-version CAS, and commits its one audit/outbox. Close sets closed_at/by/reason once; reopening is absent from BFF and rejected in SQL. Delete checks attachments and later payment FK restrictions, maps 23503 to RESOURCE_IN_USE, and never deletes a closed/history-bearing contract.

- [ ] **Step 5: Implement no-store contract handlers**

GET/POST collection, GET/PATCH/DELETE item, and POST close follow guard, correlation, Origin/CSRF, strict schemas, no-store, safe errors, and persisted response rules. GET accepts q/status/clientId/cursor/limit only. Status/progress are derived in DTOs with contract-lifecycle.ts and never persisted as stale columns.

- [ ] **Step 6: Verify CRUD, boundaries, pagination, and audit**

Run:

    npm run test:integration -- tests/integration/contracts/contract-routes.test.ts
    npm run test:integration -- tests/integration/contracts/contract-pagination.test.ts

Expected: lifecycle boundaries, progress, validation, optimistic conflicts, explicit closure, link guards, and stable 25-row keyset pages pass.

- [ ] **Step 7: Commit contract application behavior**

Run:

    git add src/modules/contracts/server src/app/api/administrative/contracts tests/integration/contracts
    git commit -m "feat: add contract lifecycle and pagination"

Expected: one commit contains contract server behavior without upload/UI coupling.

### Task 14: Extend the shared secure upload for private versioned contract attachments

**Files:**
- Modify: src/modules/files/domain/upload-policy.ts
- Modify: src/modules/files/server/create-upload-intent.ts
- Modify: src/modules/files/server/authorize-file-download.ts
- Create: src/modules/contracts/server/contract-attachment-service.ts
- Create: src/app/api/administrative/contracts/[contractId]/attachments/route.ts
- Create: tests/integration/contracts/contract-attachments.test.ts

- [ ] **Step 1: Write failing file-policy tests**

Extend the Plan 02 upload-policy tests for contract_attachment. Accept PDF, legacy DOC with OLE WordDocument stream, DOCX, JPEG, and PNG up to 20 MiB. Reject 20 MiB + 1 byte, extension/MIME/magic mismatch, SVG, HTML, executable, renamed ZIP, DOC-shaped non-Word CFB, polyglot fixture, EICAR fixture, traversal filename, and embedded NUL. Images must be reencoded by sharp and stripped of metadata.

Call the frozen API:

    validateFile({ purpose, originalName, declaredMime, bytes })

Expected result contains detectedMime, normalized extension, byteSize, and SHA-256.

- [ ] **Step 2: Run file and attachment tests in red**

Run:

    npm run db:reset
    npm run db:test
    npm run db:types
    npm run test:unit -- tests/unit/files
    npm run test:integration -- tests/integration/contracts/contract-attachments.test.ts

Expected: contract_attachment policy/authorization/version behavior fails.

- [ ] **Step 3: Add only the purpose-specific policy**

Do not recreate file_objects, intents, buckets, global limits, TUS, or scanner. Extend getUploadPolicy(contract_attachment) with the exact allowlist and existing 20 MiB database limit. Set transform=`reencode-image` for JPEG/PNG and transform=`preserve-validated-bytes` for PDF/DOC/DOCX. Normalize detected CFB to application/msword only after the WordDocument stream marker is present. DOCX requires the detected Office Open XML Word type. Extend `finalize-upload-intent.ts` so non-image formats never pass through sharp and keep their validated extension/MIME; reuse ClamAV, quota conversion, compensation and final-byte scan from Plan 02.

- [ ] **Step 4: Authorize intent target and final link**

Run `npx supabase migration new contract_upload_authorization` and use only the emitted path. Create `private.reserve_contract_attachment_upload(actor,session,contract_id,declared_name,declared_mime,declared_size,correlation_id)` and `private.authorize_contract_attachment_download(actor,session,file_id,correlation_id)`, fixed-empty-search_path, EXECUTE only for axsys_bff. Reservation revalidates app session, administrative module, same-tenant active contract and policy/size, then calls the single Plan 02 `reserve_upload_capability_core` so path, `2 * declared_size` hold, quota lock, three/100-MiB per-user caps and status reserved cannot diverge. The generic activation function performs reserved→issued and fixes the shared two-hour signed-authorization plus 24h15m TUS cleanup-grace deadlines; no direct authenticated INSERT exists. The download function joins file→attachment→contract, rechecks tenant/module plus ready/clean, calls the owner-only download-audit core, and returns exact metadata plus attemptId/nonce only server-side. Add typed bffDb methods.

create-upload-intent.ts dispatches contract_attachment only to that reservation method. A foreign/random contract receives the same 404. After TUS finalize returns a ready/clean FileObject, contract-attachment-service calls only `bffDb.versionContractAttachment(actor,session,contractId,fileObjectId,attachmentGroupId,correlationId)` from Task 5; it sends no companyId. The database locks/reverifies matching intent target, purpose, scan, status, tenant, replay/group CAS, audit, and outbox atomically.

- [ ] **Step 5: Implement version and download behavior**

POST /attachments body is { fileObjectId, attachmentGroupId? }, validates CSRF/Origin, and returns the persisted attachment version. Uploading a replacement marks only the prior current row superseded and creates version + 1; history remains readable. authorize-file-download.ts handles contract_attachment only through `bffDb.authorizeContractAttachmentDownload` before invoking the shared audited streamer; completion/abort/failure consumes the attempt nonce exactly once. It does not depend on Plan 02's image-only file_objects SELECT policy and exposes no Storage URL.

The original filename is used only in sanitized Content-Disposition. Storage path remains random and bucket-private.

- [ ] **Step 6: Test quarantine, malware, version race, and IDOR**

Assert pending/infected/failed uploads create no attachment; promotion failure removes any copied object; two concurrent replacements serialize to distinct consecutive versions with one current row; replay/concurrent linking of the same fileObjectId into the same or another group creates exactly one row; reserve/finalize while open then close-before-link is rejected with no attachment; close-vs-link row locks yield one legal serialized outcome; A cannot create intent/link/download B; a manipulated path or fileId returns 404; expired intent/token rejects; no service key/JWT reaches TUS browser headers.

Run:

    npm run db:reset
    npm run db:test
    npm run db:types
    npm run test:unit -- tests/unit/files
    npm run test:integration -- tests/integration/contracts/contract-attachments.test.ts

Expected: policy, quarantine, scan, compensation, concurrent version, private download, and tenant isolation tests pass.

- [ ] **Step 7: Commit secure attachments**

Run:

    CONTRACT_UPLOAD_MIGRATION="$(find supabase/migrations -type f -name '*_contract_upload_authorization.sql' | sort | tail -1)"
    test -n "$CONTRACT_UPLOAD_MIGRATION"
    git add "$CONTRACT_UPLOAD_MIGRATION" src/lib/db/bff.ts src/lib/supabase/database.types.ts src/modules/files src/modules/contracts/server/contract-attachment-service.ts src/app/api/administrative/contracts tests/unit/files tests/integration/contracts/contract-attachments.test.ts
    git commit -m "feat: add private versioned contract attachments"

Expected: one commit extends the shared substrate without a second uploader or bucket.

### Task 15: Build contract screens, attachment states, and payment-request shortcuts

**Files:**
- Create: src/modules/contracts/ui/{contract-list-client,contract-card,contract-filters,contract-form,contract-detail,contract-attachment-panel,contract-payment-shortcuts}.tsx
- Create: src/app/(protected)/app/administrativo/contratos/{page,loading,error}.tsx
- Create: src/app/(protected)/app/administrativo/contratos/novo/page.tsx
- Create: src/app/(protected)/app/administrativo/contratos/[contractId]/page.tsx
- Create: tests/e2e/administrative-contracts.spec.ts
- Modify: src/lib/query/query-keys.ts
- Create: src/lib/capabilities/product-capabilities.ts

- [ ] **Step 1: Write the failing contract journey**

Create a contract, filter every lifecycle status, paginate, edit, upload attachment version 1, replace with version 2, inspect both history rows, download current, close with reason, and verify alerts/actions no longer treat it active. Unit-test the shortcut URL builder with the returned contract.id and assert the current E2E UI hides the controls while the Plan 05 route capability is false.

Run:

    npm run test:e2e -- tests/e2e/administrative-contracts.spec.ts

Expected: FAIL because contract pages do not exist.

- [ ] **Step 2: Implement list, status, progress, filters, and pagination UI**

Desktop table and mobile cards show number, client, object summary, dates, exact amount, text/icon status, progress value/label, and actions. Mobile filters use a dedicated Sheet with active chips. A Carregar mais control follows nextCursor and remains keyboard accessible; it does not expose page numbers backed by OFFSET.

- [ ] **Step 3: Implement forms and explicit close dialog**

Long forms are sectioned with sticky mobile footer. Date errors are associated to both fields. Closing requires typed reason, confirmation, version, CSRF, and server success; the UI performs no optimistic close. Closed contracts hide edit/delete/upload and show actor/time/reason.

- [ ] **Step 4: Implement all attachment states**

contract-attachment-panel uses use-resumable-upload.ts and exposes selection, local validation, TUS progress, quarantine/finalizing, clean/linking, failure with safe retry, infected rejection, current version, and history. Abort cancels safely. Touch targets are at least 44 px; progress has text and aria-valuenow; filename never renders as HTML.

- [ ] **Step 5: Implement non-simulated request shortcuts**

Create `src/lib/capabilities/product-capabilities.ts` exporting the typed frozen object `{ paymentRequestsRouteAvailable: false }`. Freeze the only two shortcut grammars as `/app/financeiro/solicitacoes?mode=filter&contractId=<uuid>` and `/app/financeiro/solicitacoes?mode=create&contractId=<uuid>`; the builder uses `URLSearchParams`, accepts one validated UUID, and emits no other field. `contract-payment-shortcuts.tsx` receives the server-derived capability and emits those URLs only for an authorized, open contract. Plan 05 parses the query with strict Zod, reloads contract/client/tenant server-side, and tests malformed/foreign IDs, history/back navigation, and idempotent refresh. Until that route exists, hide both actions. Plan 05 changes the capability to true only in the same commit that creates and tests the page.

- [ ] **Step 6: Add contract keys and broad invalidation**

Keys include user/company/filter/cursor. Contract create/update/close/delete invalidates lists, detail, client aggregates, dashboard, notifications, and payment selectors. Attachment mutations invalidate detail/history/storage usage. Focus, reconnect, resume, BroadcastChannel, and authorized Realtime signals trigger no-store refetch.

- [ ] **Step 7: Verify desktop/tablet/mobile and upload UX**

Run:

    npm run test:e2e -- tests/e2e/administrative-contracts.spec.ts

Expected: lifecycle/filter/pagination/form/close/upload/history/download behavior passes at 390 × 844, 768 × 1024, and 1440 × 900, with no horizontal overflow or inaccessible overlay.

- [ ] **Step 8: Commit contract UI**

Run:

    git add src/modules/contracts/ui 'src/app/(protected)/app/administrativo/contratos' src/lib/query/query-keys.ts src/lib/capabilities/product-capabilities.ts tests/e2e/administrative-contracts.spec.ts
    git commit -m "feat: add responsive contract workspace"

Expected: one commit completes the Administrative contract experience and establishes safe Plan 05 links.

### Task 16: Prove no-store, immediate invalidation, session isolation, and 409 recovery

**Files:**
- Create: tests/integration/administrative/cache-conflicts.test.ts
- Create: tests/e2e/administrative-responsive-sync.spec.ts
- Modify: src/lib/query/query-keys.ts
- Modify: src/lib/query/mutation-sync.tsx

- [ ] **Step 1: Write failing cache-header and key-scope tests**

Assert every Administrative GET/mutation route has private no-store/max-age=0 and session Vary. Inspect query keys for userId, companyId, filters, and cursor. Sign out A/sign in B in one browser and assert all A queries are removed before B render.

- [ ] **Step 2: Write failing two-tab and reconnect tests**

Open two tabs as one user. Create/archive a client, update catalog, generate proposal PDF, close contract, and add attachment in tab 1; each affected tab 2 list/detail/count refreshes without forced reload. Simulate network offline/online and page visibility restoration; assert a fresh authorized read, not Realtime payload adoption.

- [ ] **Step 3: Write failing stale-edit comparison tests**

For client, catalog, proposal, and contract, update in tab 2 then submit tab 1. Assert 409, local form values preserved, current server record refetched, field differences shown, and an explicit Usar versão atual or Revisar e tentar novamente choice. No critical mutation is optimistic.

- [ ] **Step 4: Implement missing invalidation mappings and session clearing**

Centralize affected key roots in mutation-sync.tsx. Broadcast resource type/id/company/user, never row content. Reject messages for another scope. Auth identity change calls queryClient.clear before new protected content. Realtime callback only invalidates matching scoped keys.

- [ ] **Step 5: Run integration and E2E synchronization tests**

Run:

    npm run test:integration -- tests/integration/administrative/cache-conflicts.test.ts
    npm run test:e2e -- tests/e2e/administrative-responsive-sync.spec.ts

Expected: no sensitive response is cacheable, two tabs converge, reconnect refetches, tenant/user state never leaks, and all stale edits preserve local work.

- [ ] **Step 6: Commit consistency behavior**

Run:

    git add src/lib/query tests/integration/administrative/cache-conflicts.test.ts tests/e2e/administrative-responsive-sync.spec.ts
    git commit -m "fix: synchronize administrative mutations safely"

Expected: one commit proves immediate consistency and conflict recovery.

### Task 17: Add adversarial RLS, IDOR, XSS, PDF, and upload coverage

**Files:**
- Create: tests/integration/security/administrative-idor-xss.test.ts
- Modify: supabase/tests/database/03_administrative_rls.test.sql
- Modify: tests/integration/proposals/proposal-pdf.test.ts
- Modify: tests/integration/contracts/contract-attachments.test.ts

- [ ] **Step 1: Expand every-table RLS operation coverage**

For clients, catalog_items, proposals, proposal_items, contracts, contract_attachments, and generated_documents, assert SELECT/INSERT/UPDATE/DELETE separately for own tenant, other tenant, missing module, platform user, and anon. Include malicious company_id changes and cross-tenant parent/file IDs. Assert platform role grants no operational bypass.

- [ ] **Step 2: Add API/report/document IDOR payloads**

For each item/detail/archive/restore/delete/status/PDF/attachment/download endpoint, send Company B UUID while authenticated as A. Compare response status/body/length class with a random UUID and assert no name, CNPJ, amount, filename, checksum, or existence signal leaks. Manipulate clientId filters and cursors with B data and expect empty/404.

- [ ] **Step 3: Add UI and PDF XSS corpus**

Persist script tags, event handlers, closing tags, SVG payload text, javascript-like strings, Unicode direction controls, and formula-leading text in every free-text field. Assert React renders text with no script/event node, no dangerouslySetInnerHTML usage exists under src/modules, CSP reports no execution, and PDFs contain no active actions or arbitrary network references.

- [ ] **Step 4: Add hostile upload corpus**

Exercise mismatched extension/MIME/magic, EICAR, executable header, HTML/SVG, malformed image, decompression-heavy DOCX fixture within test limits, CFB without Word stream, path traversal, duplicate finalize, expired intent, token replay, cross-tenant target/path, and concurrent replacements. Assert invalid data never reaches axsys-private and no contract_attachments row exists.

- [ ] **Step 5: Verify mutation defenses and safe errors**

Send missing/invalid CSRF, foreign/null Origin, GET mutation attempts, unknown JSON properties, oversized JSON, invalid UUID, and stale versions. Assert stable codes/correlation IDs, no SQL/stack/secret, no wildcard credentialed CORS, no state change, and rate-limit behavior inherited from Plan 01.

- [ ] **Step 6: Run the complete security subset**

Run:

    npm run db:reset
    npx supabase test db supabase/tests/database/03_administrative_rls.test.sql
    npm run test:integration -- tests/integration/security/administrative-idor-xss.test.ts
    npm run test:integration -- tests/integration/proposals/proposal-pdf.test.ts
    npm run test:integration -- tests/integration/contracts/contract-attachments.test.ts
    rg -n "dangerouslySetInnerHTML|document\.write|window\.print" src/modules src/app/api

Expected: all automated tests pass and rg returns no match.

- [ ] **Step 7: Commit security regression coverage**

Run:

    git add supabase/tests/database/03_administrative_rls.test.sql tests/integration/security tests/integration/proposals/proposal-pdf.test.ts tests/integration/contracts/contract-attachments.test.ts
    git commit -m "test: harden administrative security boundaries"

Expected: one commit adds adversarial regression tests without weakening production checks.

### Task 18: Run full responsive, accessibility, database, and production verification

**Files:**
- Verify: every file in this plan
- Verify: no unrelated file

- [ ] **Step 1: Reset the database and run all database gates**

Run:

    npm run db:reset
    npm run test:rls
    npm run db:lint
    npm run db:advisors
    npx supabase migration list --local

Expected: all pgTAP tests pass; lint/advisors have no warning; all six CLI-generated Administrative migrations are applied in order.

- [ ] **Step 2: Run unit and integration suites**

Run:

    npm run test:unit
    npm run test:integration

Expected: all domain, Decimal, schema, route, transaction, PDF, upload, cache, and security tests pass with no skipped Administrative test.

- [ ] **Step 3: Run all browser journeys**

Run:

    npm run test:e2e

Expected: client/catalog CRUD and archival, proposal to PDF/status, contract lifecycle/attachments, two-tab sync, keyboard flow, focus return, 44 px targets, and phone/tablet/desktop layouts pass in dark and light themes.

- [ ] **Step 4: Run static and production gates**

Run:

    npm run lint
    npm run typecheck
    npm run build

Expected: zero ESLint warnings, zero TypeScript errors, and a successful Next production build. Protected Administrative pages are dynamic and no authenticated response enters a shared/full-route cache.

- [ ] **Step 5: Run the deterministic database-query gate**

Create `supabase/tests/database/03_administrative_query_plans.test.sql`: as a pgTAP test in a rolled-back transaction it loads a fixed fixture of two tenants with 10,000 clients, 20,000 proposals, 20,000 contracts, 40,000 attachments, and 40,000 document rows per tenant, runs `ANALYZE`, then captures `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for tenant-scoped client prefix search, proposal list, contract status/date filter, first and deep cursor pages, attachment history, and generated-document history. SQL assertions fail unless every populated business-table node uses one of the named composite/partial indexes, returns at most the route limit, has `Rows Removed by Filter` below 5% of that table fixture, and keeps the deep-cursor total cost below 2x the first cursor page. Timing is reported but not a cross-machine CI assertion; deterministic cost/index/row/filter gates always run. Search contracts are prefix-only after escaped normalization unless a dedicated `pg_trgm` GIN index is added and asserted; do not ship `%substring%` against a B-tree.

Run:

    npx supabase test db supabase/tests/database/03_administrative_query_plans.test.sql

Expected: the fixture transaction rolls back, every objective plan assertion passes, and no unbounded sequential scan occurs on a populated business table.

Run:

    git add supabase/tests/database/03_administrative_query_plans.test.sql
    git commit -m "test: lock administrative query plans"

Expected: the deterministic performance contract is versioned before the clean final gate.

- [ ] **Step 6: Confirm migrations were CLI-created and no timestamp was invented**

Run:

    find supabase/migrations -maxdepth 1 -type f \( -name '*_administrative_commercial.sql' -o -name '*_administrative_proposals.sql' -o -name '*_administrative_contracts_documents.sql' -o -name '*_administrative_rls.sql' -o -name '*_proposal_document_writer.sql' -o -name '*_contract_upload_authorization.sql' \) -print | sort
    npx supabase migration list --local

Expected: exactly one file for each of the six suffixes, every filename is the path emitted by Supabase CLI, and all are applied.

- [ ] **Step 7: Run the repository-wide final gate**

Run:

    npm run test:all

Expected: lint, typecheck, unit, integration, RLS, E2E, and build all exit 0 in sequence.

- [ ] **Step 8: Review diff scope**

Run:

    git status --short
    git diff --check
    git diff --stat

Expected: no whitespace error, secret, generated PDF fixture, uploaded file, unrelated feature, or uncommitted change appears. All implementation and verification changes were committed in the preceding task-specific commits.

## Completion evidence

Do not mark this plan complete until the executor records:

- the six actual CLI-generated migration paths;
- the passing pgTAP count and zero-warning database advisor result;
- the concurrent per-tenant proposal number sequences and rollback result;
- Decimal service/product examples matched by SQL totals;
- one generated PDF checksum/version and proof it loads with no active action;
- one two-version private contract attachment with only one current row;
- phone/tablet/desktop Playwright results;
- two-tab invalidation and stale 409 comparison results;
- the final npm run test:all exit code.

Plans 04 and 05 may extend shared files and generated_documents, but they must preserve all contracts and regression tests established here.
