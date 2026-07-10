# Axsys Finance, Payment Requests, and Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver auditable income and expense management plus the full invoice-to-payment workflow, including certificate formalization, Gemini-assisted extraction, canonical PDFs, atomic posting, and reversals.

**Architecture:** PostgreSQL owns monetary values, state transitions, uniqueness, and the paid transaction. Next.js Server Components read fresh data; Server Actions and Route Handlers validate authorization and invoke tenant-scoped services. Gemini and PDF generation run only on the server, file bytes come from private Storage, and all critical actions wait for committed server results before refreshing related views.

**Tech Stack:** Next.js 16.2.10, React 19.2.7, Supabase PostgreSQL/Auth/Storage, Decimal.js 10.6.0, Zod 4.4.3, saxes 6.0.0, @google/genai 2.11.0 with gemini-3.5-flash, @react-pdf/renderer 4.5.1, pdf-lib 1.17.1, React Hook Form 7.81.0, Recharts 3.9.2, Vitest 4.1.10, pgTAP, Playwright 1.61.1.

---

## Dependency and file map

This plan assumes plans 01 through 04 are complete. Reuse their Auth, RLS helpers, secure upload handshake, file scanner, certificate selector, generated-document renderer, audit writer, query invalidation, and design system.

- Modify: package.json
- Modify: package-lock.json
- Modify: .env.example
- Modify: scripts/provision-local-env.ts
- Modify: src/lib/env/server.ts
- Modify: src/lib/supabase/database.types.ts
- Modify: tests/unit/scripts/provision-local-env.test.ts
- Create through CLI: supabase/migrations/*_finance_payments.sql
- Create through CLI: supabase/migrations/*_finance_security_operations.sql
- Create: supabase/tests/database/05_finance_rls.test.sql
- Create: supabase/tests/database/05_payment_atomicity.test.sql
- Create: tests/contracts/finance-bff-boundary.test.ts
- Modify: src/lib/money/money.ts
- Modify: tests/unit/lib/money.test.ts
- Create: src/modules/finance/schemas/finance-input.ts
- Create: src/modules/finance/server/finance-repository.ts
- Create: src/modules/finance/server/finance-service.ts
- Create: tests/integration/finance/finance-service.test.ts
- Create: src/modules/finance/actions/finance-actions.ts
- Create: src/modules/finance/components/finance-dashboard.tsx
- Create: src/modules/finance/components/cash-flow-chart.tsx
- Create: src/modules/finance/components/income-list.tsx
- Create: src/modules/finance/components/expense-list.tsx
- Create: src/modules/finance/components/finance-entry-sheet.tsx
- Create: tests/unit/finance/finance-components.test.tsx
- Create: src/app/(protected)/app/financeiro/page.tsx
- Create: src/app/(protected)/app/financeiro/receitas/page.tsx
- Create: src/app/(protected)/app/financeiro/despesas/page.tsx
- Create: src/modules/payments/domain/payment-state.ts
- Create: tests/unit/payments/payment-state.test.ts
- Create: src/modules/payments/domain/formalization.ts
- Create: tests/unit/payments/formalization.test.ts
- Create: src/modules/payments/schemas/payment-input.ts
- Create: src/modules/payments/server/payment-repository.ts
- Create: src/modules/payments/server/payment-service.ts
- Create: tests/integration/payments/payment-service.test.ts
- Create: src/modules/payments/server/gemini-invoice-reader.ts
- Create: tests/integration/payments/gemini-invoice-reader.test.ts
- Create: src/modules/payments/server/payment-document.tsx
- Create: src/modules/payments/server/invoice-xml-summary.tsx
- Create: src/modules/documents/server/attachment-sanitizer-worker.ts
- Create: src/modules/documents/server/run-attachment-sanitizer.ts
- Create: services/document-sanitizer/{Dockerfile,package.json,package-lock.json,src/index.ts}
- Create: docker/document-sanitizer-seccomp.json
- Create: scripts/document-sanitizer.ts
- Create: tests/integration/payments/payment-document.test.ts
- Create: src/modules/payments/actions/payment-actions.ts
- Create: src/modules/payments/components/payment-request-list.tsx
- Create: src/modules/payments/components/payment-request-wizard.tsx
- Create: src/modules/payments/components/invoice-review.tsx
- Create: src/modules/payments/components/formalization-dialog.tsx
- Create: src/modules/payments/components/payment-confirm-dialog.tsx
- Create: src/modules/payments/components/payment-report-viewer.tsx
- Create: tests/unit/payments/payment-components.test.tsx
- Create: src/app/(protected)/app/financeiro/solicitacoes/page.tsx
- Modify: src/modules/files/domain/upload-policy.ts
- Modify: src/modules/files/server/create-upload-intent.ts
- Modify: src/modules/files/server/finalize-upload-intent.ts
- Modify: src/app/api/files/uploads/route.ts
- Modify: src/app/api/files/uploads/[intentId]/finalize/route.ts
- Modify: tests/unit/files/upload-policy.test.ts
- Modify: tests/integration/files/upload-pipeline.test.ts
- Modify: src/lib/db/bff.ts
- Modify: src/lib/capabilities/product-capabilities.ts
- Create through CLI: supabase/migrations/*_payment_invoice_upload_authorization.sql
- Create: src/app/api/payments/[paymentId]/read-invoice/route.ts
- Create: src/app/api/payments/[paymentId]/documents/route.ts
- Create: src/app/api/documents/[documentId]/download/route.ts
- Create through CLI: supabase/migrations/*_payment_document_writer.sql
- Modify: src/lib/db/bff.ts
- Create: tests/e2e/finance.spec.ts
- Create: tests/e2e/payment-request.spec.ts
- Create: tests/e2e/payment-security.spec.ts
- Create: supabase/tests/database/05_finance_query_plans.test.sql

### Task 1: Pin finance, chart, Gemini, and PDF packages

**Files:**
- Modify: package.json
- Modify: package-lock.json
- Modify: .env.example
- Modify: scripts/provision-local-env.ts
- Modify: src/lib/env/server.ts
- Modify: tests/unit/scripts/provision-local-env.test.ts

- [ ] **Step 1: Verify current stable package versions**

Run:

    npm view decimal.js version
    npm view recharts version
    npm view @google/genai version
    npm view @react-pdf/renderer version
    npm view pdf-lib version
    npm view saxes version

Expected: 10.6.0, 3.9.2, 2.11.0, 4.5.1, 1.17.1, and 6.0.0 respectively. Stop and refresh the plan if a package has a security deprecation.

- [ ] **Step 2: Install exact versions**

Run:

    npm install --save-exact decimal.js@10.6.0 recharts@3.9.2 saxes@6.0.0 @google/genai@2.11.0 @react-pdf/renderer@4.5.1 pdf-lib@1.17.1

Expected: lockfile contains exact versions and npm audit has no unresolved critical advisory.

- [ ] **Step 3: Add validated server configuration**

Extend src/lib/env/server.ts with optional GEMINI_API_KEY and default GEMINI_MODEL = gemini-3.5-flash. Add both names to `.env.example` with an empty key, and extend the single Plan 01/02 provisioner so reruns preserve a manually supplied GEMINI_API_KEY/model without printing, overwriting, or generating a provider secret. Preserve Plan 02's exact `BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64` and `PII_ENCRYPTION_KEY_V1_BASE64` names; do not introduce `AXYS_ENCRYPTION_KEY`. GEMINI_API_KEY must never appear in the client schema or any NEXT_PUBLIC variable. Tests cover empty optional key, preserved supplied key/model, rerun, mode 0600, and redacted output.

- [ ] **Step 4: Commit**

Run:

    git add package.json package-lock.json .env.example scripts/provision-local-env.ts src/lib/env/server.ts tests/unit/scripts/provision-local-env.test.ts
    git commit -m "build: add finance and document dependencies"

### Task 2: Create the finance and payment schema

**Files:**
- Create through CLI: supabase/migrations/*_finance_payments.sql

- [ ] **Step 1: Generate the migration using the CLI**

Run:

    npx supabase migration new finance_payments

Expected: one generated timestamped file ending in _finance_payments.sql. Use the printed path, not a hand-written timestamp.

- [ ] **Step 2: Add enums and financial tables**

The migration must create:

    create type public.finance_origin as enum ('manual', 'payment_request');
    create type public.expense_kind as enum ('fixed', 'variable');
    create type public.payment_status as enum ('draft', 'discarded', 'pending', 'formalized', 'paid', 'cancelled', 'reversed');
    create type public.certificate_check_result as enum ('valid', 'missing', 'expired');

    create table public.incomes (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete restrict,
      description text not null check (char_length(description) between 1 and 300),
      amount numeric(14,2) not null check (amount > 0),
      occurred_on date not null,
      category text not null check (char_length(btrim(category)) between 1 and 100),
      origin public.finance_origin not null default 'manual',
      payment_request_id uuid,
      archived_at timestamptz,
      version bigint not null default 1,
      created_by uuid not null references auth.users(id) on delete restrict,
      updated_by uuid not null references auth.users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (company_id, id)
    );

    create table public.expenses (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete restrict,
      description text not null check (char_length(description) between 1 and 300),
      amount numeric(14,2) not null check (amount > 0),
      occurred_on date not null,
      category text not null check (char_length(btrim(category)) between 1 and 100),
      kind public.expense_kind not null,
      is_paid boolean not null default false,
      origin public.finance_origin not null default 'manual',
      payment_request_id uuid,
      archived_at timestamptz,
      version bigint not null default 1,
      created_by uuid not null references auth.users(id) on delete restrict,
      updated_by uuid not null references auth.users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (company_id, id)
    );

    create table public.payment_requests (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete restrict,
      draft_owner_id uuid references auth.users(id) on delete restrict,
      client_id uuid,
      contract_id uuid,
      invoice_file_id uuid,
      bank_account_id uuid,
      invoice_number text not null default '',
      description text not null default '',
      amount numeric(14,2) check (amount is null or amount > 0),
      issued_on date,
      status public.payment_status not null default 'draft',
      tax_rate_snapshot numeric(5,2) check (tax_rate_snapshot between 0 and 100),
      bank_snapshot jsonb check (bank_snapshot is null or jsonb_typeof(bank_snapshot) = 'object'),
      formalized_at timestamptz,
      formalized_by uuid references auth.users(id) on delete restrict,
      paid_at timestamptz,
      paid_by uuid references auth.users(id) on delete restrict,
      cancelled_at timestamptz,
      cancelled_by uuid references auth.users(id) on delete restrict,
      discarded_at timestamptz,
      discarded_by uuid references auth.users(id) on delete restrict,
      reversed_at timestamptz,
      reversed_by uuid references auth.users(id) on delete restrict,
      version bigint not null default 1,
      created_by uuid not null references auth.users(id) on delete restrict,
      updated_by uuid not null references auth.users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (company_id, id),
      foreign key (company_id, client_id) references public.clients(company_id, id) on delete restrict,
      foreign key (company_id, contract_id) references public.contracts(company_id, id) on delete restrict,
      foreign key (company_id, contract_id, client_id)
        references public.contracts(company_id, id, client_id) on delete restrict,
      foreign key (company_id, invoice_file_id) references public.file_objects(company_id, id) on delete restrict,
      foreign key (company_id, bank_account_id) references public.company_bank_accounts(company_id, id) on delete restrict,
      foreign key (company_id, draft_owner_id) references public.company_memberships(company_id, user_id) on delete restrict,
      check (char_length(invoice_number) <= 80),
      check (char_length(description) <= 1000),
      check (contract_id is null or client_id is not null),
      check ((status in ('draft', 'discarded') and draft_owner_id is not null) or (status not in ('draft', 'discarded') and draft_owner_id is null)),
      check ((status in ('draft', 'discarded')) or (
        client_id is not null and invoice_file_id is not null and bank_account_id is not null
        and btrim(invoice_number) <> '' and btrim(description) <> ''
        and amount is not null and issued_on is not null
      )),
      check (
        (status in ('draft', 'discarded', 'pending') and tax_rate_snapshot is null and bank_snapshot is null and formalized_at is null and formalized_by is null)
        or
        (status in ('formalized', 'paid', 'reversed') and tax_rate_snapshot is not null and bank_snapshot is not null and formalized_at is not null and formalized_by is not null)
        or
        (status = 'cancelled' and (
          (tax_rate_snapshot is null and bank_snapshot is null and formalized_at is null and formalized_by is null)
          or (tax_rate_snapshot is not null and bank_snapshot is not null and formalized_at is not null and formalized_by is not null)
        ))
      ),
      check ((paid_at is null) = (paid_by is null)),
      check ((cancelled_at is null) = (cancelled_by is null)),
      check ((discarded_at is null) = (discarded_by is null)),
      check ((reversed_at is null) = (reversed_by is null)),
      check ((status in ('paid', 'reversed')) = (paid_at is not null and paid_by is not null)),
      check ((status = 'cancelled') = (cancelled_at is not null and cancelled_by is not null)),
      check ((status = 'discarded') = (discarded_at is not null and discarded_by is not null)),
      check ((status = 'reversed') = (reversed_at is not null and reversed_by is not null))
    );

Continue with the exact snapshot and reversal relations:

    create table public.payment_certificate_checks (
      company_id uuid not null,
      payment_request_id uuid not null,
      certificate_type_id uuid not null references public.certificate_types(id) on delete restrict,
      certificate_type_code text not null check (certificate_type_code ~ '^[a-z0-9_]{2,80}$'),
      certificate_version_id uuid,
      result public.certificate_check_result not null,
      valid_until date,
      forced boolean not null default false,
      justification text,
      checked_by uuid not null references auth.users(id) on delete restrict,
      checked_at timestamptz not null default now(),
      primary key (company_id, payment_request_id, certificate_type_id),
      unique (company_id, payment_request_id, certificate_type_code),
      foreign key (company_id, payment_request_id)
        references public.payment_requests(company_id, id) on delete restrict,
      foreign key (company_id, certificate_version_id)
        references public.certificate_versions(company_id, id) on delete restrict,
      check (
        (result = 'missing' and certificate_version_id is null and valid_until is null)
        or (result in ('valid', 'expired') and certificate_version_id is not null and valid_until is not null)
      ),
      check (
        (forced and justification is not null and char_length(btrim(justification)) between 10 and 1000)
        or (not forced and justification is null)
      )
    );

    create table public.financial_reversals (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete restrict,
      payment_request_id uuid not null,
      income_id uuid not null,
      tax_expense_id uuid,
      gross_amount numeric(14,2) not null check (gross_amount > 0),
      tax_amount numeric(14,2) not null check (tax_amount >= 0),
      reason text not null check (char_length(btrim(reason)) between 10 and 1000),
      request_key_hash text not null check (request_key_hash ~ '^[0-9a-f]{64}$'),
      reversed_by uuid not null references auth.users(id) on delete restrict,
      reversed_at timestamptz not null default now(),
      unique (company_id, id),
      unique (company_id, payment_request_id),
      unique (company_id, request_key_hash),
      foreign key (company_id, payment_request_id)
        references public.payment_requests(company_id, id) on delete restrict,
      foreign key (company_id, income_id)
        references public.incomes(company_id, id) on delete restrict,
      foreign key (company_id, tax_expense_id)
        references public.expenses(company_id, id) on delete restrict,
      check ((tax_amount = 0 and tax_expense_id is null) or (tax_amount > 0 and tax_expense_id is not null))
    );

    alter table public.generated_documents
      add constraint generated_documents_payment_request_fk
      foreign key (company_id, payment_request_id)
      references public.payment_requests(company_id, id) on delete restrict;

    create unique index payment_requests_one_draft_per_user_uidx
      on public.payment_requests(company_id, draft_owner_id)
      where status = 'draft';
    create index payment_certificate_checks_request_idx
      on public.payment_certificate_checks(company_id, payment_request_id, certificate_type_code);
Plan 03 already created `document_kind`, the exactly-one-parent check, and `generated_documents`; do not recreate them. The `bank_snapshot` is a strict database-built object containing `bankAccountId`, encrypted branch/account envelopes, an optional encrypted `holderDocument` envelope (each exactly ciphertext/iv/tag/keyVersion with its Plan 02 field-specific AAD), non-secret labels, and masked last-four values. Absence of holder document is represented only as null envelope+null last4; plaintext branch/account/document, token and URL are forbidden. A CHECK plus trigger rejects extra keys and envelope mismatch; cross-plan fixtures search JSON for plaintext and decrypt all three exact fields.

- [ ] **Step 3: Add relational constraints and unique automatic postings**

After all tables exist, add composite FKs from incomes and expenses to payment_requests. The triple contract FK above is mandatory defense in depth: a payment cannot pair a contract with another same-tenant client, even under a writer bug/race. Add partial unique indexes allowing at most one active automatic income and one active tax expense per payment request (`origin = 'payment_request'`, non-null parent, and `archived_at is null`). Add the exact query indexes `incomes(company_id,occurred_on desc,id desc) where archived_at is null`, `expenses(company_id,is_paid,occurred_on desc,id desc) where archived_at is null`, `payment_requests(company_id,status,issued_on desc,id desc)`, `payment_requests(company_id,contract_id,status,id) where contract_id is not null`, and `payment_requests(company_id,client_id,status,id) where client_id is not null`, plus every remaining composite FK index used by RLS. Add the shared version/updated_at trigger to incomes, expenses, and payment_requests; write SQL transition guards so only draft→discarded, draft→pending, pending→formalized/cancelled, formalized→paid/cancelled, and paid→reversed are legal, with the timestamp/actor/snapshot invariants above. Tests race client/contract updates and prove the triple FK always rejects mismatch. Discarded is terminal, retains owner/invoice/evidence/quota, and is excluded from the current-draft selector.

Add a partial unique index on `(company_id, invoice_file_id)` where invoice_file_id is not null. Add a BEFORE INSERT/UPDATE OF invoice_file_id trigger that locks file+ready intent, rejects storage_deleted and serializes against the unreferenced-file GC claim, then requires purpose payment_invoice, same company, clean/ready, target=request ID, matching intent.file_object_id and draft owner/intent actor. One upload belongs to one request; same-tenant user B, another draft, GC-vs-attach, replay or random clean file fails safely.

Replace the Plan 03 generated-document insert trigger in this new migration with its complete dispatch implementation: proposal keeps locking/numbering by proposal; payment_letter/payment_process require the composite payment parent, lock payment_requests, and number independently by `(company_id,payment_request_id,kind)`. Add a SELECT policy that exposes only payment_letter/payment_process rows to actors with the financial module; retain the separate proposal/admin policy. A financial-only actor never reads proposal snapshots, and an administrative-only actor never reads payment snapshots.

- [ ] **Step 4: Make automatic rows immutable**

Add a private trigger that rejects UPDATE or DELETE of income/expense rows where origin = payment_request unless the transaction-local `app.operation` is exactly the allowlisted reversal marker set inside the locked private reversal function. Clear that setting at transaction end. Add an immutable trigger on payment_certificate_checks and financial_reversals. The check trigger also requires `certificate_type_id` to reference one of the six active global `is_required` rows and requires its stored code to equal that row; exact-six uniqueness/count is enforced at formalization. Only the private reversal function may archive automatic rows, and it must insert financial_reversals plus payment status/timestamps in the same transaction.

- [ ] **Step 5: Reset and inspect**

Run:

    npm run db:reset
    npx supabase migration list --local
    npm run db:types
    npm run typecheck

Expected: migration applies, constraints exist, a payment cannot mismatch contract/client under concurrent writes, and no automatic posting can exist without a same-tenant payment request.

- [ ] **Step 6: Commit**

Run:

    git add supabase/migrations src/lib/supabase/database.types.ts
    git commit -m "feat: add finance and payment schema"

### Task 3: Enforce finance RLS and payment atomicity in SQL tests

**Files:**
- Create through CLI: supabase/migrations/*_finance_security_operations.sql
- Create: supabase/tests/database/05_finance_rls.test.sql
- Create: supabase/tests/database/05_payment_atomicity.test.sql
- Modify: src/lib/db/bff.ts
- Create: tests/contracts/finance-bff-boundary.test.ts

- [ ] **Step 1: Write failing RLS, transition, replay, and race tests**

Create two tenants and users with financial, administrative-only, and no-module combinations. Register a distinct active app session for every pgTAP actor and put the exact session_id in its JWT; add revoked/must-change cases that see zero finance rows. Assert every SELECT, INSERT, UPDATE, DELETE path for incomes, expenses, payment_requests, checks, reversals, and generated documents. Include cross-tenant client/contract/bank/file IDs and a user attempting to set origin, status, paid_by, tax rate snapshot, or company_id directly.

The atomicity pgTAP file must assert:

1. pending cannot become paid;
2. formalized becomes paid exactly once;
3. one income is created for the gross amount;
4. one pending variable tax expense is created with round(amount * rate / 100, 2);
5. a zero rate creates no tax expense;
6. replay with the same idempotency key returns the original result;
7. a new key against an already paid request creates nothing;
8. two concurrent attempts cannot duplicate postings;
9. reversal archives postings and creates one immutable reversal;
10. forced formalization without justification fails;
11. a disabled/revoked/expired certificate cannot become a valid snapshot;
12. a forged actor, inactive session, missing module, stale version, or cross-tenant ID fails without side effects.
13. a client/contract referenced by a payment cannot be deleted; the inherited Administrative writer maps the restricting FK to the same `RESOURCE_IN_USE` 409 without querying a table that did not exist in Plan 03.

- [ ] **Step 2: Run and observe failures**

Run:

    npx supabase test db supabase/tests/database/05_finance_rls.test.sql
    npx supabase test db supabase/tests/database/05_payment_atomicity.test.sql

Expected: both FAIL until per-operation policies, protected-column rules, and locked functions exist.

- [ ] **Step 3: Generate the security/operations migration**

Run:

    npx supabase migration new finance_security_operations
    FINANCE_SECURITY_MIGRATION="$(find supabase/migrations -type f -name '*_finance_security_operations.sql' | sort | tail -1)"
    test -n "$FINANCE_SECURITY_MIGRATION"

Expected: the CLI emits exactly one migration and the variable resolves to it.

- [ ] **Step 4: Add complete RLS, safe grants, and locked operations**

Explicitly ENABLE and FORCE RLS on incomes, expenses, payment_requests, payment_certificate_checks, and financial_reversals; generated_documents remains ENABLE/FORCE from Plan 03. Start with `REVOKE ALL` on those tables from public, anon, authenticated, service_role, and axsys_bff. Reapply only Plan 03's exact safe proposal-history columns on `generated_documents` (`id,company_id,kind,proposal_id,payment_request_id,version,template_version,checksum_sha256,created_at`) and add no direct financial-document grant. Byte size is obtained only inside a restricted reader by joining file_objects; `byte_size`/`sha256` are not generated_documents columns. Grant authenticated SELECT only on safe income/expense columns under policies using the frozen financial-module helper. Do not grant any column of payment_requests directly: `bank_snapshot` and security/actor fields remain server-only, and safe list/detail DTOs come from restricted BFF read functions. Expose checks/reversals/payment documents only through typed BFF readers. `has_column_privilege`, information_schema, and PostgREST tests prove authenticated/service_role cannot select `bank_snapshot`, `generated_documents.immutable_snapshot`, `file_object_id`, or perform any INSERT/UPDATE/DELETE, while Plan 03 proposal history still reads its safe columns.

Create fixed-empty-search-path SECURITY DEFINER writers, EXECUTE only for axsys_bff, for manual finance CRUD (`create/update/archive_income`, `create/update/archive/set_paid_expense`) and payment draft lifecycle (`create/update/submit/discard_payment_draft`). Each receives verified actor/session, derives company/owner/origin/status, allowlists fields, CAS-locks expectedVersion, sets `app.actor_id`, audits and returns canonical scopes atomically. `discard_payment_draft` locks the owner/admin-visible draft, refuses submitted states, transitions it to terminal `discarded`, sets discarded_at/by, and preserves the row, invoice file reference, immutable upload evidence, and used quota; it cancels only an unissued reservation, while any issued capability follows Plan 02 retirement. The unique “one current draft” index applies only to status draft, so a new draft can be created without orphan deletion or quota double-decrement. Draft readers/writers enforce owner unless Company Admin. Repositories never call direct table DML. Add race/replay/foreign-owner tests and exact routine-grant/source contracts.

Freeze the normative SQL facade below. All routines share `p_actor_id uuid,p_session_id uuid,p_correlation_id uuid`, SECURITY DEFINER/search_path empty/axsys_bff-only EXECUTE, and return `{record:<safe DTO|null>,scopes:<exact text[]>}`. Exact-key bounded JSON inputs are parsed to named schemas; no arbitrary key survives.

| Routine | Domain arguments | Scopes | Audit |
|---|---|---|---|
| `create_income` | `p_input jsonb(financeIncomeCreate)` | finance,dashboard | income.created |
| `update_income` | `p_income_id uuid,p_expected_version bigint,p_input jsonb(financeIncomeUpdate)` | finance,dashboard | income.updated |
| `archive_income` | `p_income_id uuid,p_expected_version bigint` | finance,dashboard | income.archived |
| `create_expense` | `p_input jsonb(financeExpenseCreate)` | finance,dashboard | expense.created |
| `update_expense` | `p_expense_id uuid,p_expected_version bigint,p_input jsonb(financeExpenseUpdate)` | finance,dashboard | expense.updated |
| `archive_expense` | `p_expense_id uuid,p_expected_version bigint` | finance,dashboard | expense.archived |
| `set_expense_paid` | `p_expense_id uuid,p_expected_version bigint,p_is_paid boolean` | finance,dashboard | expense.payment_changed |
| `create_payment_draft` | `p_input jsonb(paymentDraftCreate)` | payments (user audience) | payment.draft_created |
| `update_payment_draft` | `p_payment_id uuid,p_expected_version bigint,p_input jsonb(paymentDraftUpdate)` | payments (user audience) | payment.draft_updated |
| `submit_payment_draft` | `p_payment_id uuid,p_expected_version bigint` | payments,finance,dashboard | payment.submitted |
| `discard_payment_draft` | `p_payment_id uuid,p_expected_version bigint` | payments (user audience) | payment.draft_discarded |
| `formalize_payment` | `p_payment_id uuid,p_expected_version bigint,p_force boolean,p_justification text` | payments,finance,dashboard | payment.formalized/forced |
| `cancel_payment` | `p_payment_id uuid,p_expected_version bigint,p_reason text` | payments,finance,dashboard | payment.cancelled |
| `post_payment` | `p_payment_id uuid,p_expected_version bigint,p_idempotency_key_hash text` | payments,finance,dashboard | payment.paid |
| `reverse_payment` | `p_payment_id uuid,p_expected_version bigint,p_idempotency_key_hash text,p_reason text` | payments,finance,dashboard | payment.reversed |

Readers `list_finance_entries`, `list_payment_requests`, and `get_payment_request` accept actor/session plus strict filters/cursor and return frozen safe DTOs; only `get_payment_request` may include owner-visible draft state, never bank_snapshot/ciphertext. `tests/contracts/finance-bff-boundary.test.ts` asserts every `to_regprocedure` signature, return keys/scopes, grant/search_path/action, typed bffDb one-to-one method and absence of shorthand/aliases.

Create fixed-empty-search_path SECURITY DEFINER functions `private.formalize_payment`, `private.cancel_payment`, `private.post_payment`, and `private.reverse_payment`. Revoke EXECUTE from public, anon, authenticated, and service_role; grant only to `axsys_bff`. Each receives actor ID plus active session ID, calls `private.assert_auth_session`, verifies company membership/module/role from tables, derives company from the locked payment row, rejects caller-supplied tenant data, then sets transaction-local `app.actor_id` only after verification. Source-field update writers allow edits only in draft/pending; formalized/paid/cancelled/reversed/discarded rows are immutable except their dedicated transition.

`formalize_payment` locks the request, derives the company-local date once with `timezone(companies.timezone, clock_timestamp())::date`, and resolves the six requirements exclusively from the canonical `certificate_types` rows where `company_id is null`, `is_required=true`, `archived_at is null`, and code is one of the frozen six. It locks those six rows, fails closed if the exact set/count differs, finds the tenant certificate collection by the global type ID (never by a same-named custom code), and calls Plan 04's single `private.current_certificate_version_id(certificate_id, as_of_date)` selector for each. A returned ID is valid; when null, a separate deterministic latest-history lookup distinguishes expired from never-uploaded without redefining “current”. Each check snapshots the global certificate_type ID/code and selected version ID. It copies the selected bank's encrypted fields/non-secret labels into bank_snapshot, snapshots tax, audits, and transitions pending→formalized atomically. SQL/domain/public/alert parity tests cover a malicious custom `federal`/other reserved code attempt, global-row archive/missing/duplicate failure, newer-expired plus older-valid, and midnight boundaries. Forced formalization additionally requires company_admin and a 10–1000 character justification; the BFF service independently enforces recent authentication.

`post_payment` locks formalized status/version, derives `occurred_on` exactly once as `timezone(companies.timezone,clock_timestamp())::date`, reserves the Plan 01 idempotency record using a hash of key+operation/resource, transitions to paid, inserts the single gross income and rounded variable tax expense with that company-local date, and audits in one transaction. Same-key replay returns the recorded result; a different key after paid returns stable already-processed without writes. `reverse_payment` requires company_admin, locks the paid request/postings, uses a separate idempotency record, sets the reversal marker, archives postings, inserts one reversal, transitions paid→reversed, and audits. `cancel_payment` permits only pending/formalized, requires expectedVersion and a 10–1000-character reason, preserves formalization snapshots, writes actor/time, and audits. No function accepts amount, tax, bank snapshot, company, certificate result, posting ID, document path or occurred_on. Fixed-clock tests straddle UTC/Fortaleza midnight.

- [ ] **Step 5: Run database tests and advisors**

Run:

    npm run db:reset
    npx supabase test db supabase/tests/database/05_finance_rls.test.sql
    npx supabase test db supabase/tests/database/05_payment_atomicity.test.sql
    npm run db:advisors
    npm run db:types
    npm run typecheck

Expected: all assertions pass and advisors report no RLS-disabled finance table or publicly executable privileged function.

- [ ] **Step 6: Commit**

Run:

    FINANCE_SECURITY_MIGRATION="$(find supabase/migrations -type f -name '*_finance_security_operations.sql' | sort | tail -1)"
    test -n "$FINANCE_SECURITY_MIGRATION"
    git add "$FINANCE_SECURITY_MIGRATION" supabase/tests/database/05_finance_rls.test.sql supabase/tests/database/05_payment_atomicity.test.sql src/lib/supabase/database.types.ts src/lib/db/bff.ts tests/contracts/finance-bff-boundary.test.ts
    git commit -m "test: enforce finance isolation and atomic posting"

### Task 4: Implement money and payment state domain rules

**Files:**
- Modify: src/lib/money/money.ts
- Modify: tests/unit/lib/money.test.ts
- Create: src/modules/payments/domain/payment-state.ts
- Create: tests/unit/payments/payment-state.test.ts

- [ ] **Step 1: Write failing money tests**

Cover parsing Brazilian inputs, rejecting negative/zero/NaN/infinite values, addition without float drift, tax rounding half-up to cents, BRL formatting, and totals that exceed numeric(14,2).

- [ ] **Step 2: Write failing state-machine tests**

Allowed transitions are draft to discarded or pending, pending to formalized or cancelled, formalized to paid or cancelled, and paid to reversed. Assert every other pair fails with PAYMENT_TRANSITION_INVALID. Source fields are editable only in draft/pending; assert formalized, discarded, paid, cancelled, and reversed reject edits and expose only dedicated transitions.

- [ ] **Step 3: Run tests**

Run:

    npm run test:unit -- tests/unit/lib/money.test.ts tests/unit/payments/payment-state.test.ts

Expected: FAIL because the domain modules are absent.

- [ ] **Step 4: Implement immutable Decimal helpers and transitions**

Extend the existing shared money.ts from Plan 03 to export parseMoney, addMoney, calculateTax, and formatBRL without changing its proposal behavior. All internal values are Decimal; repository boundaries serialize fixed two-decimal strings. payment-state.ts exports assertTransition and assertEditable with exhaustive switch statements and never accepts a status string outside the enum.

- [ ] **Step 5: Run tests**

Run:

    npm run test:unit -- tests/unit/lib/money.test.ts tests/unit/payments/payment-state.test.ts

Expected: all precision and transition cases pass.

- [ ] **Step 6: Commit**

Run:

    git add src/lib/money src/modules/payments/domain/payment-state.ts tests/unit/lib/money.test.ts tests/unit/payments/payment-state.test.ts
    git commit -m "feat: add exact money and payment state rules"

### Task 5: Implement manual income and expense use cases

**Files:**
- Create: src/modules/finance/schemas/finance-input.ts
- Create: src/modules/finance/server/finance-repository.ts
- Create: src/modules/finance/server/finance-service.ts
- Create: tests/integration/finance/finance-service.test.ts
- Create: src/modules/finance/actions/finance-actions.ts

- [ ] **Step 1: Write failing service tests**

Cover income and expense create/list/update/archive, mark manual expense paid, reject automatic row edits, expectedVersion conflict, tenant scoping, financial-module enforcement, audit entries, and invalidation scopes.

- [ ] **Step 2: Run tests**

Run:

    npm run test:integration -- tests/integration/finance/finance-service.test.ts

Expected: FAIL because finance-service is absent.

- [ ] **Step 3: Implement strict schemas**

Zod schemas accept description, decimal amount string, ISO date, category, expense kind, paid flag only where allowed, and expectedVersion. They strip unknown properties and never accept company_id, origin, payment_request_id, created_by, archived_at, or automatic status fields.

- [ ] **Step 4: Implement repository and service**

Repository read methods take AccessContext first and use RLS-safe SELECT or the safe BFF DTO readers; mutation methods call only the exact finance writer functions from Task 3. Services recompute numeric strings, reject automatic origins, translate CAS mismatches into HTTP 409 conflicts, and return the canonical invalidation scopes committed by the same audited SQL transaction. No service performs `.from(...).insert/update/delete`.

- [ ] **Step 5: Run tests**

Run:

    npm run test:integration -- tests/integration/finance/finance-service.test.ts

Expected: all authorization, immutable-origin, audit, and conflict cases pass.

- [ ] **Step 6: Commit**

Run:

    git add src/modules/finance/schemas src/modules/finance/server src/modules/finance/actions tests/integration/finance/finance-service.test.ts
    git commit -m "feat: add audited income and expense workflows"

### Task 6: Build the finance dashboard and entry screens

**Files:**
- Create: src/modules/finance/components/finance-dashboard.tsx
- Create: src/modules/finance/components/cash-flow-chart.tsx
- Create: src/modules/finance/components/income-list.tsx
- Create: src/modules/finance/components/expense-list.tsx
- Create: src/modules/finance/components/finance-entry-sheet.tsx
- Create: src/app/(protected)/app/financeiro/page.tsx
- Create: src/app/(protected)/app/financeiro/receitas/page.tsx
- Create: src/app/(protected)/app/financeiro/despesas/page.tsx
- Create: tests/unit/finance/finance-components.test.tsx

- [ ] **Step 1: Write failing component tests**

Cover real totals, expenses excluding pending amounts, six-month data built from records, empty periods, create/edit/archive, mark paid, automatic-row lock, loading skeletons, inline errors, 409 conflict, keyboard dialogs, and mobile cards.

- [ ] **Step 2: Run tests**

Run:

    npm run test:unit -- tests/unit/finance/finance-components.test.tsx

Expected: FAIL because finance UI is absent.

- [ ] **Step 3: Implement dynamic server pages**

Each page exports dynamic = 'force-dynamic', calls requireCompanyContext('financial'), reads current data in parallel through the request-scoped no-store client, and passes serializable models to small client leaves. No page uses use cache, stale-time persistence, fake chart data, or module-scope service clients.

- [ ] **Step 4: Implement the responsive UI**

Use an asymmetric metric strip, one real chart, and tables that become cards below 640 px. Geist Mono displays currency and dates. Use Phosphor icons, customized shadcn forms, matched skeletons, empty guidance, restrained status colors, 44-pixel controls, and reduced motion. Automatic rows show their source and only offer the permitted reversal path.

- [ ] **Step 5: Wire confirmed mutation refresh**

Wait for the server response, then invalidate dashboard/incomes/expenses, broadcast to other tabs, and call router.refresh. Payment and mark-paid actions are never optimistic.

- [ ] **Step 6: Run tests and typecheck**

Run:

    npm run test:unit -- tests/unit/finance/finance-components.test.tsx
    npm run typecheck

Expected: all states pass and no Recharts code leaks into a Server Component.

- [ ] **Step 7: Commit**

Run:

    git add src/modules/finance/components 'src/app/(protected)/app/financeiro' tests/unit/finance/finance-components.test.tsx
    git commit -m "feat: add live finance dashboard and ledgers"

### Task 7: Implement payment drafts and secure invoice attachment

**Files:**
- Create: src/modules/payments/schemas/payment-input.ts
- Create: src/modules/payments/server/payment-repository.ts
- Create: src/modules/payments/server/payment-service.ts
- Create: tests/integration/payments/payment-service.test.ts
- Create: src/modules/payments/actions/payment-actions.ts
- Modify: src/modules/files/domain/upload-policy.ts
- Modify: src/modules/files/server/create-upload-intent.ts
- Modify: src/modules/files/server/finalize-upload-intent.ts
- Modify: src/app/api/files/uploads/route.ts
- Modify: src/app/api/files/uploads/[intentId]/finalize/route.ts
- Modify: src/lib/db/bff.ts
- Modify: src/lib/capabilities/product-capabilities.ts
- Create through CLI: supabase/migrations/*_payment_invoice_upload_authorization.sql

- [ ] **Step 1: Write failing draft and request tests**

Cover one draft per user, autosave isolation, restore, discard, client/contract consistency, default bank selection, explicit alternate bank, invoice file same-tenant/clean/target/actor requirement, same-tenant user B trying A's file, one file replayed into two drafts, required fields for submission, source edit only in draft/pending, formalized lock, and expectedVersion conflict. Extend tests/unit/files/upload-policy.test.ts with safe UTF-8 XML, DOCTYPE, ENTITY, oversized XML, PDF/JPG/PNG, MIME mismatch, and executable double-extension cases for purpose payment_invoice.

- [ ] **Step 2: Run tests**

Run:

    npm run test:integration -- tests/integration/payments/payment-service.test.ts

Expected: FAIL because payment-service is absent.

- [ ] **Step 3: Implement repository and service**

Draft create/update/submit/discard calls only the exact Task 3 typed `bffDb` writers; no repository performs direct DML. Draft uniqueness is keyed by derived company plus draft owner and retains status draft. The service derives company, actor, client labels, contract linkage, default bank, and tax rate from the database. Submission validates all required fields and transitions draft to pending. The strict shortcut grammar is exactly `/app/financeiro/solicitacoes?mode=filter&contractId=<uuid>` or `?mode=create&contractId=<uuid>`; Zod rejects duplicate/extra/malformed parameters, and the service reloads the contract/client/company under financial authorization before filtering or changing the current user's draft.

- [ ] **Step 4: Add invoice purpose to the shared upload flow**

Extend the existing /api/files/uploads handshake/finalize contract for purpose payment_invoice, allowing PDF/XML/JPG/PNG up to 15 MiB. Generate `payment_invoice_upload_authorization` through the CLI and create `private.reserve_payment_invoice_upload(actor,session,payment_id,declared_name,declared_mime,declared_size,correlation_id)`, fixed-empty-search_path and EXECUTE only for axsys_bff. It revalidates active financial session and derives the same-tenant draft/pending target and owner, then calls the single Plan 02 `reserve_upload_capability_core` so path, `2 * declared_size` hold, quota lock, three/100-MiB per-user caps and status reserved cannot diverge. The generic activation function performs reserved→issued and fixes the shared two-hour signed-authorization plus 24h15m TUS cleanup-grace deadlines; no direct INSERT or browser-supplied company/bucket/path/owner is accepted.

In that same new migration—before Task 8 can read bytes—create `private.load_payment_invoice_for_ai(actor,session,payment_id,correlation_id)`. It revalidates active financial module, draft owner (or Company Admin) and status draft/pending, locks payment/file/intent, requires exact target/payment, actor ownership, purpose payment_invoice, consumed intent, ready/clean file and not claimed/deleted, then returns only `{bucket,path,mime,byteSize,sha256}` to server-only code. Revoke from public/anon/authenticated/service_role and grant only axsys_bff. Add typed methods for reservation/loader and source tests proving Gemini imports only this loader, never generic Storage/table access.

upload-policy recognizes XML only when strict UTF-8 decoding succeeds, the document has one root element, and saxes confirms there is no DOCTYPE, ENTITY, external reference, processing instruction, XInclude, oversized text node, or entity expansion; declared MIME must be application/xml or text/xml and extension xml. Unsafe XML throws `ApiError('XML_UNSAFE', 400, ...)`. Set transform=`reencode-image` for JPG/PNG and `preserve-validated-bytes` for PDF/XML; extend finalize so PDF/XML never enter sharp, quota moves reserved→used atomically, and finalization returns only clean file metadata.

Keep `paymentRequestsRouteAvailable` false in this task because the navigable page does not exist until Task 12. Integration tests freeze both shortcut URLs, reject foreign IDs without an existence oracle, and prove refresh/replay of `mode=create` reuses the same owner draft rather than creating another.

- [ ] **Step 5: Run tests**

Run:

    npm run db:reset
    npm run db:test
    npm run db:types
    npm run test:unit -- tests/unit/files/upload-policy.test.ts
    npm run test:integration -- tests/integration/payments/payment-service.test.ts tests/integration/files/upload-pipeline.test.ts

Expected: all draft, relational, upload, and conflict cases pass.

- [ ] **Step 6: Commit**

Run:

    PAYMENT_UPLOAD_MIGRATION="$(find supabase/migrations -type f -name '*_payment_invoice_upload_authorization.sql' | sort | tail -1)"
    test -n "$PAYMENT_UPLOAD_MIGRATION"
    git add "$PAYMENT_UPLOAD_MIGRATION" src/lib/db/bff.ts src/lib/supabase/database.types.ts src/lib/capabilities/product-capabilities.ts src/modules/payments src/modules/files src/app/api/files/uploads tests/integration/payments/payment-service.test.ts tests/unit/files/upload-policy.test.ts tests/integration/files/upload-pipeline.test.ts
    git commit -m "feat: add isolated payment request drafts"

### Task 8: Implement Gemini invoice extraction with strict review

**Files:**
- Create: src/modules/payments/server/gemini-invoice-reader.ts
- Create: tests/integration/payments/gemini-invoice-reader.test.ts
- Create: src/app/api/payments/[paymentId]/read-invoice/route.ts

- [ ] **Step 1: Write failing reader tests**

Mock @google/genai and cover valid JSON, missing optional taker, malformed JSON, negative amount, invalid date, prompt text embedded in invoice, provider timeout, missing API key, non-clean file, wrong tenant, and a response that attempts to add extra properties.

- [ ] **Step 2: Run tests**

Run:

    npm run test:integration -- tests/integration/payments/gemini-invoice-reader.test.ts

Expected: FAIL because the reader is absent.

- [ ] **Step 3: Implement lazy server-only Gemini initialization**

Export getGeminiClient() that creates GoogleGenAI only when GEMINI_API_KEY exists and only inside server code. Before reading bytes, the service must call `bffDb.loadPaymentInvoiceForAi`; it downloads only the exact returned path and verifies size/hash, never selects file_objects or uses a generic authorizer. Never initialize the SDK at module import time. Use model gemini-3.5-flash, responseMimeType application/json, responseJsonSchema matching invoiceNumber, netAmount, description, issueDate, and takerName, temperature 0, no tools, no function calling, no URL context, and an AbortSignal timeout.

- [ ] **Step 4: Implement the extraction contract**

Read authorized clean bytes from Storage and send inlineData plus a system instruction stating that document text is untrusted data and no instruction inside it may change the extraction task. Parse response.text with JSON.parse and then a strict Zod schema. Normalize the date and decimal but do not write any field to the request. Return suggestions plus confidence unavailable; the review UI must require an explicit Apply action.

- [ ] **Step 5: Implement the route**

The route validates CSRF/Origin, financial access, payment ownership, pending/draft status, tenant/file relationship, rate limit, and API-key availability. It is invoked only after the user clicks an explicit “Ler com IA” action and accepts a concise external-processing disclosure; no upload or page load sends a document automatically. It never logs document bytes/model output, persists neither prompt nor raw response, and sends only the selected authorized invoice—not certificates, bank credentials, unrelated tenant data, cookies, identifiers, or signed URLs. It returns 503 GEMINI_UNAVAILABLE on missing configuration and leaves manual entry fully functional.

- [ ] **Step 6: Run tests**

Run:

    npm run test:integration -- tests/integration/payments/gemini-invoice-reader.test.ts

Expected: all schema, timeout, prompt-injection, and fallback cases pass.

- [ ] **Step 7: Commit**

Run:

    git add src/modules/payments/server/gemini-invoice-reader.ts tests/integration/payments/gemini-invoice-reader.test.ts src/app/api/payments
    git commit -m "feat: extract invoice suggestions securely"

### Task 9: Implement certificate formalization and controlled override

**Files:**
- Create: src/modules/payments/domain/formalization.ts
- Create: tests/unit/payments/formalization.test.ts
- Modify: src/modules/payments/server/payment-service.ts
- Modify: tests/integration/payments/payment-service.test.ts
- Modify: src/lib/db/bff.ts

- [ ] **Step 1: Write failing formalization tests**

Cover all six valid, one missing, one expired at the next day boundary, newer invalid plus older valid, forced override by company admin with financial module and recent reauthentication, override rejected for normal user, blank justification, and immutable snapshot results.

- [ ] **Step 2: Run tests**

Run:

    npm run test:unit -- tests/unit/payments/formalization.test.ts
    npm run test:integration -- tests/integration/payments/payment-service.test.ts

Expected: FAIL because evaluateFormalization and formalize do not exist.

- [ ] **Step 3: Implement pure evaluation**

evaluateFormalization receives required codes, operational versions, clock, and timezone. It returns a six-entry result array with valid, missing, or expired, version ID, and date. It never hides pending results after override.

- [ ] **Step 4: Implement transactional formalization**

The service calls `requireCompanyContext('financial')`; a forced override also calls `requireRecentAuthentication(context, 600)` before any database operation. It invokes only `private.formalize_payment` through the restricted BFF connection, adding that exact name to `src/lib/db/bff.ts`. The SQL function from Task 3 locks the payment, requires pending status, fetches fresh certificate versions, reevaluates all six results, and rejects pending results unless the verified actor is company_admin and supplies the valid justification. It inserts all six payment_certificate_checks, snapshots encrypted bank metadata/tax, transitions to formalized, and audits normal or forced result in one transaction. The service never sends certificate outcomes, tax rate, bank values, company ID, or actor role as trusted inputs.

- [ ] **Step 5: Run tests**

Run:

    npm run test:unit -- tests/unit/payments/formalization.test.ts
    npm run test:integration -- tests/integration/payments/payment-service.test.ts

Expected: all boundary, permission, snapshot, and transaction cases pass.

- [ ] **Step 6: Commit**

Run:

    git add src/modules/payments/domain/formalization.ts src/modules/payments/server src/lib/db/bff.ts tests/unit/payments/formalization.test.ts tests/integration/payments/payment-service.test.ts
    git commit -m "feat: formalize payments against certificate snapshots"

### Task 10: Implement cancellation, atomic payment posting, and reversal

**Files:**
- Modify: src/modules/payments/server/payment-service.ts
- Modify: src/modules/payments/actions/payment-actions.ts
- Modify: tests/integration/payments/payment-service.test.ts
- Modify: src/lib/db/bff.ts

- [ ] **Step 1: Write failing replay and race tests at the service boundary**

Use two concurrent calls with different idempotency keys, a repeated identical key, a stale expectedVersion, a stale-authenticated actor, and an unauthorized actor. Assert stale authentication fails before SQL and a valid recent-auth pair produces a single paid transition, income, tax expense, audit event, and response identity.

- [ ] **Step 2: Run tests**

Run:

    npm run test:integration -- tests/integration/payments/payment-service.test.ts

Expected: FAIL because posting is not implemented.

- [ ] **Step 3: Bind the service only to the locked database operation**

The service first calls `requireCompanyContext('financial')` and `requireRecentAuthentication(context, 600)`, then uses the already-tested `private.post_payment` function from Task 3 and adds only that exact method to `src/lib/db/bff.ts`. SQL accepts verified actor/session IDs, payment ID, idempotency key, and expectedVersion; every company, amount, tax, status, and posting value remains database-derived. No service-role client or application repository may perform the individual writes.

- [ ] **Step 4: Implement reversal**

Use the already-tested `private.reverse_payment` function from Task 3. The service first requires company admin plus `requireRecentAuthentication(context, 600)` and validates a reason of 10–1000 characters; SQL independently verifies the active session/role, locks all rows, archives automatic postings, creates equal reversal records, changes status to reversed, and audits. It is idempotent by reversal request key.

- [ ] **Step 5: Implement pre-payment cancellation**

Add typed `bffDb.cancelPayment` and `payment-service.cancelPayment`. It requires financial context, recent authentication, strict `{paymentId,expectedVersion,reason}` and invokes only `private.cancel_payment`. Pending cancellation keeps snapshots null; formalized cancellation preserves all bank/tax/certificate snapshots and generated history. Draft uses discard instead, paid uses reversal, and every terminal/source field is immutable. Tests cover pending/formalized, stale/foreign/replay, preserved snapshots, exactly one audit/scopes and no posting.

- [ ] **Step 6: Invoke functions from the BFF service**

payment-service derives actor ID from verified claims, never accepts it from input, sends expectedVersion and operation-specific idempotency/reason fields, maps version mismatch to 409, and invalidates payment, finance, dashboard, contract payments, and notifications only after commit.

- [ ] **Step 7: Run unit, SQL, and concurrency tests**

Run:

    npm run test:integration -- tests/integration/payments/payment-service.test.ts
    npx supabase test db supabase/tests/database/05_payment_atomicity.test.sql

Expected: all replay/concurrent cases create one set of postings, at most one cancellation/reversal, and preserve formalized snapshots.

- [ ] **Step 8: Commit**

Run:

    git add src/modules/payments/server src/modules/payments/actions/payment-actions.ts src/lib/db/bff.ts tests/integration/payments/payment-service.test.ts
    git commit -m "feat: post and reverse payments atomically"

### Task 11: Generate immutable payment documents

**Files:**
- Create: src/modules/payments/server/payment-document.tsx
- Create: src/modules/payments/server/invoice-xml-summary.tsx
- Create: src/modules/documents/server/attachment-sanitizer-worker.ts
- Create: src/modules/documents/server/run-attachment-sanitizer.ts
- Create: services/document-sanitizer/{Dockerfile,package.json,package-lock.json,src/index.ts}
- Create: docker/document-sanitizer-seccomp.json
- Create: scripts/document-sanitizer.ts
- Modify: package.json
- Create: tests/integration/payments/payment-document.test.ts
- Create: src/app/api/payments/[paymentId]/documents/route.ts
- Create: src/app/api/documents/[documentId]/download/route.ts
- Create through CLI: supabase/migrations/*_payment_document_writer.sql
- Modify: src/lib/db/bff.ts
- Modify: src/lib/supabase/database.types.ts

- [ ] **Step 1: Write failing document tests**

Cover letter-only and full-process section order, escaped malicious company/client/object text, bank selection, amount in BRL, forced-formalization warning with all pending checks, letterhead fallback, transparent signature, PDF invoice, image invoice, XML invoice manifest, PDF/image certificates, missing attachment notice, checksum, immutable version, and cross-tenant download. Freeze certificate fixtures, then create a newer/revoked version and prove generation still uses exactly each `payment_certificate_checks.certificate_version_id` captured at formalization—not current selection. Include PDFs containing `/JavaScript`, `/JS`, `/OpenAction`, `/AA`, `/Launch`, `/URI`, `/RichMedia`, `/EmbeddedFile`, `/XFA`, annotations, encryption, excessive pages/dimensions, decompression bombs, cyclic/excessive object graphs, and malformed cross-reference tables; the generated result must contain none of those active constructs. Assert hard container termination leaves no process/container or Storage object/metadata and no plaintext branch/account appears in database JSON, API, audit, or logs; a historical key-version fixture still renders correctly when that version remains in the server keyring.

- [ ] **Step 2: Run tests**

Run:

    npm run test:integration -- tests/integration/payments/payment-document.test.ts

Expected: FAIL because renderPaymentDocument is absent.

- [ ] **Step 3: Implement the safe letter renderer**

Use @react-pdf/renderer with structured text nodes only. Do not parse HTML, use dangerouslySetInnerHTML, fetch remote URLs, or execute document content. `load_payment_document_sources` returns the authorized payment's strict encrypted bank snapshot only to server code. Reuse Plan 02's exact `decryptBankField(envelope,companyId,bankAccountId,field)` and AADs for branch/account/holderDocument; decrypt holderDocument only when its envelope is non-null and require envelope/last4 nullability parity. IDs are DB-derived and keys versioned. Frozen three-field fixtures decrypt here; wrong company/bank/field and missing key fail safely. Render the ephemeral bank view, never serialize plaintext into API/log/audit/snapshot, and overwrite mutable Buffers in finally.

Persist a separate safe immutable document snapshot containing only bankAccountId, SHA-256 of the canonical encrypted bank snapshot, bank labels/type/holder, masked branch/account, and template/source IDs; it contains neither ciphertext envelopes nor plaintext. The private writer validates the safe shape and hash against the locked payment snapshot. The PDF bytes necessarily contain the rendered bank details but remain only in private Storage behind the per-request authorized hash/size-verifying stream.

- [ ] **Step 4: Implement full-process merging**

Never ask `pdf-lib` or the XML parser to inspect untrusted attachment bytes in the Next.js process. `run-attachment-sanitizer.ts` first enforces the purpose byte cap, then invokes one disposable `docker run --rm -i axsys-document-sanitizer:<lock-hash>` per source through a narrow coordinator (never a mounted Docker socket inside the app). Input and output use a versioned length-prefixed binary protocol over stdin/stdout; stderr is discarded/redacted and any extra frame fails closed. Run as a fixed non-root UID with `--read-only --network none --cap-drop ALL --security-opt no-new-privileges --security-opt seccomp=docker/document-sanitizer-seccomp.json --memory 192m --cpus 1 --pids-limit 32 --tmpfs /tmp:rw,noexec,nosuid,size=32m --env-file /dev/null`, mounting no workspace/credentials/database/Storage path. A semaphore permits at most two jobs per app instance; queued requests time out, each container is killed at five seconds, and a whole document batch at 30 seconds. The bundle rejects encryption, bombs/active entries/annotations, caps 50 pages, and returns only a bounded reserialized PDF or canonical XML summary plus checksum. Tests prove env is empty; network/host-path/CPU/memory/PID escape attempts fail; malformed/truncated/oversized frames fail; cancellation leaves no container. `npm run sanitizer:build`, `sanitizer:self-test`, and `sanitizer:clean` use the same locked image; CI builds/self-tests it before document tests and the runbook cleans interrupted containers. A worker thread alone is explicitly not an RCE sandbox. Hosted deployment must provide an equivalent isolated job runner before the production gate; an ordinary serverless process is rejected.

Resolve certificate attachments solely from the six frozen payment_certificate_checks rows; a null/missing check produces a labeled notice page, and later publication/revocation/current-version changes do not silently replace the historical snapshot. Copy only sanitized page content/resources into the new document; never copy a source catalog, names tree, AcroForm, metadata action, attachment, or outline. Downsample clean JPG/PNG to at most 1600×2200 pixels, JPEG quality 80, inside the same bounded worker before full-page embedding.

Process sources in deterministic order: letter, invoice, then the six certificate codes in seeded order. Before each source, retain the last-safe PDF bytes; tentatively add/sanitize/save, and accept only if pages remain ≤120 and bytes remain ≤23 MiB. Otherwise restore the last-safe bytes and add one small labeled unavailable/omitted page. The final save must be ≤24 MiB (below the 25 MiB file_objects/bucket hard limit) or fail closed before Storage. Tests exercise maximum valid source sizes, an incompressible candidate, notice fallback, deterministic order, final hard limit, and quota concurrency.

For an XML invoice, the bounded worker parses again with the strict saxes policy and returns only canonical reviewed scalar data; render `invoice-xml-summary.tsx` as a plain-text manifest page containing only the payment's reviewed invoice number/date/amount/taker, original byte size, and SHA-256. Never embed raw XML, tags, stylesheet, external reference, or arbitrary node text. Unsafe/corrupt/excessive PDF/XML produces a visible “anexo indisponível por segurança” page rather than aborting the entire process. The renderer has no network access. Before persistence, send the final bytes through a fresh bounded validation worker and fail closed unless the full object graph contains no JavaScript, additional actions, launch/URI/rich-media/embedded-file/XFA entry, annotation, encryption, or external reference.

- [ ] **Step 5: Persist and serve documents**

The generation route requires formalized/paid status, financial module, CSRF/Origin, and tenant match. Generate a new migration with `npx supabase migration new payment_document_writer`; in the exact emitted file create `private.store_payment_document(...)`, fixed-empty-search_path SECURITY DEFINER, which rechecks actor/session and active financial module, sets transaction-local `app.actor_id` only after verification, locks the same-tenant payment and `private.company_storage_usage`, accepts only `payment_letter|payment_process`, validates server-derived random PDF path/size/checksum/strict snapshot/template version, rejects quota overflow, increments exact used bytes, atomically inserts ready/clean file metadata plus immutable generated_documents version, and inserts exactly one `payment.document_generated` audit row in that same transaction. Audit metadata is only `{kind,version,templateVersion,byteClass}`—never snapshot, path, checksum, filename, ciphertext or plaintext. Any failure rolls back quota/file/document/audit together.

Create `private.load_payment_document_sources(actor,session,payment_id)` and `private.authorize_payment_document_download(actor,session,document_id,correlation_id)` in the same migration. The loader locks/reads the authorized payment, returns its strict encrypted bank snapshot, exact clean invoice file, and only certificate files reached through that payment's frozen check version IDs (never current selection); ciphertext/object paths stay server-only and its DTO cannot cross an action/route response. The download authorizer joins payment-kind document→payment→ready/clean file, then calls Plan 02's owner-only download-audit core and returns attemptId/completionNonce plus exact metadata only to server code. Both require the financial module and same tenant. Revoke all three functions from public, anon, authenticated, and service_role; grant only to `axsys_bff`, and add typed bffDb methods.

The server-only Storage client writes/removes bytes for the exact generated path; it never inserts database rows. Database persistence/quota goes only through the restricted writer function, creates a new version on every generation, and compensates a failed DB/quota commit by deleting the object; failed cleanup becomes a redacted reconciliation alert. Tests cover two concurrent documents at the quota boundary. Download rechecks through `bffDb.authorizePaymentDocumentDownload` and the shared audited hash/size-verifying streamer, with no-store attachment/nosniff/CSP sandbox headers; completion/abort/failure consumes the attempt nonce exactly once, and it never exposes an object path or signed URL.

- [ ] **Step 6: Run tests**

Run:

    npm run sanitizer:build
    trap 'npm run sanitizer:clean >/dev/null 2>&1 || true' EXIT
    npm run sanitizer:self-test
    npm run db:reset
    npm run db:test
    npm run db:types
    npm run test:integration -- tests/integration/payments/payment-document.test.ts
    npm run sanitizer:clean
    trap - EXIT

Expected: the locked image builds/self-tests, PDF headers begin with %PDF, snapshots/checksums persist, malicious text appears only as text, cross-tenant downloads return not found, and a shell trap/finally always runs sanitizer:clean even when a test fails.

- [ ] **Step 7: Commit**

Run:

    PAYMENT_DOCUMENT_MIGRATION="$(find supabase/migrations -type f -name '*_payment_document_writer.sql' | sort | tail -1)"
    test -n "$PAYMENT_DOCUMENT_MIGRATION"
    git add "$PAYMENT_DOCUMENT_MIGRATION" src/modules/payments/server/payment-document.tsx src/modules/payments/server/invoice-xml-summary.tsx src/modules/documents/server/attachment-sanitizer-worker.ts src/modules/documents/server/run-attachment-sanitizer.ts services/document-sanitizer docker/document-sanitizer-seccomp.json scripts/document-sanitizer.ts package.json src/lib/db/bff.ts src/lib/supabase/database.types.ts tests/integration/payments/payment-document.test.ts src/app/api/payments src/app/api/documents
    git commit -m "feat: generate immutable payment documents"

### Task 12: Build the responsive payment workflow UI

**Files:**
- Create: src/modules/payments/components/payment-request-list.tsx
- Create: src/modules/payments/components/payment-request-wizard.tsx
- Create: src/modules/payments/components/invoice-review.tsx
- Create: src/modules/payments/components/formalization-dialog.tsx
- Create: src/modules/payments/components/payment-confirm-dialog.tsx
- Create: src/modules/payments/components/payment-report-viewer.tsx
- Create: src/app/(protected)/app/financeiro/solicitacoes/page.tsx
- Create: tests/unit/payments/payment-components.test.tsx
- Modify: src/lib/capabilities/product-capabilities.ts

- [ ] **Step 1: Write failing component tests**

Cover restored draft, the now-enabled contract shortcut creating/filtering the correct draft, autosave indicator, TUS upload progress, Gemini unavailable/manual fallback, review-before-apply, required fields, filters, source-field edit lock from formalized onward, certificate pending dialog, authorized forced override with justification, document mode selection, pending/formalized cancellation, recent-auth payment confirmation, reversal, 409 conflict, and all loading/empty/error states.

- [ ] **Step 2: Run tests**

Run:

    npm run test:unit -- tests/unit/payments/payment-components.test.tsx

Expected: FAIL because payment components are absent.

- [ ] **Step 3: Implement the dynamic page and wizard**

The page forces dynamic/no-store, strictly parses the two frozen `mode+contractId` grammars, and loads filters plus records server-side. In this same task/commit, and only after the page and navigation tests exist, set `paymentRequestsRouteAvailable` to true. The mobile wizard uses a full-screen Sheet with steps Dados, Nota, Revisão, and Processo; desktop uses a bounded dialog with a sticky action rail. Autosave is debounced but awaited on navigation. A dirty-state warning appears if save fails. Tests cover browser back/history, refresh idempotency, invalid/duplicate/extra query fields, and foreign contract IDs.

- [ ] **Step 4: Implement critical confirmations**

Formalize, force formalization, cancel, mark paid, and reverse use AlertDialog, require server confirmation, disable duplicate clicks, and never update optimistically. Cancel asks a 10–1000-character reason and is visible only for pending/formalized; formalized source fields remain read-only. After success, invalidate every related scope and show the committed result returned by the server.

- [ ] **Step 5: Implement report viewing**

Display an accessible A4 preview placeholder while the server generates, then provide the authenticated document download. Do not embed untrusted source PDFs in the application origin.

- [ ] **Step 6: Run tests and typecheck**

Run:

    npm run test:unit -- tests/unit/payments/payment-components.test.tsx
    npm run typecheck

Expected: all workflow, keyboard, conflict, and no-optimistic-critical-action cases pass.

- [ ] **Step 7: Commit**

Run:

    git add src/modules/payments/components 'src/app/(protected)/app/financeiro/solicitacoes' src/lib/capabilities/product-capabilities.ts tests/unit/payments/payment-components.test.tsx
    git commit -m "feat: add complete payment request workflow"

### Task 13: Verify finance and payment flows end to end

**Files:**
- Create: tests/e2e/finance.spec.ts
- Create: tests/e2e/payment-request.spec.ts
- Create: tests/e2e/payment-security.spec.ts
- Create: supabase/tests/database/05_finance_query_plans.test.sql

- [ ] **Step 1: Write happy-path E2E coverage**

Create two tenants. In Tenant A, follow the enabled shortcut from an open contract, create/restore the resulting payment draft, attach an invoice, apply mocked Gemini suggestions, formalize, generate both document modes, reauthenticate before marking paid, and assert one income plus one pending tax expense and updated dashboard totals. Create separate pending and formalized requests, cancel both with reason, prove snapshots preserved only for the formalized one and no posting created.

- [ ] **Step 2: Write adversarial E2E coverage**

Manipulate client, contract, bank, file, payment, document, income, and expense IDs across tenants; replay payment requests; race two tabs; submit stored-XSS strings; send forged status/origin/company fields; use expired certificates; force without permission; upload unsafe XML; and attempt to edit automatic rows.

- [ ] **Step 3: Write freshness and responsive coverage**

Assert payment changes appear in request list, finance ledgers, dashboard, contract view, and a second tab without hard reload. Run critical screens at 390, 768, and 1440 pixels in dark and light themes with no horizontal overflow.

- [ ] **Step 4: Run E2E**

Run:

    npm run test:e2e -- tests/e2e/finance.spec.ts tests/e2e/payment-request.spec.ts tests/e2e/payment-security.spec.ts

Expected: all flows pass; one payment produces exactly one income and at most one tax expense; Tenant A never observes Tenant B data.

- [ ] **Step 5: Run the deterministic finance query-plan gate**

Create a rolled-back pgTAP fixture with two tenants and 50,000 incomes, 50,000 expenses, and 30,000 payment requests per tenant; run ANALYZE and assert `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)` for dashboard period totals, income/expense ledgers, unpaid expenses, payment status/date list, contract filter, client filter, and deep keyset page. Require the exact Task 2 composite/partial index at every populated business-table node, below 5% rows removed by filter, bounded result rows, and deep-cursor cost below 2x first-page cost. Never assert wall time across machines.

Run:

    npx supabase test db supabase/tests/database/05_finance_query_plans.test.sql

Expected: every deterministic plan assertion passes and the fixture transaction rolls back.

- [ ] **Step 6: Run the complete gate**

Run:

    npm run lint
    npm run typecheck
    npm run test:unit
    npm run test:integration
    npm run db:test
    npm run db:advisors
    npm run db:types
    npm run build

Expected: all commands exit 0, advisors have no security finding, and build emits no private-route caching or module-scope SDK initialization warning.

- [ ] **Step 7: Commit**

Run:

    git add tests/e2e supabase/tests/database/05_finance_query_plans.test.sql src/lib/supabase/database.types.ts
    git commit -m "test: verify finance and payment integrity"
