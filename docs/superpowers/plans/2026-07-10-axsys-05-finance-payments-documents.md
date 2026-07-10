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
- Modify: .gitignore
- Modify: .env.example
- Modify: scripts/provision-local-env.ts
- Modify: src/lib/env/server.ts
- Modify: src/lib/supabase/database.types.ts
- Modify: tests/unit/scripts/provision-local-env.test.ts
- Create through CLI: supabase/migrations/*_finance_payments.sql
- Create through CLI: supabase/migrations/*_finance_security_operations.sql
- Create: supabase/tests/database/05_finance_rls.test.sql
- Create: supabase/tests/database/05_payment_atomicity.test.sql
- Create: supabase/tests/database/05_payment_document_writer.test.sql
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
- Create: src/modules/documents/server/sanitizer-image.ts
- Create: src/modules/documents/server/run-attachment-sanitizer.ts
- Create: services/document-sanitizer/{.dockerignore,Dockerfile,package.json,package-lock.json,src/index.ts}
- Create: docker/document-sanitizer-seccomp.json
- Create: scripts/document-sanitizer.ts
- Create: tests/unit/documents/document-sanitizer-image.test.ts
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
- Modify: src/lib/supabase/database.types.ts

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
      cancel_reason text,
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
      check (
        (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and cancel_reason is not null)
        or
        (status <> 'cancelled' and cancelled_at is null and cancelled_by is null and cancel_reason is null)
      ),
      check (cancel_reason is null or char_length(btrim(cancel_reason)) between 10 and 1000),
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
Plan 03 already created `document_kind`, the exactly-one-parent check, and `generated_documents`; do not recreate them. Freeze `bank_snapshot` as this exact database-built JSON shape—no extra key is legal:

    {
      "bankAccountId": "uuid",
      "bankCode": "string",
      "bankName": "string",
      "accountType": "checking|savings|payment",
      "holderName": "string",
      "branch": { "ciphertext": "base64", "iv": "base64", "tag": "base64", "keyVersion": 1 },
      "branchLast4": "string",
      "account": { "ciphertext": "base64", "iv": "base64", "tag": "base64", "keyVersion": 1 },
      "accountLast4": "string",
      "holderDocument": null,
      "holderDocumentLast4": null
    }

Every envelope uses its Plan 02 field-specific AAD; `keyVersion` is a positive integer and encoded members must pass the same bounded Base64 checks as the source account. When holder document exists, `holderDocument` has the same exact four-key envelope shape and `holderDocumentLast4` is a bounded string; absence is represented only by both fields being null. Plaintext branch/account/document, token, URL, path, default flag, audit data and arbitrary labels are forbidden. A CHECK plus trigger enforces exact-key equality, types, length bounds and envelope/last4 nullability parity; cross-plan fixtures search JSON for plaintext and decrypt all three exact fields.

- [ ] **Step 3: Add relational constraints and unique automatic postings**

After all tables exist, add composite FKs from incomes and expenses to payment_requests. The triple contract FK above is mandatory defense in depth: a payment cannot pair a contract with another same-tenant client, even under a writer bug/race. Add partial unique indexes allowing at most one active automatic income and one active tax expense per payment request (`origin = 'payment_request'`, non-null parent, and `archived_at is null`). Add the exact query indexes `incomes(company_id,occurred_on desc,id desc) where archived_at is null`, `expenses(company_id,is_paid,occurred_on desc,id desc) where archived_at is null`, `payment_requests(company_id,status,issued_on desc,id desc)`, `payment_requests(company_id,contract_id,status,id) where contract_id is not null`, and `payment_requests(company_id,client_id,status,id) where client_id is not null`, plus every remaining composite FK index used by RLS. Add the shared version/updated_at trigger to incomes, expenses, and payment_requests; write SQL transition guards so only draft→discarded, draft→pending, pending→formalized/cancelled, formalized→paid/cancelled, and paid→reversed are legal, with the timestamp/actor/snapshot invariants above. Tests race client/contract updates and prove the triple FK always rejects mismatch. Discarded is terminal, retains owner/invoice/evidence/quota, and is excluded from the current-draft selector.

Add a partial unique index on `(company_id, invoice_file_id)` where invoice_file_id is not null. Add a BEFORE INSERT/UPDATE OF invoice_file_id trigger that locks file+ready intent, rejects storage_deleted and serializes against the unreferenced-file GC claim, then requires purpose payment_invoice, same company, clean/ready, target=request ID, matching intent.file_object_id and draft owner/intent actor. One upload belongs to one request; same-tenant user B, another draft, GC-vs-attach, replay or random clean file fails safely.

Replace the Plan 03 generated-document insert trigger in this new migration with its complete dispatch implementation: proposal keeps locking/numbering by proposal; payment_letter/payment_process require the composite payment parent, lock `payment_requests`, require exactly `payment_requests.status in ('formalized','paid')`, and only then number independently by `(company_id,payment_request_id,kind)`. This status predicate is a defensive database boundary even for a privileged direct insert that bypasses the BFF writer; `draft|discarded|pending|cancelled|reversed` raise `PAYMENT_DOCUMENT_STATUS_INVALID` before the generated row can exist. Keep one access boundary: retain Plan 03's authenticated proposal/admin SELECT policy, but add no financial-kind policy and no authenticated/service-role Data API grant for payment documents. Payment document history/detail/download is BFF-only through the exact readers/authorizers in Tasks 3 and 11. A financial-only actor therefore reads payment documents only through the checked BFF projection and never reads proposal snapshots; an administrative-only actor never receives a payment-document projection.

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

Create two tenants and users with financial, administrative-only, and no-module combinations. Register a distinct active app session for every pgTAP actor and put the exact session_id in its JWT; add revoked/must-change cases that see zero finance rows. Assert every SELECT, INSERT, UPDATE, DELETE path for incomes, expenses, payment_requests, checks, reversals, and generated documents. Include cross-tenant client/contract/bank/file IDs and a user attempting to set origin, status, paid_by, cancel_reason, tax rate snapshot, or company_id directly.

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
14. source fields can change only while draft/pending; for every frozen column, tests attempt a distinct value and prove the guard's explicit `NEW.column IS DISTINCT FROM OLD.column` branch rejects it. The matrix covers `draft_owner_id`, `client_id`, `contract_id`, `invoice_file_id`, `bank_account_id`, `invoice_number`, `description`, `amount`, `issued_on`, `tax_rate_snapshot`, `bank_snapshot`, `formalized_at`, and `formalized_by`; the request and its certificate-check rows remain byte-for-byte unchanged.
15. pending/formalized cancellation writes actor/time/trimmed reason exactly once and creates no posting. A second/sequential or concurrent cancellation returns stable `PAYMENT_ALREADY_CANCELLED`/HTTP 409 with no second audit/outbox; cancellation racing pay/reverse yields one legal winner and stable `PAYMENT_STATE_CONFLICT`/HTTP 409 for the loser. The formalized winner preserves bank/tax/certificate snapshots; the pending winner retains null snapshots.

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

Explicitly ENABLE and FORCE RLS on incomes, expenses, payment_requests, payment_certificate_checks, and financial_reversals; generated_documents remains ENABLE/FORCE from Plan 03. Start with `REVOKE ALL` on those five finance tables plus `generated_documents` from public, anon, authenticated, service_role, and axsys_bff. Then regrant only Plan 03's exact safe proposal-history columns on `generated_documents` (`id,company_id,kind,proposal_id,payment_request_id,version,template_version,checksum_sha256,created_at`) to authenticated and preserve—do not drop, recreate, or broaden—Plan 03's proposal-only policy. Add no authenticated/service-role financial-document grant and no policy whose predicate admits `payment_letter|payment_process`. Byte size is obtained only inside a restricted reader by joining file_objects; `byte_size`/`sha256` are not generated_documents columns. Grant authenticated SELECT only on safe income/expense columns under policies using the frozen financial-module helper. Do not grant any column of payment_requests directly: `bank_snapshot` and security/actor fields remain server-only, and safe list/detail DTOs come from restricted BFF read functions. Expose checks/reversals/payment documents only through typed BFF readers. `has_column_privilege`, `pg_policies`, information_schema, and PostgREST tests prove authenticated/service_role cannot select a payment generated-document row or `bank_snapshot`, `generated_documents.immutable_snapshot`, `file_object_id`, and cannot perform any INSERT/UPDATE/DELETE, while Plan 03 proposal history still reads only its safe projection. The same tests prove the finance BFF readers are the sole payment-document read boundary.

Create only the fixed-empty-search-path SECURITY DEFINER writers named in the normative table below, with EXECUTE only for axsys_bff; the slash-style shorthand names are forbidden aliases. Each receives verified actor/session, derives company/owner/origin/status, allowlists fields, CAS-locks expectedVersion, sets `app.actor_id`, audits and returns canonical scopes atomically. `discard_payment_draft` locks the owner/admin-visible draft, refuses submitted states, transitions it to terminal `discarded`, sets discarded_at/by, and preserves the row, invoice file reference, immutable upload evidence, and used quota; it cancels only an unissued reservation, while any issued capability follows Plan 02 retirement. The unique “one current draft” index applies only to status draft, so a new draft can be created without orphan deletion or quota double-decrement. Draft readers/writers enforce owner unless Company Admin. Repositories never call direct table DML. Add race/replay/foreign-owner tests and exact routine-grant/source contracts.

Freeze these exact persisted projections. They are the complete recursive key allowlists for writer responses; no row-to-JSON shortcut may add company, owner, actor, ciphertext, snapshot, path, hash, certificate internals, or posting IDs:

```ts
type Money = string // canonical non-exponent decimal with exactly two fractional digits
type IncomeMutationDTO = Readonly<{ id: string; description: string; amount: Money; occurredOn: string; category: string; origin: 'manual' | 'payment_request'; archivedAt: string | null; version: number; createdAt: string; updatedAt: string }>
type ExpenseMutationDTO = Readonly<{ id: string; description: string; amount: Money; occurredOn: string; category: string; expenseKind: 'fixed' | 'variable'; isPaid: boolean; origin: 'manual' | 'payment_request'; archivedAt: string | null; version: number; createdAt: string; updatedAt: string }>
type PaymentMutationDTO = Readonly<{
  id: string
  invoiceNumber: string
  description: string
  amount: Money | null
  issuedOn: string | null
  status: 'draft' | 'discarded' | 'pending' | 'formalized' | 'paid' | 'cancelled' | 'reversed'
  clientId: string | null
  contractId: string | null
  invoiceFileId: string | null
  bankAccountId: string | null
  taxRateSnapshot: Money | null
  version: number
  formalizedAt: string | null
  paidAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  discardedAt: string | null
  reversedAt: string | null
  createdAt: string
  updatedAt: string
}>
```

Every full signature orders `p_actor_id uuid,p_session_id uuid`, then domain arguments, then `p_correlation_id uuid` last. All routines are fixed-empty-search-path SECURITY DEFINER with EXECUTE only for `axsys_bff`; exact-key bounded JSON inputs are parsed to named schemas. Freeze this normative writer contract:

| Routine | Exact full signature | Exact return | Audit |
|---|---|---|---|
| `create_income` | `(p_actor_id uuid,p_session_id uuid,p_input jsonb,p_correlation_id uuid)` | `{record:IncomeMutationDTO,scopes:['finance','dashboard']}` | `income.created` |
| `update_income` | `(p_actor_id uuid,p_session_id uuid,p_income_id uuid,p_expected_version bigint,p_input jsonb,p_correlation_id uuid)` | `{record:IncomeMutationDTO,scopes:['finance','dashboard']}` | `income.updated` |
| `archive_income` | `(p_actor_id uuid,p_session_id uuid,p_income_id uuid,p_expected_version bigint,p_correlation_id uuid)` | `{record:IncomeMutationDTO,scopes:['finance','dashboard']}` | `income.archived` |
| `create_expense` | `(p_actor_id uuid,p_session_id uuid,p_input jsonb,p_correlation_id uuid)` | `{record:ExpenseMutationDTO,scopes:['finance','dashboard']}` | `expense.created` |
| `update_expense` | `(p_actor_id uuid,p_session_id uuid,p_expense_id uuid,p_expected_version bigint,p_input jsonb,p_correlation_id uuid)` | `{record:ExpenseMutationDTO,scopes:['finance','dashboard']}` | `expense.updated` |
| `archive_expense` | `(p_actor_id uuid,p_session_id uuid,p_expense_id uuid,p_expected_version bigint,p_correlation_id uuid)` | `{record:ExpenseMutationDTO,scopes:['finance','dashboard']}` | `expense.archived` |
| `set_expense_paid` | `(p_actor_id uuid,p_session_id uuid,p_expense_id uuid,p_expected_version bigint,p_is_paid boolean,p_correlation_id uuid)` | `{record:ExpenseMutationDTO,scopes:['finance','dashboard']}` | `expense.payment_changed` |
| `create_payment_draft` | `(p_actor_id uuid,p_session_id uuid,p_input jsonb,p_correlation_id uuid)` | `{record:PaymentMutationDTO,scopes:['payments']}` | `payment.draft_created` |
| `update_payment_draft` | `(p_actor_id uuid,p_session_id uuid,p_payment_id uuid,p_expected_version bigint,p_input jsonb,p_correlation_id uuid)` | `{record:PaymentMutationDTO,scopes:['payments']}` | `payment.draft_updated` |
| `submit_payment_draft` | `(p_actor_id uuid,p_session_id uuid,p_payment_id uuid,p_expected_version bigint,p_correlation_id uuid)` | `{record:PaymentMutationDTO,scopes:['payments','finance','dashboard']}` | `payment.submitted` |
| `discard_payment_draft` | `(p_actor_id uuid,p_session_id uuid,p_payment_id uuid,p_expected_version bigint,p_correlation_id uuid)` | `{record:PaymentMutationDTO,scopes:['payments']}` | `payment.draft_discarded` |
| `formalize_payment` | `(p_actor_id uuid,p_session_id uuid,p_payment_id uuid,p_expected_version bigint,p_force boolean,p_justification text,p_correlation_id uuid)` | `{record:PaymentMutationDTO,scopes:['payments','finance','dashboard']}` | `payment.formalized` when `p_force=false`; `payment.formalized_forced` when `p_force=true` |
| `cancel_payment` | `(p_actor_id uuid,p_session_id uuid,p_payment_id uuid,p_expected_version bigint,p_reason text,p_correlation_id uuid)` | `{record:PaymentMutationDTO,scopes:['payments','finance','dashboard']}` on the sole successful transition; conflicts return no record/scopes | `payment.cancelled` exactly once |
| `post_payment` | `(p_actor_id uuid,p_session_id uuid,p_payment_id uuid,p_expected_version bigint,p_idempotency_key_hash text,p_correlation_id uuid)` | `{record:PaymentMutationDTO,scopes:['payments','finance','dashboard']}` | `payment.paid` exactly once |
| `reverse_payment` | `(p_actor_id uuid,p_session_id uuid,p_payment_id uuid,p_expected_version bigint,p_idempotency_key_hash text,p_reason text,p_correlation_id uuid)` | `{record:PaymentMutationDTO,scopes:['payments','finance','dashboard']}` | `payment.reversed` exactly once |

Freeze these complete read DTOs; the TypeScript types and strict Zod schemas have the same discriminants, required keys, nullability, and no catchall:

```ts
type IsoDate = string // exact YYYY-MM-DD
type IsoInstant = string // canonical UTC RFC 3339 instant
type FinanceOrigin = 'manual' | 'payment_request'
type PaymentStatus = 'draft' | 'discarded' | 'pending' | 'formalized' | 'paid' | 'cancelled' | 'reversed'
type FinanceEntryCursorPayloadDTO = Readonly<{ occurredOn: IsoDate; id: string }>
type PaymentRequestCursorPayloadDTO = Readonly<{ issuedOn: IsoDate | null; id: string }>
type FinanceEntryCursorDTO = string // unpadded base64url encoding of FinanceEntryCursorPayloadDTO
type PaymentRequestCursorDTO = string // unpadded base64url encoding of PaymentRequestCursorPayloadDTO

type FinanceIncomeListItemDTO = Readonly<{
  id: string
  entryKind: 'income'
  description: string
  amount: Money
  occurredOn: IsoDate
  category: string
  expenseKind: null
  isPaid: null
  origin: FinanceOrigin
  version: number
}>
type FinanceExpenseListItemDTO = Readonly<{
  id: string
  entryKind: 'expense'
  description: string
  amount: Money
  occurredOn: IsoDate
  category: string
  expenseKind: 'fixed' | 'variable'
  isPaid: boolean
  origin: FinanceOrigin
  version: number
}>
type FinanceEntryListItemDTO = FinanceIncomeListItemDTO | FinanceExpenseListItemDTO
type FinanceEntryListDTO = Readonly<{
  items: readonly FinanceEntryListItemDTO[]
  nextCursor: FinanceEntryCursorDTO | null
}>

type PaymentListBaseDTO = Readonly<{
  id: string
  invoiceNumber: string
  description: string
  contractId: string | null
  version: number
  createdAt: IsoInstant
  updatedAt: IsoInstant
}>
type PaymentDraftListFieldsDTO = Readonly<{
  amount: Money | null
  issuedOn: IsoDate | null
  clientId: string | null
  clientName: string | null
}>
type PaymentSubmittedListFieldsDTO = Readonly<{
  amount: Money
  issuedOn: IsoDate
  clientId: string
  clientName: string
}>
type PaymentRequestListItemDTO =
  | (PaymentListBaseDTO & PaymentDraftListFieldsDTO & Readonly<{ status: 'draft' }>)
  | (PaymentListBaseDTO & PaymentDraftListFieldsDTO & Readonly<{ status: 'discarded' }>)
  | (PaymentListBaseDTO & PaymentSubmittedListFieldsDTO & Readonly<{ status: 'pending' }>)
  | (PaymentListBaseDTO & PaymentSubmittedListFieldsDTO & Readonly<{ status: 'formalized' }>)
  | (PaymentListBaseDTO & PaymentSubmittedListFieldsDTO & Readonly<{ status: 'paid' }>)
  | (PaymentListBaseDTO & PaymentSubmittedListFieldsDTO & Readonly<{ status: 'cancelled' }>)
  | (PaymentListBaseDTO & PaymentSubmittedListFieldsDTO & Readonly<{ status: 'reversed' }>)
type PaymentRequestListDTO = Readonly<{
  items: readonly PaymentRequestListItemDTO[]
  nextCursor: PaymentRequestCursorDTO | null
}>

type PaymentRecordBaseDTO = Readonly<{
  id: string
  version: number
  createdAt: IsoInstant
  updatedAt: IsoInstant
}>
type PaymentDraftSourceDTO = Readonly<{
  invoiceNumber: string
  description: string
  amount: Money | null
  issuedOn: IsoDate | null
  clientId: string | null
  clientName: string | null
  contractId: string | null
}>
type PaymentSubmittedSourceDTO = Readonly<{
  invoiceNumber: string
  description: string
  amount: Money
  issuedOn: IsoDate
  clientId: string
  clientName: string
  contractId: string | null
}>
type DraftPaymentRecordDTO = PaymentRecordBaseDTO & PaymentDraftSourceDTO & Readonly<{ status: 'draft'; snapshotState: 'none'; taxRateSnapshot: null; formalizedAt: null; paidAt: null; cancelledAt: null; cancelReason: null; discardedAt: null; reversedAt: null }>
type DiscardedPaymentRecordDTO = PaymentRecordBaseDTO & PaymentDraftSourceDTO & Readonly<{ status: 'discarded'; snapshotState: 'none'; taxRateSnapshot: null; formalizedAt: null; paidAt: null; cancelledAt: null; cancelReason: null; discardedAt: IsoInstant; reversedAt: null }>
type PendingPaymentRecordDTO = PaymentRecordBaseDTO & PaymentSubmittedSourceDTO & Readonly<{ status: 'pending'; snapshotState: 'none'; taxRateSnapshot: null; formalizedAt: null; paidAt: null; cancelledAt: null; cancelReason: null; discardedAt: null; reversedAt: null }>
type FormalizedPaymentRecordDTO = PaymentRecordBaseDTO & PaymentSubmittedSourceDTO & Readonly<{ status: 'formalized'; snapshotState: 'captured'; taxRateSnapshot: Money; formalizedAt: IsoInstant; paidAt: null; cancelledAt: null; cancelReason: null; discardedAt: null; reversedAt: null }>
type PaidPaymentRecordDTO = PaymentRecordBaseDTO & PaymentSubmittedSourceDTO & Readonly<{ status: 'paid'; snapshotState: 'captured'; taxRateSnapshot: Money; formalizedAt: IsoInstant; paidAt: IsoInstant; cancelledAt: null; cancelReason: null; discardedAt: null; reversedAt: null }>
type CancelledBeforeFormalizationRecordDTO = PaymentRecordBaseDTO & PaymentSubmittedSourceDTO & Readonly<{ status: 'cancelled'; snapshotState: 'none'; taxRateSnapshot: null; formalizedAt: null; paidAt: null; cancelledAt: IsoInstant; cancelReason: string; discardedAt: null; reversedAt: null }>
type CancelledAfterFormalizationRecordDTO = PaymentRecordBaseDTO & PaymentSubmittedSourceDTO & Readonly<{ status: 'cancelled'; snapshotState: 'captured'; taxRateSnapshot: Money; formalizedAt: IsoInstant; paidAt: null; cancelledAt: IsoInstant; cancelReason: string; discardedAt: null; reversedAt: null }>
type ReversedPaymentRecordDTO = PaymentRecordBaseDTO & PaymentSubmittedSourceDTO & Readonly<{ status: 'reversed'; snapshotState: 'captured'; taxRateSnapshot: Money; formalizedAt: IsoInstant; paidAt: IsoInstant; cancelledAt: null; cancelReason: null; discardedAt: null; reversedAt: IsoInstant }>
type PaymentRecordDTO = DraftPaymentRecordDTO | DiscardedPaymentRecordDTO | PendingPaymentRecordDTO | FormalizedPaymentRecordDTO | PaidPaymentRecordDTO | CancelledBeforeFormalizationRecordDTO | CancelledAfterFormalizationRecordDTO | ReversedPaymentRecordDTO

type InvoiceSummaryDTO = Readonly<{ name: string; mime: 'application/pdf' | 'application/xml' | 'text/xml' | 'image/webp'; byteSize: number; scanStatus: 'clean' }>
type BankAccountSummaryDTO = Readonly<{ bankAccountId: string; bankCode: string; bankName: string; accountType: 'checking' | 'savings' | 'payment'; holderName: string; maskedBranch: string; maskedAccount: string; maskedHolderDocument: string | null }>
type RequiredCertificateCode = 'federal' | 'trabalhista' | 'fgts' | 'estadual_debitos' | 'estadual_divida' | 'municipal'
type CertificateCheckDTO<TCode extends RequiredCertificateCode> =
  | Readonly<{ code: TCode; result: 'missing'; validUntil: null; forced: boolean }>
  | Readonly<{ code: TCode; result: 'valid' | 'expired'; validUntil: IsoDate; forced: boolean }>
type SixCertificateChecksDTO = readonly [
  CertificateCheckDTO<'federal'>,
  CertificateCheckDTO<'trabalhista'>,
  CertificateCheckDTO<'fgts'>,
  CertificateCheckDTO<'estadual_debitos'>,
  CertificateCheckDTO<'estadual_divida'>,
  CertificateCheckDTO<'municipal'>,
]
type PaymentReversalDTO = Readonly<{ grossAmount: Money; taxAmount: Money; reason: string; reversedAt: IsoInstant }>
type PaymentDocumentSummaryDTO = Readonly<{ id: string; kind: 'payment_letter' | 'payment_process'; version: number; templateVersion: string; checksumSha256: string; createdAt: IsoInstant }>

type PaymentRequestDetailDTO =
  | Readonly<{ payment: DraftPaymentRecordDTO; invoiceSummary: InvoiceSummaryDTO | null; bankAccountSummary: BankAccountSummaryDTO | null; certificateChecks: readonly []; reversal: null; documents: readonly [] }>
  | Readonly<{ payment: DiscardedPaymentRecordDTO; invoiceSummary: InvoiceSummaryDTO | null; bankAccountSummary: BankAccountSummaryDTO | null; certificateChecks: readonly []; reversal: null; documents: readonly [] }>
  | Readonly<{ payment: PendingPaymentRecordDTO; invoiceSummary: InvoiceSummaryDTO; bankAccountSummary: BankAccountSummaryDTO; certificateChecks: readonly []; reversal: null; documents: readonly [] }>
  | Readonly<{ payment: FormalizedPaymentRecordDTO; invoiceSummary: InvoiceSummaryDTO; bankAccountSummary: BankAccountSummaryDTO; certificateChecks: SixCertificateChecksDTO; reversal: null; documents: readonly PaymentDocumentSummaryDTO[] }>
  | Readonly<{ payment: PaidPaymentRecordDTO; invoiceSummary: InvoiceSummaryDTO; bankAccountSummary: BankAccountSummaryDTO; certificateChecks: SixCertificateChecksDTO; reversal: null; documents: readonly PaymentDocumentSummaryDTO[] }>
  | Readonly<{ payment: CancelledBeforeFormalizationRecordDTO; invoiceSummary: InvoiceSummaryDTO; bankAccountSummary: BankAccountSummaryDTO; certificateChecks: readonly []; reversal: null; documents: readonly [] }>
  | Readonly<{ payment: CancelledAfterFormalizationRecordDTO; invoiceSummary: InvoiceSummaryDTO; bankAccountSummary: BankAccountSummaryDTO; certificateChecks: SixCertificateChecksDTO; reversal: null; documents: readonly PaymentDocumentSummaryDTO[] }>
  | Readonly<{ payment: ReversedPaymentRecordDTO; invoiceSummary: InvoiceSummaryDTO; bankAccountSummary: BankAccountSummaryDTO; certificateChecks: SixCertificateChecksDTO; reversal: PaymentReversalDTO; documents: readonly PaymentDocumentSummaryDTO[] }>
```

For draft/discarded list/detail rows, `clientName` is null exactly when `clientId` is null; submitted-state client and required source fields are non-null. `SixCertificateChecksDTO` contains the six unique canonical codes in the exact tuple order shown. Both list cursors use the separate aliases above and remain wire-level `string|null`: non-null values are unpadded base64url, at most 256 characters, and decode with exact keys/types to `FinanceEntryCursorPayloadDTO` or `PaymentRequestCursorPayloadDTO`; each `id` must be a canonical UUID, malformed/extra-key cursors fail before SQL, and the terminal page returns null. Finance order is `occurred_on DESC,id DESC`. Payment order is `issued_on DESC NULLS LAST,id DESC`; therefore only the payment cursor permits `issuedOn:null`, exactly when the last returned draft/discarded row has null `issuedOn`. At the SQL boundary, no cursor maps to both cursor parameters null; a decoded payment cursor with null `issuedOn` maps to null date plus non-null ID, so cursor presence is determined by the validated ID rather than the date alone.

Freeze the read facades separately; they have no mutation scopes or success audit, but revalidate the active session/module inside the SECURITY DEFINER body and remain axsys_bff-only:

| Reader | Exact full signature | Exact safe return |
|---|---|---|
| `list_finance_entries` | `(p_actor_id uuid,p_session_id uuid,p_kind text,p_from date,p_to date,p_is_paid boolean,p_cursor_occurred_on date,p_cursor_id uuid,p_limit integer,p_correlation_id uuid)` | `FinanceEntryListDTO`; kind exactly `income` or `expense`, income requires `p_is_paid is null`, limit 1–100 |
| `list_payment_requests` | `(p_actor_id uuid,p_session_id uuid,p_status public.payment_status,p_contract_id uuid,p_client_id uuid,p_cursor_issued_on date,p_cursor_id uuid,p_limit integer,p_correlation_id uuid)` | `PaymentRequestListDTO`; draft/discarded visible only to owner or Company Admin |
| `get_payment_request` | `(p_actor_id uuid,p_session_id uuid,p_payment_id uuid,p_correlation_id uuid)` | `PaymentRequestDetailDTO` |

`get_payment_request` may include owner-visible draft state and `cancelReason` for an authorized cancelled record, but never `bank_snapshot`, ciphertext, immutable document snapshot, certificate version/file IDs, file-object path/hash, actor/security columns or another user's draft. `tests/contracts/finance-bff-boundary.test.ts` asserts every writer/reader `to_regprocedure` signature, parameter order with correlation last, recursive JSON key/nullability equality against every discriminated branch above, exact ordered scopes, grant/search_path/action, typed bffDb one-to-one method and absence of shorthand/aliases. It exercises income/expense, draft/discarded/submitted list items, all eight detail branches, both cursor nullability outcomes, missing/versioned certificate checks, reversal null/non-null, empty/non-empty documents, and deliberately added/missing/wrong-null keys; cancel conflicts return no success DTO/scopes.

Create fixed-empty-search_path SECURITY DEFINER functions `private.formalize_payment`, `private.cancel_payment`, `private.post_payment`, and `private.reverse_payment`. Revoke EXECUTE from public, anon, authenticated, and service_role; grant only to `axsys_bff`. Each receives actor ID plus active session ID, calls `private.assert_auth_session`, verifies company membership/module/role from tables, derives company from the locked payment row, rejects caller-supplied tenant data, then sets transaction-local `app.actor_id` only after verification. Source-field update writers allow edits only in draft/pending. A separate identity guard rejects `NEW.id IS DISTINCT FROM OLD.id` or `NEW.company_id IS DISTINCT FROM OLD.company_id` in every state.

Freeze the post-formalization/terminal-state and terminal-edge source guard as this exact null-safe predicate; do not replace it with row equality, `<>`, a partial column list, or application-only validation:

```sql
if (
  old.status in ('formalized', 'paid', 'cancelled', 'reversed', 'discarded')
  or (old.status = 'draft' and new.status = 'discarded')
  or (old.status = 'pending' and new.status = 'cancelled')
) and (
  new.draft_owner_id is distinct from old.draft_owner_id
  or new.client_id is distinct from old.client_id
  or new.contract_id is distinct from old.contract_id
  or new.invoice_file_id is distinct from old.invoice_file_id
  or new.bank_account_id is distinct from old.bank_account_id
  or new.invoice_number is distinct from old.invoice_number
  or new.description is distinct from old.description
  or new.amount is distinct from old.amount
  or new.issued_on is distinct from old.issued_on
  or new.tax_rate_snapshot is distinct from old.tax_rate_snapshot
  or new.bank_snapshot is distinct from old.bank_snapshot
  or new.formalized_at is distinct from old.formalized_at
  or new.formalized_by is distinct from old.formalized_by
) then
  raise exception using errcode = '23514', message = 'payment_request_source_immutable';
end if;
```

The pending→formalized transition is the sole edge allowed to populate snapshot/formalization fields. Draft→discarded and pending→cancelled may set only their dedicated terminal status/actor/time/reason columns; the predicate forces every listed source/snapshot field to remain unchanged, so pending cancellation cannot fabricate a formalized snapshot. Every transition out of formalized and every later terminal-state update also preserves all 13 fields byte-for-byte. A separate BEFORE UPDATE OR DELETE trigger makes `payment_certificate_checks` immutable after insertion. The transition matrix still rejects all unspecified edges. pgTAP invokes every `IS DISTINCT FROM` branch with null↔value and value↔different-value cases where applicable on formalized rows and both terminal edges, then compares `bank_snapshot`, `tax_rate_snapshot`, formalization fields, and certificate-check rows recursively after the rejected statement.

`formalize_payment` locks the request, derives the company-local date once with `timezone(companies.timezone, clock_timestamp())::date`, and resolves the six requirements exclusively from the canonical `certificate_types` rows where `company_id is null`, `is_required=true`, `archived_at is null`, and code is one of the frozen six. It locks those six rows, fails closed if the exact set/count differs, finds the tenant certificate collection by the global type ID (never by a same-named custom code), and calls Plan 04's single `private.current_certificate_version_id(certificate_id, as_of_date)` selector for each. A returned ID is valid; when null, a separate deterministic latest-history lookup distinguishes expired from never-uploaded without redefining “current”. Each check snapshots the global certificate_type ID/code and selected version ID. It copies the selected bank's encrypted fields/non-secret labels into bank_snapshot, snapshots tax, audits, and transitions pending→formalized atomically. SQL/domain/public/alert parity tests cover a malicious custom `federal`/other reserved code attempt, global-row archive/missing/duplicate failure, newer-expired plus older-valid, and midnight boundaries. Forced formalization additionally requires company_admin and a 10–1000 character justification; the BFF service independently enforces recent authentication.

`post_payment` locks formalized status/version, derives `occurred_on` exactly once as `timezone(companies.timezone,clock_timestamp())::date`, reserves the Plan 01 idempotency record using a hash of key+operation/resource, transitions to paid, inserts the single gross income and rounded variable tax expense with that company-local date, and audits in one transaction. Same-key replay returns the recorded result; a different key after paid returns stable already-processed without writes. `reverse_payment` requires company_admin, locks the paid request/postings, uses a separate idempotency record, sets the reversal marker, archives postings, inserts one reversal, transitions paid→reversed, and audits.

`cancel_payment` deliberately has no idempotency key or journal entry: cancellation is one row-locked database transition with a stable conflict contract. After authorization and same-tenant lookup, it locks the request and checks state before expectedVersion. `cancelled` always raises `PAYMENT_ALREADY_CANCELLED`, mapped to HTTP 409 with no record/scopes/audit/outbox; `paid|reversed|discarded|draft` raises `PAYMENT_STATE_CONFLICT`, also HTTP 409; a still-cancellable row with a stale expectedVersion raises `VERSION_CONFLICT`. Only pending/formalized proceeds, requires a 10–1000-character reason, persists its trimmed value in `cancel_reason`, preserves every frozen field/check, writes actor/time, and emits exactly one `payment.cancelled` audit plus one canonical outbox invalidation in the same transaction. Two cancel calls therefore yield one success and one `PAYMENT_ALREADY_CANCELLED`; cancel-versus-pay/reverse yields one legal state winner and one `PAYMENT_STATE_CONFLICT`, never a second audit or posting. Audit metadata includes only allowlisted action/fromStatus/toStatus—not the free-text reason. No function accepts amount, tax, bank snapshot, company, certificate result, posting ID, document path or occurred_on. Fixed-clock tests straddle UTC/Fortaleza midnight.

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

Allowed transitions are draft to discarded or pending, pending to formalized or cancelled, formalized to paid or cancelled, and paid to reversed. The generic pure transition validator returns `PAYMENT_TRANSITION_INVALID` for every other pair; the dedicated cancel service deliberately maps an already-cancelled row to `PAYMENT_ALREADY_CANCELLED` and every other non-cancellable source state to `PAYMENT_STATE_CONFLICT`, as frozen in Task 3. Source fields are editable only in draft/pending; assert formalized, discarded, paid, cancelled, and reversed reject edits and expose only dedicated transitions.

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
- Modify: src/lib/supabase/database.types.ts
- Modify: src/lib/capabilities/product-capabilities.ts
- Create through CLI: supabase/migrations/*_payment_invoice_upload_authorization.sql
- Modify: tests/unit/files/upload-policy.test.ts
- Modify: tests/integration/files/upload-pipeline.test.ts

- [ ] **Step 1: Write failing draft and request tests**

Cover one draft per user, autosave isolation, restore, discard, client/contract consistency, default bank selection, explicit alternate bank, invoice file same-tenant/clean/target/actor requirement, same-tenant user B trying A's file, one file replayed into two drafts, required fields for submission, source edit only in draft/pending, formalized lock, and expectedVersion conflict. Extend tests/unit/files/upload-policy.test.ts with safe UTF-8 XML, DOCTYPE, ENTITY, oversized XML, PDF/JPG/PNG, MIME mismatch, and executable double-extension cases for purpose payment_invoice.

- [ ] **Step 2: Run tests**

Run:

    npm run test:integration -- tests/integration/payments/payment-service.test.ts

Expected: FAIL because payment-service is absent.

- [ ] **Step 3: Implement repository and service**

Draft create/update/submit/discard calls only the exact Task 3 typed `bffDb` writers; no repository performs direct DML. Draft uniqueness is keyed by derived company plus draft owner and retains status draft. The service derives company, actor, client labels, contract linkage, default bank, and tax rate from the database. Submission validates all required fields and transitions draft to pending. The strict shortcut grammar is exactly `/app/financeiro/solicitacoes?mode=filter&contractId=<uuid>` or `?mode=create&contractId=<uuid>`; Zod rejects duplicate/extra/malformed parameters, and the service reloads the contract/client/company under financial authorization before filtering or changing the current user's draft.

- [ ] **Step 4: Add invoice purpose to the shared upload flow**

Extend the existing /api/files/uploads handshake/finalize contract for purpose payment_invoice, allowing PDF/XML/JPG/PNG up to 15 MiB. Generate `payment_invoice_upload_authorization` through the CLI and create `private.reserve_payment_invoice_upload(p_actor_id uuid,p_session_id uuid,p_payment_id uuid,p_declared_name text,p_declared_mime text,p_declared_size bigint,p_correlation_id uuid)`, fixed-empty-search_path and EXECUTE only for axsys_bff. It revalidates active financial session and derives the same-tenant draft/pending target and owner, then calls the single Plan 02 `reserve_upload_capability_core` so path, `2 * declared_size` hold, quota lock, three/100-MiB per-user caps and status reserved cannot diverge. Its exact recursive return is Plan 02's defined `UploadReservationDTO`, whose only keys are `{intentId,quarantinePath,declaredSize}`. The generic activation function performs reserved→issued and fixes the shared two-hour signed-authorization plus 24h15m TUS cleanup-grace deadlines; no direct INSERT or browser-supplied company/bucket/path/owner is accepted.

In that same new migration—before Task 8 can read bytes—create `private.load_payment_invoice_for_ai(p_actor_id uuid,p_session_id uuid,p_payment_id uuid,p_correlation_id uuid)`. It revalidates the active financial module and locks payment/file/intent. For a draft it requires `draft_owner_id=p_actor_id` unless the actor is Company Admin; for a submitted pending request, whose owner column is intentionally null, any active same-tenant financial member may read it. It requires exact target/payment, purpose payment_invoice, consumed intent, ready/clean file and not claimed/deleted, then returns only `{bucket,path,mime,byteSize,sha256}` to server-only code. Revoke from public/anon/authenticated/service_role and grant only axsys_bff. Add one-to-one typed methods for reservation/loader and catalog/source tests proving the exact signature/return allowlist and that Gemini imports only this loader, never generic Storage/table access.

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

Mock @google/genai and cover valid JSON, missing optional taker, malformed JSON, negative amount, invalid date, prompt text embedded in invoice, provider timeout, missing API key, non-clean file, wrong tenant, and a response that attempts to add extra properties. Freeze the authorization matrix in both loader and HTTP-route tests: a draft is readable only by `draft_owner_id` or Company Admin; a pending request is readable by any active same-tenant member with the financial module; another tenant, inactive member, missing financial module, draft non-owner, and every ineligible `discarded|formalized|paid|cancelled|reversed` row receive the same neutral denial before Storage or Gemini is called.

- [ ] **Step 2: Run tests**

Run:

    npm run test:integration -- tests/integration/payments/gemini-invoice-reader.test.ts

Expected: FAIL because the reader is absent.

- [ ] **Step 3: Implement lazy server-only Gemini initialization**

Export getGeminiClient() that creates GoogleGenAI only when GEMINI_API_KEY exists and only inside server code. Before reading bytes, the service must call `bffDb.loadPaymentInvoiceForAi`; it downloads only the exact returned path and verifies size/hash, never selects file_objects or uses a generic authorizer. Never initialize the SDK at module import time. Use model gemini-3.5-flash, responseMimeType application/json, responseJsonSchema matching invoiceNumber, netAmount, description, issueDate, and takerName, temperature 0, no tools, no function calling, no URL context, and an AbortSignal timeout.

- [ ] **Step 4: Implement the extraction contract**

Read authorized clean bytes from Storage and send inlineData plus a system instruction stating that document text is untrusted data and no instruction inside it may change the extraction task. Parse response.text with JSON.parse and then a strict Zod schema. Normalize the date and decimal but do not write any field to the request. Return suggestions plus confidence unavailable; the review UI must require an explicit Apply action.

- [ ] **Step 5: Implement the route**

The route validates CSRF/Origin, rate limit, API-key availability, and delegates the entire resource authorization to `bffDb.loadPaymentInvoiceForAi` without adding a stricter ownership rule: draft requires owner or Company Admin; pending permits any active same-tenant member with the financial module. Only draft/pending are eligible, and tenant/file/status checks are repeated in the loader under lock. It is invoked only after the user clicks an explicit “Ler com IA” action and accepts a concise external-processing disclosure; no upload or page load sends a document automatically. It never logs document bytes/model output, persists neither prompt nor raw response, and sends only the selected authorized invoice—not certificates, bank credentials, unrelated tenant data, cookies, identifiers, or signed URLs. It returns 503 GEMINI_UNAVAILABLE on missing configuration and leaves manual entry fully functional.

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

For post/reverse, use two concurrent calls with different idempotency keys, a repeated identical key, a stale expectedVersion, a stale-authenticated actor, and an unauthorized actor. Assert stale authentication fails before SQL and a valid recent-auth pair produces a single paid transition, income, tax expense, audit event, and response identity. Separately call cancellation twice sequentially and concurrently without any idempotency key: assert the first returns the exact `PaymentMutationDTO`, every loser returns `PAYMENT_ALREADY_CANCELLED`/409, and audit/outbox counts remain one. Race cancel against post/reverse and assert the row lock permits one legal winner while the loser returns `PAYMENT_STATE_CONFLICT`/409 with no partial posting.

- [ ] **Step 2: Run tests**

Run:

    npm run test:integration -- tests/integration/payments/payment-service.test.ts

Expected: FAIL because posting is not implemented.

- [ ] **Step 3: Bind the service only to the locked database operation**

The service first calls `requireCompanyContext('financial')` and `requireRecentAuthentication(context, 600)`, then uses the already-tested `private.post_payment` function from Task 3 and adds only that exact method to `src/lib/db/bff.ts`. SQL accepts verified actor/session IDs, payment ID, idempotency key, and expectedVersion; every company, amount, tax, status, and posting value remains database-derived. No service-role client or application repository may perform the individual writes.

- [ ] **Step 4: Implement reversal**

Use the already-tested `private.reverse_payment` function from Task 3. The service first requires company admin plus `requireRecentAuthentication(context, 600)` and validates a reason of 10–1000 characters; SQL independently verifies the active session/role, locks all rows, archives automatic postings, creates equal reversal records, changes status to reversed, and audits. It is idempotent by reversal request key.

- [ ] **Step 5: Implement pre-payment cancellation**

Add typed `bffDb.cancelPayment` and `payment-service.cancelPayment`. It requires financial context, recent authentication, strict `{paymentId,expectedVersion,reason}` and invokes only `private.cancel_payment(p_actor_id uuid,p_session_id uuid,p_payment_id uuid,p_expected_version bigint,p_reason text,p_correlation_id uuid)`. Neither the service input nor SQL signature contains an idempotency key. Pending cancellation keeps snapshots null; formalized cancellation preserves all bank/tax/certificate snapshots and generated history. Draft uses discard instead, paid uses reversal, and every terminal/source field is immutable. Tests cover pending/formalized, stale/foreign, sequential/concurrent replay, exact `PAYMENT_ALREADY_CANCELLED` and `PAYMENT_STATE_CONFLICT` mapping, recursively preserved snapshots, exactly one audit/outbox/scope response and no posting.

- [ ] **Step 6: Invoke functions from the BFF service**

payment-service derives actor ID from verified claims, never accepts it from input, sends expectedVersion plus an idempotency-key hash only for post/reverse and a reason only for cancel/reverse, and maps `VERSION_CONFLICT`, `PAYMENT_ALREADY_CANCELLED`, and `PAYMENT_STATE_CONFLICT` to their stable 409 envelopes. After success it applies only the committed `['payments','finance','dashboard']` scope array; Plan 06 maps `payments` to request/document and contract-payment selectors, so the service neither invents a separate contract alias nor synthesizes an unreturned `notifications` scope. A conflict response performs no invalidation and carries no record/scopes.

- [ ] **Step 7: Run unit, SQL, and concurrency tests**

Run:

    npm run test:integration -- tests/integration/payments/payment-service.test.ts
    npx supabase test db supabase/tests/database/05_payment_atomicity.test.sql

Expected: all replay/concurrent cases create one set of postings, at most one cancellation/reversal, and preserve formalized snapshots.

- [ ] **Step 8: Commit**

Run:

    git add src/modules/payments/server src/modules/payments/actions/payment-actions.ts src/lib/db/bff.ts tests/integration/payments/payment-service.test.ts
    git commit -m "feat: cancel post and reverse payments atomically"

### Task 11: Generate immutable payment documents

**Files:**
- Modify: .gitignore
- Create: src/modules/payments/server/payment-document.tsx
- Create: src/modules/payments/server/invoice-xml-summary.tsx
- Create: src/modules/documents/server/attachment-sanitizer-worker.ts
- Create: src/modules/documents/server/sanitizer-image.ts
- Create: src/modules/documents/server/run-attachment-sanitizer.ts
- Create: services/document-sanitizer/{.dockerignore,Dockerfile,package.json,package-lock.json,src/index.ts}
- Create: docker/document-sanitizer-seccomp.json
- Create: scripts/document-sanitizer.ts
- Modify: package.json
- Create: tests/unit/documents/document-sanitizer-image.test.ts
- Create: tests/integration/payments/payment-document.test.ts
- Create: supabase/tests/database/05_payment_document_writer.test.sql
- Create: src/app/api/payments/[paymentId]/documents/route.ts
- Create: src/app/api/documents/[documentId]/download/route.ts
- Create through CLI: supabase/migrations/*_payment_document_writer.sql
- Modify: src/lib/db/bff.ts
- Modify: src/lib/supabase/database.types.ts

- [ ] **Step 1: Write failing document tests**

Cover letter-only and full-process section order, escaped malicious company/client/object text, bank selection, amount in BRL, forced-formalization warning with all pending checks, letterhead fallback, transparent signature, PDF invoice, image invoice, XML invoice manifest, PDF/image certificates, missing attachment notice, checksum, immutable version, and cross-tenant download. Freeze certificate fixtures, then create a newer/revoked version and prove generation still uses exactly each `payment_certificate_checks.certificate_version_id` captured at formalization—not current selection. Include PDFs containing `/JavaScript`, `/JS`, `/OpenAction`, `/AA`, `/Launch`, `/URI`, `/RichMedia`, `/EmbeddedFile`, `/XFA`, annotations, encryption, excessive pages/dimensions, decompression bombs, cyclic/excessive object graphs, and malformed cross-reference tables; the generated result must contain none of those active constructs. Assert hard container termination leaves no process/container or Storage object/metadata and no plaintext branch/account appears in database JSON, API, audit, or logs; a historical key-version fixture still renders correctly when that version remains in the server keyring.

In `05_payment_document_writer.test.sql`, create otherwise-valid fixtures in every exact payment status `draft|discarded|pending|formalized|paid|cancelled|reversed`. Call `private.store_payment_document`, `private.load_payment_document_sources`, and the payment branch of the defensive `generated_documents` trigger directly through their authorized test harness for every status. Exactly formalized and paid must pass each direct boundary; each of the other five must raise `PAYMENT_DOCUMENT_STATUS_INVALID`. After every rejection compare `private.company_storage_usage`, `file_objects`, `generated_documents`, `audit_events`, and invalidation/outbox rows byte-for-byte/count-for-count with the pre-call snapshot, and prove the loader exposes no bucket/path/hash/source payload. Include a writer race in which status changes before its row lock: the locked status decides and rejection leaves zero quota, metadata, document, audit, or outbox side effect.

- [ ] **Step 2: Run tests**

Run:

    npm run db:reset
    npx supabase test db supabase/tests/database/05_payment_document_writer.test.sql
    npm run test:integration -- tests/integration/payments/payment-document.test.ts

Expected: FAIL because the writer/loader migration and renderPaymentDocument are absent.

- [ ] **Step 3: Implement the safe letter renderer**

Use @react-pdf/renderer with structured text nodes only. Do not parse HTML, use dangerouslySetInnerHTML, fetch remote URLs, or execute document content. `load_payment_document_sources` returns the authorized payment's strict encrypted bank snapshot only to server code. Reuse Plan 02's exact `decryptBankField(envelope,companyId,bankAccountId,field)` and AADs for branch/account/holderDocument; decrypt holderDocument only when its envelope is non-null and require envelope/last4 nullability parity. IDs are DB-derived and keys versioned. Frozen three-field fixtures decrypt here; wrong company/bank/field and missing key fail safely. Render the ephemeral bank view, never serialize plaintext into API/log/audit/snapshot, and overwrite mutable Buffers in finally.

Persist a separate safe immutable document snapshot containing only bankAccountId, SHA-256 of the canonical encrypted bank snapshot, bank labels/type/holder, masked branch/account, and template/source IDs; it contains neither ciphertext envelopes nor plaintext. The private writer validates the safe shape and hash against the locked payment snapshot. The PDF bytes necessarily contain the rendered bank details but remain only in private Storage behind the per-request authorized hash/size-verifying stream.

- [ ] **Step 4: Implement full-process merging**

Never ask `pdf-lib` or the XML parser to inspect untrusted attachment bytes in the Next.js process. Pin the Dockerfile's external base exactly as `FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f`; every other external `FROM`, if introduced, must likewise use an explicit sha256 digest, while a later stage may refer only to an earlier locally named stage such as `FROM sanitizer-build`. A source test rejects a tag-only base, a changed digest, `latest`, or an ARG-selected base.

The side-effect-free `src/modules/documents/server/sanitizer-image.ts` computes a source digest only as an auxiliary stale-input assertion. It enumerates exactly `services/document-sanitizer/.dockerignore`, `services/document-sanitizer/Dockerfile`, `services/document-sanitizer/package.json`, `services/document-sanitizer/package-lock.json`, every regular file recursively under `services/document-sanitizer/src`, and `docker/document-sanitizer-seccomp.json`; repo-relative POSIX paths are bytewise sorted and symlinks/non-regular files fail closed. The source digest is SHA-256 over `UTF8('axsys-document-sanitizer-v1\0') || for each sorted entry (UTF8(path) || 0x00 || UTF8(decimalByteLength) || 0x00 || rawBytes || 0x00)`, with no newline/Unicode normalization, must match `^[0-9a-f]{64}$`, and is written only to the OCI label `org.axsys.document-sanitizer.source-sha256=$sourceDigest`. That label is never the image authority and can never be converted into a Docker tag.

For local development and CI, `sanitizer:build` creates `iidTempPath` outside the repository in a current-uid/gid directory mode 0700 with a regular file mode 0600, then runs exactly `docker buildx build --load --provenance=false --sbom=false --iidfile "$iidTempPath" --label "org.axsys.document-sanitizer.source-sha256=$sourceDigest" --file services/document-sanitizer/Dockerfile .`, with no `--tag/-t`. It reads the exact resulting Docker Image ID matching `^sha256:[0-9a-f]{64}$` and verifies `docker image inspect(imageId).Id === imageId`, the pinned base declaration, and the source-digest label. It then writes canonical JSON with exactly `{schemaVersion:1,kind:'local-image-id',baseDigest:'sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f',sourceDigest,imageId}` to `.cache/axsys/document-sanitizer-image.json`. Add these literal lines to `.gitignore`:

```gitignore
/.cache/axsys/document-sanitizer-image.json
/.cache/axsys/document-sanitizer-image.json.tmp
```

No lock/ID is versioned. Create `.cache/axsys` as the current process uid/gid with mode 0700 and the temp/final regular lock files with mode 0600; reject symlinks, wrong owner/group, extra keys, files over 4 KiB, or looser modes. Serialize the exact key order shown above with UTF-8, no insignificant whitespace, no trailing newline, and no timestamp; fsync `.cache/axsys/document-sanitizer-image.json.tmp`, atomically rename it over the final path, then fsync the parent directory. Regeneration always recomputes source/base, captures a fresh verified `--iidfile` result, and replaces the lock only after all checks; failure preserves the prior verified lock and grants no new authority. Tests inject filesystem/Docker adapters and prove byte-identical canonical lock content for the same verified values, safe replacement, crash-before-rename behavior, temp cleanup, and owner/mode/symlink rejection.

`resolveSanitizerImage(repoRoot)` is the only resolver used by self-test, runtime, CI, and Plan 06. In local/CI mode it accepts only the locked Docker Image ID, recomputes the source digest, re-runs `docker image inspect` by that ID, and requires exact ID/base/label agreement before returning the same `sha256:${imageIdHex}` string. Mutable tags—including source-derived tags, `latest`, caller/environment overrides, or `name:tag@digest`—are never accepted as authority or passed to `docker run`. In a hosted isolated runner the only alternate authority is a canonical tagless OCI reference `registry/repository@sha256:${manifestHex}` pinned in deployment provenance; the runner verifies that the published manifest digest is exactly `sha256:${manifestHex}`, then separately inspects its config for the pinned base and auxiliary source label before use. Moving a local Image ID between jobs without the corresponding loaded image is invalid: the same CI job that builds must self-test and run integration with that exact ID, while a cross-job/deployed flow must publish and consume the immutable manifest digest. CI may expose the local ID as a non-versioned job output/artifact for evidence only.

`run-attachment-sanitizer.ts` first enforces the purpose byte cap, resolves the immutable authority above, then invokes one disposable `docker run --rm -i --user 65532:65532 --read-only --network none --cap-drop ALL --security-opt no-new-privileges --security-opt seccomp=docker/document-sanitizer-seccomp.json --memory 192m --cpus 1 --pids-limit 32 --tmpfs /tmp:rw,noexec,nosuid,size=32m --env-file /dev/null "$resolvedImageAuthority"` per source through a narrow coordinator (never a mounted Docker socket inside the app). `resolvedImageAuthority` is exactly the verified local Image ID or hosted manifest-digest reference returned by the resolver. Input and output use a versioned length-prefixed binary protocol over stdin/stdout; stderr is discarded/redacted and any extra frame fails closed. The container runs as the frozen non-root UID/GID 65532:65532 and mounts no workspace, credential, database, or Storage path. A semaphore permits at most two jobs per app instance; queued requests time out, each container is killed at five seconds, and a whole document batch at 30 seconds. Missing image/manifest, mutable reference, inspect-ID mismatch, source/base-label mismatch, malformed/unsafe lock, or changed input fails `SANITIZER_IMAGE_STALE` before document bytes/secrets are read. Tests prove self-test/runtime/CI pass the identical Image ID or manifest digest to the process runner; tags and mismatches never reach Docker. The bundle rejects encryption, bombs/active entries/annotations, caps 50 pages, and returns only a bounded reserialized PDF or canonical XML summary plus checksum. Tests also prove env is empty; network/host-path/CPU/memory/PID escape attempts fail; malformed/truncated/oversized frames fail; cancellation leaves no container. `sanitizer:clean` reads the same safe lock, removes only that exact local Image ID after no jobs remain, and atomically removes the lock; the runbook cleans interrupted containers/locks. A worker thread alone is explicitly not an RCE sandbox. Hosted deployment must provide the digest-pinned isolated job runner before the production gate; an ordinary serverless process is rejected.

Resolve certificate attachments solely from the six frozen payment_certificate_checks rows; a null/missing check produces a labeled notice page, and later publication/revocation/current-version changes do not silently replace the historical snapshot. Copy only sanitized page content/resources into the new document; never copy a source catalog, names tree, AcroForm, metadata action, attachment, or outline. Downsample clean JPG/PNG to at most 1600×2200 pixels, JPEG quality 80, inside the same bounded worker before full-page embedding.

Process sources in deterministic order: letter, invoice, then the six certificate codes in seeded order. Before each source, retain the last-safe PDF bytes; tentatively add/sanitize/save, and accept only if pages remain ≤120 and bytes remain ≤23 MiB. Otherwise restore the last-safe bytes and add one small labeled unavailable/omitted page. The final save must be ≤24 MiB (below the 25 MiB file_objects/bucket hard limit) or fail closed before Storage. Tests exercise maximum valid source sizes, an incompressible candidate, notice fallback, deterministic order, final hard limit, and quota concurrency.

For an XML invoice, the bounded worker parses again with the strict saxes policy and returns only canonical reviewed scalar data; render `invoice-xml-summary.tsx` as a plain-text manifest page containing only the payment's reviewed invoice number/date/amount/taker, original byte size, and SHA-256. Never embed raw XML, tags, stylesheet, external reference, or arbitrary node text. Unsafe/corrupt/excessive PDF/XML produces a visible “anexo indisponível por segurança” page rather than aborting the entire process. The renderer has no network access. Before persistence, send the final bytes through a fresh bounded validation worker and fail closed unless the full object graph contains no JavaScript, additional actions, launch/URI/rich-media/embedded-file/XFA entry, annotation, encryption, or external reference.

- [ ] **Step 5: Persist and serve documents**

The generation route requires formalized/paid status, financial module, CSRF/Origin, and tenant match. Generate a new migration with `npx supabase migration new payment_document_writer`; in the exact emitted file create `private.store_payment_document(p_actor_id uuid,p_session_id uuid,p_payment_id uuid,p_kind public.document_kind,p_object_path text,p_content_type text,p_byte_size bigint,p_sha256 text,p_snapshot jsonb,p_template_version text,p_correlation_id uuid)`, fixed-empty-search_path SECURITY DEFINER. It rechecks actor/session and active financial module, sets transaction-local `app.actor_id` only after verification, locks the same-tenant payment first, requires exactly `status in ('formalized','paid')`, and raises `PAYMENT_DOCUMENT_STATUS_INVALID` for every other status before locking/changing `private.company_storage_usage` or inserting metadata/audit/outbox. Only after that gate does it lock quota, accept `payment_letter|payment_process`, validate the server-derived random PDF path/size/checksum/strict snapshot/template version, reject quota overflow, increment exact used bytes, atomically insert ready/clean file metadata plus immutable generated_documents version, and insert exactly one `payment.document_generated` audit row in that same transaction. The defensive payment branch of the Plan 03 generated-document trigger independently locks the same parent and repeats the identical two-status predicate, so a privileged direct insert cannot bypass it. Audit metadata is only `{kind,version,templateVersion,byteClass}`—never snapshot, path, checksum, filename, ciphertext or plaintext. Its exact return is `{documentId,kind,version,checksumSha256,templateVersion,createdAt,scopes:['payments','storage']}`; any failure rolls back quota/file/document/audit/outbox together.

Create `private.load_payment_document_sources(p_actor_id uuid,p_session_id uuid,p_payment_id uuid,p_correlation_id uuid)` and `private.authorize_payment_document_download(p_actor_id uuid,p_session_id uuid,p_document_id uuid,p_correlation_id uuid)` in the same migration. The loader locks the authorized payment, requires exactly `status in ('formalized','paid')`, and raises `PAYMENT_DOCUMENT_STATUS_INVALID` for all five other states before reading any invoice/certificate file metadata; only then may it return exactly `{payment:{id,companyId,clientId,contractId,invoiceNumber,description,amount,issuedOn,status,taxRateSnapshot,formalizedAt},encryptedBankSnapshot,invoice:{bucket,path,mime,byteSize,sha256}|null,certificates:[{code,versionId,bucket,path,mime,byteSize,sha256}|{code,missing:true}]}` to the document service. It reaches certificate files only through that payment's frozen check version IDs, never current selection. The download authorizer joins an already-created payment-kind document→payment→ready/clean file, calls Plan 02's owner-only download-audit core, and returns exactly `{bucket,path,mime,byteSize,sha256,downloadName,attemptId,completionNonce}` only to the audited streamer; historical downloads remain separately authorized after later cancellation/reversal because this new status gate applies to generation/source loading, not existing-document download. All require the financial module and same tenant. Revoke all three functions from public, anon, authenticated, and service_role; grant only to `axsys_bff`, add one-to-one typed bffDb methods, and assert signatures/return allowlists/status gates in the finance boundary test. Neither server-only source DTO may cross an action/route response.

The server-only Storage client writes/removes bytes for the exact generated path; it never inserts database rows. Database persistence/quota goes only through the restricted writer function, creates a new version on every generation, and compensates a failed DB/quota commit by deleting the object; failed cleanup becomes a redacted reconciliation alert. Tests cover two concurrent documents at the quota boundary. Download rechecks through `bffDb.authorizePaymentDocumentDownload` and the shared audited hash/size-verifying streamer, with no-store attachment/nosniff/CSP sandbox headers; completion/abort/failure consumes the attempt nonce exactly once, and it never exposes an object path or signed URL.

- [ ] **Step 6: Run tests**

Run:

    npm run sanitizer:build
    trap 'npm run sanitizer:clean >/dev/null 2>&1 || true' EXIT
    npm run sanitizer:self-test
    npm run db:reset
    npm run db:test
    npx supabase test db supabase/tests/database/05_payment_document_writer.test.sql
    npm run db:types
    npm run test:unit -- tests/unit/documents/document-sanitizer-image.test.ts
    npm run test:integration -- tests/integration/payments/payment-document.test.ts
    npm run sanitizer:clean
    trap - EXIT

Expected: the seven-state direct SQL matrix passes with zero rejected-state side effects, immutable image-identity tests pass, PDF headers begin with %PDF, snapshots/checksums persist, malicious text appears only as text, cross-tenant downloads return not found, and a shell trap/finally always runs sanitizer:clean even when a test fails.

- [ ] **Step 7: Commit**

Run:

    PAYMENT_DOCUMENT_MIGRATION="$(find supabase/migrations -type f -name '*_payment_document_writer.sql' | sort | tail -1)"
    test -n "$PAYMENT_DOCUMENT_MIGRATION"
    git add "$PAYMENT_DOCUMENT_MIGRATION" .gitignore src/modules/payments/server/payment-document.tsx src/modules/payments/server/invoice-xml-summary.tsx src/modules/documents/server/attachment-sanitizer-worker.ts src/modules/documents/server/sanitizer-image.ts src/modules/documents/server/run-attachment-sanitizer.ts services/document-sanitizer docker/document-sanitizer-seccomp.json scripts/document-sanitizer.ts package.json src/lib/db/bff.ts src/lib/supabase/database.types.ts supabase/tests/database/05_payment_document_writer.test.sql tests/unit/documents/document-sanitizer-image.test.ts tests/integration/payments/payment-document.test.ts src/app/api/payments src/app/api/documents
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

Cover restored draft, the now-enabled contract shortcut creating/filtering the correct draft, autosave indicator, TUS upload progress, Gemini unavailable/manual fallback, review-before-apply, required fields, filters, source-field edit lock from formalized onward, certificate pending dialog, authorized forced override with justification, document mode selection, pending/formalized cancellation, exact `PAYMENT_ALREADY_CANCELLED`/`PAYMENT_STATE_CONFLICT` 409 handling with no optimistic success, recent-auth payment confirmation, reversal, version conflict, and all loading/empty/error states.

- [ ] **Step 2: Run tests**

Run:

    npm run test:unit -- tests/unit/payments/payment-components.test.tsx

Expected: FAIL because payment components are absent.

- [ ] **Step 3: Implement the dynamic page and wizard**

The page forces dynamic/no-store, strictly parses the two frozen `mode+contractId` grammars, and loads filters plus records server-side. Plan 03 already defines the two canonical contract actions but renders neither while `paymentRequestsRouteAvailable` is false. In this same task/commit, and only after this destination page and its navigation tests exist, set the capability to true; only after that flip may the Plan 03 contract UI render those actions. The mobile wizard uses a full-screen Sheet with steps Dados, Nota, Revisão, and Processo; desktop uses a bounded dialog with a sticky action rail. Autosave is debounced but awaited on navigation. A dirty-state warning appears if save fails. Tests cover browser back/history, refresh idempotency, invalid/duplicate/extra query fields, and foreign contract IDs.

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

Manipulate client, contract, bank, file, payment, document, income, and expense IDs across tenants; replay payment requests; race two cancellation tabs and assert one success plus one `PAYMENT_ALREADY_CANCELLED`/409 with one audit; submit stored-XSS strings; send forged status/origin/company fields; use expired certificates; force without permission; upload unsafe XML; attempt every null-safe formalized-source mutation and automatic-row edit; and race cancellation against payment/reversal, asserting the stable `PAYMENT_STATE_CONFLICT` loser and no partial posting.

- [ ] **Step 3: Write freshness and responsive coverage**

Assert submit, formalize, cancel, pay and reverse changes appear in request list, finance ledgers, dashboard, contract view, and a second tab without hard reload. Run critical screens at 390, 768, and 1440 pixels in dark and light themes with no horizontal overflow.

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
