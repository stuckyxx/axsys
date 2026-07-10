# Axsys Certificates, Storage, and Public Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver private, versioned certificates with malware-scanned uploads, correct validity/history rules, explicit publication, and a no-cache public download portal.

**Architecture:** An authenticated BFF handshake allocates a tenant-scoped quarantine object and a path-scoped upload capability with a bounded retirement window; the browser transfers bytes directly with TUS, then an authenticated finalize route validates content, scans with ClamAV, and promotes only clean files. PostgreSQL remains the source of truth; certificate selection is pure domain code, while RLS and BFF authorization independently enforce tenant isolation.

**Tech Stack:** Next.js 16.2.10, React 19.2.7, TypeScript, Supabase PostgreSQL/Storage/Auth/Realtime, file-type 22.0.1, sharp 0.35.3, ClamAV 1.5.3, Zod 4.4.3, Vitest 4.1.10, pgTAP, Playwright 1.61.1.

---

## Dependency and file map

This plan assumes plans 01 and 02 are complete. Plan 02 already provides the generic TUS/quarantine/ClamAV upload substrate used by avatar and branding uploads. This plan extends its allowlist and reuses it; do not create a second uploader. Keep all certificate code inside src/modules/certificates and shared upload code inside src/modules/files.

- Create through Supabase CLI: supabase/migrations/*_certificates_storage.sql
- Create: supabase/tests/database/04_certificates_rls.test.sql
- Modify: supabase/seed.sql
- Modify: src/modules/files/domain/file-types.ts
- Modify: src/modules/files/domain/upload-policy.ts
- Modify: tests/unit/files/upload-policy.test.ts
- Modify: src/modules/files/server/finalize-upload-intent.ts
- Modify: tests/integration/files/upload-pipeline.test.ts
- Create: src/modules/certificates/domain/certificate-history.ts
- Create: tests/unit/certificates/certificate-history.test.ts
- Create: src/modules/certificates/server/certificate-repository.ts
- Create: src/modules/certificates/server/certificate-service.ts
- Create: tests/integration/certificates/certificate-service.test.ts
- Create: src/modules/certificates/schemas/certificate-input.ts
- Create: src/modules/certificates/actions/certificate-actions.ts
- Create: src/modules/certificates/components/certificate-dashboard.tsx
- Create: src/modules/certificates/components/certificate-card.tsx
- Create: src/modules/certificates/components/certificate-filters.tsx
- Create: src/modules/certificates/components/certificate-upload-sheet.tsx
- Create: src/modules/certificates/components/certificate-type-manager.tsx
- Create: src/modules/certificates/components/public-portal-settings.tsx
- Create: src/modules/certificates/components/certificate-states.tsx
- Create: src/modules/certificates/components/public-portal-settings.tsx
- Create: tests/unit/certificates/certificate-components.test.tsx
- Create: src/app/(protected)/app/certidoes/page.tsx
- Create: src/app/(protected)/app/certidoes/loading.tsx
- Create: src/app/(protected)/app/certidoes/error.tsx
- Modify: src/app/api/files/uploads/route.ts
- Modify: src/app/api/files/uploads/[intentId]/finalize/route.ts
- Modify: src/app/api/files/[fileId]/download/route.ts
- Create: src/app/(public)/public/certidoes/[identifier]/page.tsx
- Create: src/modules/certificates/ui/public-certificate-live-list.tsx
- Create: src/app/api/public/certificates/[identifier]/route.ts
- Create: src/app/api/public/certificates/[identifier]/[versionId]/download/route.ts
- Modify: src/proxy.ts
- Create: tests/integration/certificates/download-routes.test.ts
- Create: tests/e2e/certificates.private.spec.ts
- Create: tests/e2e/certificates.public.spec.ts
- Create: tests/e2e/certificates.security.spec.ts

### Task 1: Verify the shared secure-upload baseline

**Files:**
- Verify: package.json
- Verify: package-lock.json
- Verify: docker-compose.files.yml
- Verify: src/modules/files/domain/upload-policy.ts
- Verify: src/modules/files/server/finalize-upload-intent.ts

- [ ] **Step 1: Verify exact dependency versions**

Run:

    npm ls file-type sharp tus-js-client

Expected: file-type 22.0.1, sharp 0.35.3, and tus-js-client 4.3.1 are installed exactly once with no invalid peer dependency.

- [ ] **Step 2: Verify the scanner configuration**

Run:

    docker compose -f docker-compose.files.yml config

Expected: ClamAV uses the pinned clamav/clamav:1.5.3 image, binds port 3310 only on 127.0.0.1, and has the healthcheck established by Plan 02.

- [ ] **Step 3: Run the generic upload test suite before extending it**

Run:

    npm run test:unit -- tests/unit/files/upload-policy.test.ts
    npm run test:integration -- tests/integration/files/upload-pipeline.test.ts

Expected: all branding/avatar handshake, TUS finalize, MIME, scanner, promotion, and cross-tenant tests pass before certificate behavior is added.

### Task 2: Create the certificate and file schema

**Files:**
- Create through CLI: supabase/migrations/*_certificates_storage.sql
- Modify: supabase/seed.sql

- [ ] **Step 1: Create the migration through the supported CLI**

Run:

    npx supabase migration new certificates_storage

Expected: Supabase prints one new timestamped file ending in _certificates_storage.sql. Use exactly that generated path in all remaining steps of this task.

- [ ] **Step 2: Add the relational schema and constraints to the generated migration**

Plan 02 already created file_purpose, file_scan_status, file_status, file_objects, file_upload_intents, axsys-quarantine, and axsys-private. Verify those objects exist and do not recreate them. The migration must create these certificate relations and constraints:

    create table public.certificate_types (
      id uuid primary key default gen_random_uuid(),
      company_id uuid references public.companies(id) on delete restrict,
      code text not null check (code = lower(code) and code ~ '^[a-z][a-z0-9_]{1,63}$'),
      name text not null check (name = btrim(name) and char_length(name) between 2 and 120),
      is_required boolean not null default false,
      archived_at timestamptz,
      version bigint not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique nulls not distinct (company_id, code),
      unique (company_id, id),
      check (company_id is null or code not in (
        'federal', 'trabalhista', 'fgts', 'estadual_debitos', 'estadual_divida', 'municipal'
      ))
    );

    create table public.certificates (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete restrict,
      type_id uuid not null,
      archived_at timestamptz,
      created_by uuid not null references auth.users(id) on delete restrict,
      created_at timestamptz not null default now(),
      unique (company_id, type_id),
      unique (company_id, id),
      foreign key (type_id)
        references public.certificate_types(id) on delete restrict
    );

    create table public.certificate_versions (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references public.companies(id) on delete restrict,
      certificate_id uuid not null,
      file_id uuid not null,
      valid_until date not null,
      is_published boolean not null default false,
      published_at timestamptz,
      published_by uuid references auth.users(id) on delete restrict,
      revoked_at timestamptz,
      superseded_at timestamptz,
      archived_at timestamptz,
      version integer not null check (version > 0),
      state_version bigint not null default 1 check (state_version > 0),
      created_by uuid not null references auth.users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (certificate_id, version),
      unique (company_id, id),
      unique (company_id, file_id),
      foreign key (company_id, certificate_id)
        references public.certificates(company_id, id) on delete restrict,
      foreign key (company_id, file_id)
        references public.file_objects(company_id, id) on delete restrict,
      check ((is_published and published_at is not null and published_by is not null and revoked_at is null and superseded_at is null)
        or (not is_published))
    );

    create table public.public_certificate_settings (
      company_id uuid primary key references public.companies(id) on delete restrict,
      slug text not null unique check (
        slug ~ '^[a-z0-9][a-z0-9-]{4,61}[a-z0-9]$'
        and slug not in ('api', 'app', 'auth', 'login', 'platform', 'admin', 'public', 'static')
      ),
      alternate_token_hash text not null unique
        check (alternate_token_hash ~ '^[0-9a-f]{64}$'),
      is_enabled boolean not null default false,
      noindex boolean not null default true,
      version bigint not null default 1,
      updated_by uuid not null references auth.users(id) on delete restrict,
      updated_at timestamptz not null default now()
    );

Add indexes on every company_id, certificate_versions(certificate_id, valid_until desc, created_at desc), and file_objects(company_id, scan_status). The slug UNIQUE constraint already supplies its index; do not add a duplicate. Add a partial unique index on `(company_id, certificate_id)` where `is_published` and `revoked_at is null` and `archived_at is null`, so at most one live public version exists. Global required certificate types use company_id null; custom types carry the owning company_id. Historical certificate/type/version rows are never hard-deleted; archive fields are authoritative.

- [ ] **Step 3: Add immutable version numbering and publication checks**

Create one shared SQL selector `private.current_certificate_version_id(certificate_id, as_of_date)` used by domain parity tests, publication, public read, alerts, and Plan 05 formalization: among nonarchived, nonrevoked, ready/clean versions with `valid_until >= as_of_date`, choose the lexicographically greatest tuple `(version, created_at, id)`. Every caller derives `as_of_date` once as `timezone(companies.timezone, clock_timestamp())::date`; never use session `current_date`. Make the helper SECURITY INVOKER with fixed empty search_path and revoke EXECUTE from public, anon, authenticated, service_role, and axsys_bff; only owner/SECURITY DEFINER operations call it internally. Apply the same revoke-by-default rule to every helper/trigger function not intentionally exposed as a BFF endpoint. Add fixed-clock pgTAP cases around UTC/Fortaleza midnight plus revoked/archived/unclean candidates, equal timestamps, and ordinal-vs-createdAt disagreement. Add a private trigger function that assigns ordinal `version` as max(version) + 1 while locking the parent certificate row. A separate state trigger increments `state_version` and updated_at on publish/revoke/archive/supersede changes; ordinal version never changes. Add a scope trigger that accepts a certificate type only when its company_id is null or equals the certificate company_id.

The publication trigger locks the parent and requires the target ID to equal that shared current-valid selector; an expired newer version therefore does not block an older still-valid version. Inserting a new version that becomes current atomically unpublishes any former publication and sets its `superseded_at`, so a stale file is never public and the new current remains private until explicitly published. Publication clears the target's superseded_at, verifies file purpose/status/scan, and rejects a second live publication. If a formerly current version becomes current again only because a newer one expires, it remains unpublished until a fresh explicit publish action.

Create `private.publish_certificate_version` and `private.revoke_certificate_version` as fixed-empty-search_path SECURITY DEFINER operations. Each accepts verified actor/session IDs, version ID and expected state_version; calls `private.assert_auth_session`, derives company from the target, requires active company_admin plus certificates module, then sets transaction-local `app.actor_id`, locks the parent/current rows, and updates only with `where state_version=expected`. The single BEFORE state trigger—not the functions—sets `new.state_version=old.state_version+1` and updated_at, guaranteeing exactly +1. Insert exactly one audit in the transaction. Public-settings configure/rotate functions follow the same actor ordering and their own version CAS. Revocation sets `is_published=false` and `revoked_at`; it never deletes history. Revoke EXECUTE from public, anon, authenticated, and service_role, grant only to `axsys_bff`, and revoke direct authenticated UPDATE of publication/revocation columns. All trigger functions remain executable only by the table owner.

Create `private.configure_public_certificate_portal(actor,session,slug,is_enabled,noindex,expected_version)` and `private.rotate_public_certificate_token(actor,session,expected_version)` under the same grants. They implement the lazy settings lifecycle and enforce the exact anchored 6–63 character slug regex `^[a-z0-9][a-z0-9-]{4,61}[a-z0-9]$` plus the same frozen reserved-word list in SQL, Zod, and route parsing. Initialization requires `expected_version=0` and succeeds only when no row exists under an advisory/company lock; updates/rotation require a positive exact version, and two concurrent first configurations yield one success plus one safe 409. Token generation is exactly `t_` plus unpadded base64url of 32 random bytes (`^t_[A-Za-z0-9_-]{43}$`); hash the complete prefixed value. The underscore makes token and lowercase slug namespaces disjoint, and the route classifies exactly one candidate before invoking SQL. They use CAS/advisory lock, return raw token only on insert/rotation, set app.actor_id after authorization, and audit without token/hash. Boundary tests cover 1, 5, 6, 63, and 64 slug characters, leading/trailing hyphen, uppercase, partial-match attempts, every reserved word, malformed/base64 token forms, and a cross-company slug/token collision attempt.

- [ ] **Step 4: Preserve default-deny Storage and exact-path capabilities**

Keep axsys-quarantine and axsys-private private. Do not add authenticated or anon policies to storage.objects: Plan 02 grants a signed capability only for the server-derived quarantine path, retains its quota hold through the full signed/TUS lifetime, and performs promotion/read through the authorized BFF for the exact stored object_path. Extend the server-side purpose allowlist so certificate objects use `${companyId}/certificate/${fileId}.${extension}`, keep `upsert: false`, and never accept a path, bucket, company_id, or object key from the browser. Explicitly ENABLE and FORCE RLS on every new public certificate table and do not create a public bucket; pgTAP inspects both RLS flags before any grant is accepted.

- [ ] **Step 5: Install the six required certificate types in every environment**

Insert the six idempotent global rows in the migration itself with `company_id=null` and `is_required=true`, so hosted environments receive them without depending on a development seed. Use `on conflict (company_id, code) do update set name=excluded.name, is_required=true, archived_at=null where (certificate_types.name,certificate_types.is_required,certificate_types.archived_at) is distinct from (excluded.name,true,null)`, so a no-op reset does not bump type version. The seed may verify/reapply that exact statement for local reset, but it is not the production source of truth. pgTAP asserts all six exist, are global, required, active, and satisfy the database code/name constraints. Use these codes and names:

    federal            Certidão Federal
    trabalhista        Certidão Trabalhista
    fgts               Certificado de Regularidade do FGTS
    estadual_debitos   Certidão Estadual (Débitos)
    estadual_divida    Certidão Estadual (Dívida Ativa)
    municipal          Certidão Municipal

- [ ] **Step 6: Reset and inspect the local schema**

Run:

    npm run db:reset
    npx supabase migration list --local
    npm run db:types

Expected: reset succeeds, the certificates_storage migration is marked applied, and both buckets are private.

- [ ] **Step 7: Commit**

Run:

    git add supabase/migrations supabase/seed.sql src/lib/supabase/database.types.ts
    git commit -m "feat: add certificate and private file schema"

### Task 3: Prove RLS and Storage isolation with pgTAP

**Files:**
- Create: supabase/tests/database/04_certificates_rls.test.sql

- [ ] **Step 1: Write failing tenant-isolation tests**

The pgTAP file must create two companies, one certificates user per company, and one certificate version per company inside a transaction through trusted fixtures/BFF operations. It must assert:

1. Company A selects only its certificate, version, and file metadata.
2. Company A cannot insert a certificate using Company B's type.
3. Company A cannot directly update company_id, file_id, valid_until, ordinal/state version, creator, publish/archive/revoke fields—even with same-tenant IDs.
4. Company A cannot publish Company B's version.
5. Company A cannot select, insert, update, or delete Company B's storage.objects path.
6. A normal authenticated user without the certificates module sees zero private rows.
7. An anon request sees zero rows in every private table.

Use `select no_plan()` because this file grows with the exhaustive grant/custom-type/download cases, set local role authenticated, set request.jwt.claims with each test user's sub/session, and finish with `select * from finish(); rollback;`.

- [ ] **Step 2: Run the test and confirm the missing policies fail**

Run:

    npx supabase test db supabase/tests/database/04_certificates_rls.test.sql

Expected: FAIL on the first unauthorized row that remains visible or writable.

- [ ] **Step 3: Add complete RLS, grants, and immutable mutation boundary**

In the generated migration, explicitly ENABLE and FORCE RLS on certificate_types, certificates, certificate_versions, and public_certificate_settings. Begin with `REVOKE ALL` from public, anon, authenticated, service_role, and axsys_bff. Grant authenticated only these exact SELECT columns: certificate_types `(id,company_id,code,name,is_required,archived_at,version,created_at,updated_at)`, certificates `(id,company_id,type_id,archived_at,created_at)`, and certificate_versions `(id,company_id,certificate_id,valid_until,is_published,published_at,revoked_at,superseded_at,archived_at,version,state_version,created_at,updated_at)`. Omit file/object paths and every actor ID; never grant the public-settings table/token hash. SELECT policies require active app session plus the certificates module and proper global/same-tenant type scope. There are no authenticated INSERT/UPDATE/DELETE grants or policies on any certificate table, and no Storage object grants/policies. The BFF role receives function EXECUTE only, never table DML. pgTAP asserts the exact column privilege set through `information_schema.column_privileges`, both RLS flags, and denial under public/anon/authenticated/service_role/axsys_bff.

All version rows are immutable after insert except locked publish/revoke/archive transitions. Create `private.create_certificate_version(actor,session,file_id,valid_until,correlation_id)` and `private.archive_certificate_version(actor,session,version_id,expected_state_version,correlation_id)`, fixed-empty-search-path SECURITY DEFINER, EXECUTE only for axsys_bff. Create locks ready upload intent and file, rejects storage_deleted/active retirement claim (or wins the shared lock and clears only a not-yet-deleted claim), derives tenant/certificate/creator, requires exact target/owner/purpose/ready/clean, prevents replay, assigns ordinal and inserts private version+audit. It accepts no company/version/creator/publication fields. Archive performs checks/CAS and rejects live publication. Direct PostgREST, wrong target/user, GC-vs-attach and replay tests fail safely.

Create three more restricted functions with the same fixed-empty-search-path/grant posture. A shared type trigger increments version/updated_at exactly once. `private.create_custom_certificate_type(actor,session,code,name,correlation_id)` derives the company, requires active company admin plus certificates, validates the exact code/name grammar, rejects all six reserved codes and inserts `is_required=false`; `private.archive_custom_certificate_type(actor,session,type_id,expected_version,correlation_id)` locks a same-company nonrequired type, applies exact CAS, archives it without changing linked certificates/history, and returns a safe 409 on a concurrent stale call. `private.get_public_certificate_settings(actor,session)` accepts no company/token/email input, derives the authorized company and returns only `(slug,is_enabled,noindex,version,updated_at)`; it never returns the alternate hash or updater. Revoke all five writers/readers from public, anon, authenticated, and service_role and grant only axsys_bff. Tests cover duplicate/cross-company/reserved types, archive CAS, linked-history preservation, forged/direct calls, safe settings reload, and absence of token hash in DTO/logs.

- [ ] **Step 4: Re-run pgTAP and advisors**

Run:

    npm run db:reset
    npx supabase test db supabase/tests/database/04_certificates_rls.test.sql
    npm run db:advisors
    npm run db:types

Expected: every named assertion passes and advisors report no RLS-disabled table or dangerous public security-definer function.

- [ ] **Step 5: Commit**

Run:

    git add supabase/migrations supabase/tests/database/04_certificates_rls.test.sql src/lib/supabase/database.types.ts
    git commit -m "test: enforce certificate and storage isolation"

### Task 4: Implement deterministic file policy validation

**Files:**
- Modify: src/modules/files/domain/file-types.ts
- Modify: src/modules/files/domain/upload-policy.ts
- Modify: tests/unit/files/upload-policy.test.ts

- [ ] **Step 1: Write failing policy tests**

Create cases for a clean PDF certificate, a PNG certificate, an oversized file, a renamed executable, SVG rejection, and MIME mismatch. Reuse FilePurpose from file-types.ts; the public API under test remains:

    export async function validateFile(input: {
      purpose: FilePurpose
      originalName: string
      declaredMime: string
      bytes: Buffer
    }): Promise<{ detectedMime: string; extension: string; byteSize: number; sha256: string }>

- [ ] **Step 2: Run the isolated test**

Run:

    npm run test:unit -- tests/unit/files/upload-policy.test.ts

Expected: FAIL with `UPLOAD_PURPOSE_NOT_ENABLED` for `certificate`; the frozen `validateFile` API from Plan 02 already exists.

- [ ] **Step 3: Implement exact allowlists and checks**

Extend the existing upload-policy.ts without changing its public signature. It must:

- use fileTypeFromBuffer for binary formats;
- normalize extensions to lowercase;
- require extension, declared MIME, and detected MIME to match the purpose allowlist;
- enable only the certificate addition in this plan: PDF, PNG, and JPEG up to 10 MiB, while preserving the already implemented branding rules and leaving later purposes disabled until their own plans;
- reject SVG, HTML, JavaScript, empty files, double extensions ending in an executable suffix, and any mismatch;
- return SHA-256 using node:crypto;
- preserve Plan 02's stable ApiError codes `FILE_TOO_LARGE`, `FILE_TYPE_MISMATCH`, `FILE_EXTENSION_MISMATCH`, and `FILE_MAGIC_BYTES_INVALID`; do not introduce competing names for the same failures.

- [ ] **Step 4: Run tests**

Run:

    npm run test:unit -- tests/unit/files/upload-policy.test.ts

Expected: all file-policy cases pass.

- [ ] **Step 5: Commit**

Run:

    git add src/modules/files/domain tests/unit/files/upload-policy.test.ts
    git commit -m "feat: validate uploaded files by content"

### Task 5: Implement quarantine, scanning, and promotion

**Files:**
- Create through CLI: supabase/migrations/*_certificate_upload_authorization.sql
- Modify: src/modules/files/server/create-upload-intent.ts
- Modify: src/modules/files/server/finalize-upload-intent.ts
- Modify: src/modules/files/server/authorize-file-download.ts
- Modify: src/lib/db/bff.ts
- Modify: tests/integration/files/upload-pipeline.test.ts
- Modify: src/app/api/files/uploads/route.ts
- Modify: src/app/api/files/uploads/[intentId]/finalize/route.ts

- [ ] **Step 1: Write failing upload-service tests**

Extend the existing dependency-injected upload tests with certificate-purpose cases. Cover clean promotion, infected deletion plus delayed capability retirement, scanner timeout, Storage failure, duplicate checksum, expired upload/finalize window, and cross-tenant purpose mismatch. Assert that no operational certificate metadata is created before a clean scan.

- [ ] **Step 2: Run the test**

Run:

    npm run test:integration -- tests/integration/files/upload-pipeline.test.ts

Expected: FAIL because certificate is not yet an enabled purpose in the shared policy/finalizer.

- [ ] **Step 3: Extend the existing upload service for certificate files**

Add certificate to the shared purpose union and map it to the 10 MiB PDF/JPG/PNG policy. PDF uses `preserve-validated-bytes`; images use `reencode-image`. Reuse the existing clamd INSTREAM client, quarantine bucket, bounded capability/retirement state machine, checksum verification, quota holds, and promotion service. Do not add a certificate-specific scanner or Storage client.

- [ ] **Step 4: Implement certificate finalization**

Generate `certificate_upload_authorization` through the CLI. Create `private.reserve_certificate_upload(actor,session,certificate_type_id,declared_name,declared_mime,declared_size,correlation_id)` and `private.authorize_certificate_file_download(actor,session,file_id,correlation_id)`, fixed-empty-search_path, EXECUTE only for axsys_bff. Reservation verifies active certificates module and a global/same-tenant nonarchived type, then under an advisory/type lock inserts-or-selects the tenant certificate collection using the unique `(company_id,type_id)` constraint. It then calls the single Plan 02 `reserve_upload_capability_core` so path, `2 * declared_size` hold, quota lock, three/100-MiB per-user caps and status reserved cannot diverge; `target_resource_id` is the resulting certificate.id. The generic activation function performs reserved→issued and fixes the two-hour signed-authorization plus 24h15m TUS cleanup-grace deadlines, returning certificateId with the handshake. Thus the first certificate has a valid target, and two concurrent first uploads converge on one collection. Download joins file→certificate_version→certificate, rechecks tenant/module plus ready/clean, calls Plan 02's owner-only audit-attempt core, and returns exact server metadata plus attemptId/completionNonce. Add typed bffDb methods; no direct intent INSERT or generic file policy is opened.

The shared finalize operation must accept purpose certificate, derive company/user/target from the reserved intent, download the completed quarantine object server-side, validate content, scan, reencode images only, preserve validated PDF bytes, promote to axsys-private, verify final SHA-256, retain clean quarantine content until safe capability retirement (so `upsert:false` blocks reuse), and atomically convert only the promotion quota slot to used plus persist ready/clean metadata. On infected or failed scans, delete quarantine content immediately but keep the capability hold and schedule the mandatory post-window deletion; release it only through the shared retirement function. Persist an audit event without the body.

- [ ] **Step 5: Implement the authenticated upload route**

The existing POST /api/files/uploads must accept purpose certificate and the existing POST /api/files/uploads/[intentId]/finalize must finalize it. Keep the generic route context guard and extend the server-side purpose authorization so `certificate` requires `requireCompanyContext('certificates')`; other purposes retain their own existing module/role rule. Both handlers must:

1. validate CSRF and Origin;
2. call the shared purpose-authorizer, which invokes `requireCompanyContext('certificates')` and `bffDb.reserveCertificateUpload` only when purpose is certificate and preserves the other purpose rules;
3. reject a tenant, object path, purpose, or owner supplied by the browser;
4. require the expected byte size and normalized original name during initiation;
5. return only the signed exact-path quarantine upload details and safe deadlines from POST;
6. invoke the existing `finalizeUploadIntent` service from POST;
7. return status 201 after finalization with only id, originalName, detectedMime, byteSize, and scanStatus;
8. return no-store headers and a correlation ID.

- [ ] **Step 6: Run tests with ClamAV**

Run:

    npm run db:reset
    npm run db:test
    npm run db:types
    npm run files:start
    npm run test:integration -- tests/integration/files/upload-pipeline.test.ts

Expected: all unit cases pass; the EICAR integration fixture is classified as infected and is absent from the operational bucket.

- [ ] **Step 7: Commit**

Run:

    CERTIFICATE_UPLOAD_MIGRATION="$(find supabase/migrations -type f -name '*_certificate_upload_authorization.sql' | sort | tail -1)"
    test -n "$CERTIFICATE_UPLOAD_MIGRATION"
    git add "$CERTIFICATE_UPLOAD_MIGRATION" src/lib/db/bff.ts src/lib/supabase/database.types.ts src/modules/files src/app/api/files/uploads tests/integration/files/upload-pipeline.test.ts
    git commit -m "feat: quarantine and scan certificate uploads"

### Task 6: Implement validity and version history as pure domain logic

**Files:**
- Create: src/modules/certificates/domain/certificate-history.ts
- Create: tests/unit/certificates/certificate-history.test.ts

- [ ] **Step 1: Write failing history tests**

Cover validity at 23:59:59.999 in America/Fortaleza, expiration one millisecond later, two simultaneously valid versions, no valid version, archived/revoked/unclean/not-ready candidates, equal timestamps/IDs, ordinal version disagreeing with createdAt, and published versions. Use a fixed clock and assert current, history, expired, and operationalFallback collections plus exact SQL parity fixtures.

- [ ] **Step 2: Run the test**

Run:

    npm run test:unit -- tests/unit/certificates/certificate-history.test.ts

Expected: FAIL because buildCertificateHistory does not exist.

- [ ] **Step 3: Implement the selector**

Export `isCertificateValid(validUntil,now,timeZone)` and `buildCertificateHistory(versions,now,timeZone)`. Derive company-local `asOfDate` once. A current candidate must be nonarchived, nonrevoked, `fileStatus='ready'`, `scanStatus='clean'`, and `validUntil >= asOfDate`; choose the greatest `(version,createdAt,id)` tuple, exactly matching SQL. History remains immutable and can display rejected/revoked/archived rows with explicit status, but `operationalFallback` may use only nonarchived/nonrevoked ready/clean rows ordered by the same tuple while ignoring validity. Do not mutate input arrays. A shared parity fixture is consumed by TypeScript unit tests and pgTAP so publication, public read, formalization and alerts cannot redefine eligibility/order.

- [ ] **Step 4: Run the test**

Run:

    npm run test:unit -- tests/unit/certificates/certificate-history.test.ts

Expected: all fixed-clock cases pass.

- [ ] **Step 5: Commit**

Run:

    git add src/modules/certificates/domain tests/unit/certificates/certificate-history.test.ts
    git commit -m "feat: derive certificate validity and history"

### Task 7: Implement certificate use cases and concurrency control

**Files:**
- Create: src/modules/certificates/schemas/certificate-input.ts
- Create: src/modules/certificates/server/certificate-repository.ts
- Create: src/modules/certificates/server/certificate-service.ts
- Create: tests/integration/certificates/certificate-service.test.ts
- Create: src/modules/certificates/actions/certificate-actions.ts
- Modify: src/lib/db/bff.ts

- [ ] **Step 1: Write failing service tests**

Cover custom type create/archive (including six reserved codes and linked-history preservation), first-type reservation creating the collection, two concurrent first reservations converging on one certificate ID, create version only when the ready upload intent target equals that certificate, reject a file reserved for another same-tenant certificate/user, reject non-clean/wrong-tenant/replayed file, list current/history, archive a nonpublished version, reject archiving a live published version until revocation, publish only the shared current-valid selector, allow older still-valid v1 when newer v2 is expired, reject any noncurrent/expired target, upload a new valid version after publication and prove the old one is immediately unpublic while the new one awaits explicit publish, two concurrent publication attempts leaving exactly one live version, publish-vs-revoke/double-revoke/double-archive CAS races producing one transition/audit and one safe 409, first public-settings initialization, safe settings reload, slug collision/reserved slug, enable/disable CAS, token shown once/rotation, and settings version mismatch.

- [ ] **Step 2: Run the service test**

Run:

    npm run test:integration -- tests/integration/certificates/certificate-service.test.ts

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement schemas and repository**

Use Zod schemas that accept UUIDs and ISO dates only, strip unknown fields, and never accept company_id, created_by, is_published, or version from the browser. Repository methods must take AccessContext first, require kind company, and always filter by context.companyId.

- [ ] **Step 4: Implement services and actions**

Service methods must be createCustomType, archiveCustomType, createVersion, listCollections, archiveVersion, publishVersion, revokeVersion, getPublicPortalSettings, configurePublicPortal, and rotateAlternateToken. Every mutation calls its exact typed private BFF function; repositories perform SELECT-only RLS reads, while settings reload uses only `bffDb.getPublicCertificateSettings` because the settings table is never selectable. Only company admins with certificates access can mutate types/publish/revoke/configure/rotate; all sensitive public-setting changes require recent authentication. Publication/revocation/settings never use direct service-role/table writes.

`configurePublicPortal` uses the exact anchored normalized slug regex `^[a-z0-9][a-z0-9-]{4,61}[a-z0-9]$` (6–63 characters) and the same reserved-word denylist as SQL/route, plus `isEnabled`, `noindex`, and expectedVersion. The first call requires expectedVersion 0, lazily inserts the settings row, generates the exact prefixed base64url token inside the function, stores only SHA-256, and returns the raw alternate token exactly once; later CAS updates never return it. `rotateAlternateToken` requires a positive exact version, replaces the hash and returns a new raw token once. Duplicate slug is a neutral 409; disabling is immediate. This explicit lazy initializer means no company backfill/default row is required, while every future company can configure the portal.

The locked database operations enforce latest-version/one-live-publication and settings CAS; archiving a published version is rejected until revocation. Each successful mutation writes one audit in the transaction and returns exact invalidation resources for certificates, dashboard, notifications, and public-certificates; the client passes them to mutation-sync only after the committed response.

- [ ] **Step 5: Run tests**

Run:

    npm run test:integration -- tests/integration/certificates/certificate-service.test.ts

Expected: all authorization, concurrency, and audit assertions pass.

- [ ] **Step 6: Commit**

Run:

    git add src/modules/certificates src/lib/db/bff.ts tests/integration/certificates/certificate-service.test.ts
    git commit -m "feat: add certificate version workflows"

### Task 8: Build the responsive authenticated certificate interface

**Files:**
- Create: src/modules/certificates/components/certificate-dashboard.tsx
- Create: src/modules/certificates/components/certificate-card.tsx
- Create: src/modules/certificates/components/certificate-filters.tsx
- Create: src/modules/certificates/components/certificate-upload-sheet.tsx
- Create: src/modules/certificates/components/certificate-states.tsx
- Create: src/app/(protected)/app/certidoes/page.tsx
- Create: src/app/(protected)/app/certidoes/loading.tsx
- Create: src/app/(protected)/app/certidoes/error.tsx
- Create: tests/unit/certificates/certificate-components.test.tsx

- [ ] **Step 1: Write component tests for every visible state**

Test summary counts, current/expired/history filters, empty state, custom type create/archive/version conflict, reserved-code error and linked-history preservation, upload validation error, scanner pending state, publish confirmation, revoke confirmation, download action, conflict banner, first portal configuration, safe settings reload, unique slug error, token shown/copyable once then hidden, rotate confirmation, enable→public→disable, and keyboard focus return after closing sheets/dialogs.

- [ ] **Step 2: Run the component tests**

Run:

    npm run test:unit -- tests/unit/certificates/certificate-components.test.tsx

Expected: FAIL because the certificate components are absent.

- [ ] **Step 3: Implement Server Component data loading**

page.tsx must export dynamic = 'force-dynamic', call requireCompanyContext('certificates'), and fetch fresh collections through the request-scoped no-store Supabase client. It renders a server shell and passes serializable view models to the interactive filters and upload sheet. It must not instantiate Supabase or QueryClient at module scope.

- [ ] **Step 4: Implement the UI**

Use customized shadcn primitives, Geist, and Phosphor icons. Desktop uses a two-column asymmetric summary plus certificate grid; mobile uses one-column cards and a full-screen Sheet. `certificate-type-manager.tsx` lets Company Admin create/archive only custom types with expected-version conflicts and keeps archived linked history visible. `public-portal-settings.tsx` reads only the safe BFF DTO and lets company admins configure slug/noindex/enabled state with version CAS and recent authentication; raw alternate token appears once after initialize/rotate with copy/acknowledge, is never recoverable, and is cleared from component state on close. Status is expressed by icon, label, and restrained color. Include matched skeletons, empty guidance, inline errors, disabled pending actions, 44-pixel targets, reduced-motion support, and no neon/glow.

- [ ] **Step 5: Implement mutation refresh**

After every successful action, close the sheet only after the server response, publish a BroadcastChannel invalidation, refresh certificate/dashboard/notification queries, and call router.refresh. Do not optimistically publish, revoke, or archive.

- [ ] **Step 6: Run tests and accessibility checks**

Run:

    npm run test:unit -- tests/unit/certificates/certificate-components.test.tsx
    npm run typecheck

Expected: tests and TypeScript pass with no accessibility query failure.

- [ ] **Step 7: Commit**

Run:

    git add 'src/app/(protected)/app/certidoes' src/modules/certificates/components tests/unit/certificates/certificate-components.test.tsx
    git commit -m "feat: add responsive certificate management"

### Task 9: Build the public no-cache certificate portal and downloads

**Files:**
- Create: src/app/(public)/public/certidoes/[identifier]/page.tsx
- Create: src/modules/certificates/ui/public-certificate-live-list.tsx
- Create: src/app/api/public/certificates/[identifier]/route.ts
- Create: src/app/api/public/certificates/[identifier]/[versionId]/download/route.ts
- Modify: src/app/api/files/[fileId]/download/route.ts
- Create through CLI: supabase/migrations/*_certificate_public_read_rpcs.sql
- Create: src/modules/certificates/server/public-certificate-service.ts
- Modify: src/lib/db/bff.ts
- Create: tests/integration/certificates/download-routes.test.ts
- Modify: src/proxy.ts

- [ ] **Step 1: Write route tests**

Cover valid slug, valid alternate token, disabled publication, revoked version, expired version, unpublished history, wrong version ID, listing-poll and download rate limits, noindex metadata, no-store headers, authenticated same-tenant download, and cross-tenant download.

- [ ] **Step 2: Run route tests**

Run:

    npm run test:integration -- tests/integration/certificates/download-routes.test.ts

Expected: FAIL because the handlers do not exist.

- [ ] **Step 3: Create a least-privilege public-read boundary**

Run:

    npx supabase migration new certificate_public_read_rpcs
    PUBLIC_READ_MIGRATION="$(find supabase/migrations -type f -name '*_certificate_public_read_rpcs.sql' | sort | tail -1)"
    test -n "$PUBLIC_READ_MIGRATION"

In that exact emitted file, freeze two separate fixed-empty-search_path SECURITY DEFINER signatures:

    private.read_public_certificate_portal(
      p_normalized_slug text, p_token_sha256 text, p_correlation_id uuid
    ) returns jsonb

    private.authorize_public_certificate_download(
      p_normalized_slug text, p_token_sha256 text,
      p_version_id uuid, p_correlation_id uuid
    ) returns jsonb

The route passes exactly one non-null identifier candidate—slug only for the anchored lowercase grammar, token hash only for exact `^t_[A-Za-z0-9_-]{43}$`—and rejects both-or-neither; SQL repeats this and never receives raw token. The listing return is exact `{legalName,publicCode,noindex,revision,certificates:[{versionId,typeCode,typeName,validUntil}]}` where `publicCode` is the configured public slug and revision is a hash of that safe projection. No company ID, file ID, actor, history, token/hash/path/checksum or extra key is permitted; the service alone adds canonical downloadHref from identifier+versionId. The authorizer must join the exact `p_version_id` to that same enabled/current published projection, then returns server-only `{bucket,objectPath,mime,byteSize,sha256,safeFilename,attemptId,completionNonce}`. Unknown identifier/version use identical query/status/body/timing. Both derive company-local date once, require active company, enabled settings, exact shared current selector, live publication, ready/clean file and all company joins. After successful download authorization the second calls Plan 02's owner-only attempt core with null actor/session and derived company/version. Company archive disables list/download immediately; reactivation restores otherwise-live publications.

Revoke EXECUTE from public, anon, authenticated, and service_role; grant only to restricted axsys_bff and add only these exact signatures to its facade. Contract tests assert JSON key equality recursively (no extra field), legalName/publicCode/type/version/validUntil, direct-call denial, and that disabled/revoked/expired/foreign/random version/token mismatch return the same empty result. Only the authorizer's server DTO contains path/hash.

- [ ] **Step 4: Implement the public query, live leaf, and page**

The page must export `dynamic = 'force-dynamic'`, use `public-certificate-service.ts` through the restricted BFF function, resolve a slug or exact prefixed alternate-token hash, return `notFound()` without distinguishing causes, and select only clean, unexpired, currently published versions. Apply two atomic buckets to each request: global IP and IP+identifier; freeze separate limits as page 30/minute + 120/hour per IP and 20/minute per pair, poll 120/minute + 600/hour per IP and 90/minute per pair, and download 20/minute + 100/hour per IP and 10/minute per pair. N succeeds and N+1 gets a generic 429 with bounded Retry-After; unknown/known identifiers consume identical buckets, so rotating slugs cannot evade the IP cap. `generateMetadata` sets HTML robots: stored noindex controls ordinary slugs, while alternate-token access is always noindex,nofollow. `src/proxy.ts` applies `Referrer-Policy: no-referrer` to `/public/certidoes/*` and both public certificate API grammars, and always adds `X-Robots-Tag: noindex, nofollow` to token-shaped paths; a slug with stored noindex false relies on its HTML `index,follow` metadata because proxy cannot inspect DB state. Tests cover all three HTML cases, token-path header, no referrer leakage, and page/poll/download bucket independence. Do not return file paths, internal IDs beyond the public version identifier, user IDs, history, or private metadata.

Because the anonymous page does not mount protected Realtime providers, render a small `PublicCertificateLiveList` client leaf with the initial safe projection and an opaque revision hash. While visible, it fetches `GET /api/public/certificates/[identifier]` every 15 seconds with `cache:'no-store'`; it also refetches immediately on focus, online, and pageshow. The route reruns the exact restricted public BFF query, rate-limits by IP plus SHA-256 identifier hash for this cadence, and returns only `{ revision, certificates }` with `Cache-Control: no-store`, `Pragma: no-cache`, appropriate `Vary`, and the same generic 404 for unknown/disabled/revoked outcomes. Revision is a server SHA-256 of the already-public canonical projection and leaks no extra state. The leaf atomically replaces its displayed safe view model only after a successful fresh response, switches to the generic unavailable state on 404, aborts requests/timers on hide/unmount, and never persists the identifier, response, or revision. This is authoritative polling, not a business cache.

All public listing/download telemetry uses a fixed route template plus correlation ID and at most a short SHA-256 identifier prefix. Application code must never log `request.url`, route params, raw identifier, referrer, or full hash; tests feed a realistic `t_...` URL through success/error paths and source-scan for unsafe logging. Production runbooks require CDN/reverse-proxy access-log suppression or path-template redaction for `/public/certidoes/*` and `/api/public/certificates/*`, including download segments.

- [ ] **Step 5: Implement streaming downloads**

The public download handler calls the restricted public download function on every request, consumes both download buckets, reads only the returned exact object path server-side, and passes its already-created attemptId/completionNonce to the Plan 02 audited streamer. Completion/abort records only outcome/byte class/correlation, never identifier/path/name/hash/token. The response uses Content-Disposition attachment, X-Content-Type-Options nosniff, Cache-Control no-store, CSP sandbox, and a safe normalized filename. The authenticated handler dispatches to `bffDb.authorizeCertificateFileDownload`, then the same audited hash/size-verifying streamer. Neither endpoint redirects to a Storage URL or exposes the raw path.

- [ ] **Step 6: Run tests**

Run:

    npm run test:integration -- tests/integration/certificates/download-routes.test.ts
    npm run typecheck

Expected: all route, header, redaction, and tenant assertions pass.

- [ ] **Step 7: Commit**

Run:

    PUBLIC_READ_MIGRATION="$(find supabase/migrations -type f -name '*_certificate_public_read_rpcs.sql' | sort | tail -1)"
    test -n "$PUBLIC_READ_MIGRATION"
    git add "$PUBLIC_READ_MIGRATION" src/modules/certificates/server/public-certificate-service.ts src/modules/certificates/ui/public-certificate-live-list.tsx src/lib/db/bff.ts src/proxy.ts 'src/app/(public)/public/certidoes' src/app/api/public/certificates 'src/app/api/files/[fileId]' tests/integration/certificates/download-routes.test.ts
    git commit -m "feat: publish certificates through revocable portal"

### Task 10: Verify end-to-end security, responsiveness, and freshness

**Files:**
- Create: tests/e2e/certificates.private.spec.ts
- Create: tests/e2e/certificates.public.spec.ts
- Create: tests/e2e/certificates.security.spec.ts

- [ ] **Step 1: Write private-flow E2E tests**

Exercise upload, visible scan progress, version creation, current/history filters, publication, revocation, deletion restriction, dark/light themes, keyboard operation, 390-pixel mobile, 768-pixel tablet, and 1440-pixel desktop.

- [ ] **Step 2: Write public and adversarial E2E tests**

Use a Company A admin context plus a separate anonymous visitor context. Exercise public current download, revoked link, manipulated company/version/file IDs, HTML in certificate names, MIME spoofing, EICAR rejection, two protected tabs receiving refresh, and Company A never observing Company B records or events. Archive/suspend the company and assert both slug/token listing and download become the same neutral 404 immediately; reactivate and assert an otherwise-live publication returns. In the already-open visitor page, publish a new current version and then revoke it from the admin context; assert visible polling/focus updates the public list within 20 seconds without hard reload, protected BroadcastChannel, shared cookies, or Realtime auth, while the download endpoint denies immediately because every request reauthorizes.

- [ ] **Step 3: Run the database, app, scanner, and E2E suite**

Run:

    npm run db:start
    npm run db:reset
    npm run files:start
    npm run test:e2e -- tests/e2e/certificates.private.spec.ts tests/e2e/certificates.public.spec.ts tests/e2e/certificates.security.spec.ts

Expected: Playwright starts/reuses the app through its configured webServer; every scenario passes with no console error and no request returning Company B data to Company A.

- [ ] **Step 4: Run the complete verification gate**

Run:

    npm run lint
    npm run typecheck
    npm run test:unit
    npm run test:integration
    npm run db:test
    npm run db:advisors
    npm run db:types
    npm run build

Expected: all commands exit 0; advisors have no security finding; build emits no dynamic-route cache warning for private or public certificate pages.

- [ ] **Step 5: Commit**

Run:

    git add tests/e2e src/lib/supabase/database.types.ts
    git commit -m "test: verify certificate security and freshness"
