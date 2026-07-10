# Axsys 02 — Portal de Plataforma, Usuários e Configurações Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o portal `/platform`, a administração segura de empresas, administradores, usuários, módulos e contas bancárias, além de perfil, tema, uploads institucionais e configurações empresariais com isolamento multiempresa verificável.

**Architecture:** O plano estende a base do plano 01 em um monólito modular Next.js 16.2.10: Server Components fazem leitura fresca no servidor, Client Components ficam restritos a folhas interativas e toda mutação atravessa BFF com Origin, CSRF, autorização e resposta `no-store`. Operações administrativas usam RPCs transacionais com allowlist e auditoria; criações que atravessam Supabase Auth e PostgreSQL usam saga persistida, idempotência e compensação. Arquivos entram por TUS em quarentena privada, são validados, reencodados, escaneados e promovidos antes de se tornarem referenciáveis.

**Tech Stack:** Next.js 16.2.10 App Router, React 19.2.7, TypeScript strict, Supabase CLI 2.109.1/Auth/PostgreSQL/RLS/Storage, TanStack Query, Vitest, Testing Library, pgTAP, Playwright, Zod, `file-type@22.0.1`, `sharp@0.35.3`, `tus-js-client@4.3.1`, ClamAV `clamav/clamav:1.5.3`, shadcn 4.13.0 customizado, Geist/Geist Mono e `@phosphor-icons/react@2.1.10`.

---

## Contrato de entrada do plano 01

Este plano parte de uma execução completa do plano 01. Antes de iniciar, confirme que estes contratos existem; não os duplique nem mude seus nomes:

- Supabase: `src/lib/supabase/browser.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `src/lib/supabase/proxy.ts` e `src/proxy.ts`.
- Auth: `src/modules/auth/domain/access-context.ts`, `src/modules/auth/schemas/auth-schemas.ts`, `src/modules/auth/server/get-access-context.ts`, `src/modules/auth/server/guards.ts`, `src/modules/auth/server/password-policy.ts`, `src/modules/auth/server/set-temporary-password.ts` e `src/modules/auth/server/change-temporary-password.ts`.
- Guardas: `requireAccessContext()`, `requirePlatformContext()`, `requireCompanyContext(requiredModule?)` e `requireRecentAuthentication(context,maxAgeSeconds?)`, sempre baseadas em `getClaims()`, nunca em `getSession()` para autorização.
- Segurança: `src/lib/security/csrf.ts`, `src/lib/security/origin.ts`, `src/lib/security/rate-limit.ts`, `src/lib/security/no-store.ts` e `src/lib/security/redact.ts`.
- HTTP: `src/lib/http/api-error.ts`, `src/lib/http/error-response.ts` e `src/lib/http/correlation-id.ts`, com envelope `{ error: { code, message, correlationId, fieldErrors? } }`.
- Consulta/sincronização: `src/lib/query/query-client.ts`, `src/lib/query/query-keys.ts`, `src/lib/query/query-provider.tsx`, `src/lib/query/mutation-sync.tsx` e `src/lib/realtime/invalidation-channel.ts`.
- Shells: `src/app/(protected)/platform/layout.tsx`, `src/app/(protected)/app/layout.tsx`, `src/components/layout/platform-shell.tsx`, `src/components/layout/company-shell.tsx`, `src/components/providers/app-providers.tsx` e `src/components/providers/scoped-providers.tsx`.
- Tema/design: `src/lib/theme/theme-provider.tsx`, `src/app/globals.css`, componentes shadcn em `src/components/ui/`, Geist e Geist Mono.
- Tabelas: `profiles`, `platform_roles`, `companies`, `company_memberships`, `member_modules`, `audit_events`, `security_events` e `idempotency_keys`.
- Helpers SQL privados: `private.has_platform_role()`, `private.is_active_company_member(uuid)`, `private.has_company_role(uuid, membership_role)` e `private.has_module(uuid, module_key)`.
- Auditoria: `src/modules/audit/server/write-audit-event.ts` exporta `writeAuditEvent(input: AuthenticatedAuditEventInput): Promise<void>`. Use-o apenas quando o evento não puder participar da transação SQL; RPCs deste plano inserem o evento na própria transação.
- Testes: `tests/unit`, `tests/integration`, `tests/e2e`, helpers em `tests/helpers/` e pgTAP em `supabase/tests/database/`.

O `AccessContext` permanece discriminado:

```ts
type AccessContext =
  | {
      kind: 'platform'
      userId: string
      sessionId: string
      authenticatedAt: number
      profile: { displayName: string; email: string; preferredTheme: 'dark' | 'light'; version: number }
    }
  | {
      kind: 'company'
      userId: string
      sessionId: string
      authenticatedAt: number
      companyId: string
      membershipId: string
      role: 'company_admin' | 'member'
      modules: readonly ('administrative' | 'financial' | 'certificates')[]
      profile: { displayName: string; email: string; preferredTheme: 'dark' | 'light'; version: number }
    }
```

As chaves de consulta sempre começam por `['axsys', userId, companyId ?? 'platform']`. Dados autenticados nunca usam `'use cache'`, Data Cache, Full Route Cache, Service Worker ou persistência de TanStack Query.

## Limites e decisões que não podem variar

- `/platform` e `/app` compartilham login, mas não shell, menu, layout nem autorização. `src/proxy.ts` faz somente o redirecionamento grosseiro; cada page, route handler, serviço e RPC repete a guarda efetiva.
- Super Admin não recebe policy universal para tabelas de tenant. CRUD de plataforma usa métodos tipados de `bffDb` e funções `private.internal_*` executáveis apenas por `axsys_bff`, que revalidam ator/sessão em `platform_roles`; o facade não expõe SQL bruto.
- CRUD empresarial comum usa o cliente Supabase do usuário e continua sujeito a RLS. `service_role` fica limitado a Auth Admin e operações de Storage no path exato; nenhum CRUD de tabela ou RPC de domínio usa a chave secreta.
- Toda função `private.internal_*` deste plano valida actor+session+papel primeiro e então define transaction-local `app.actor_id`; create/archive/reactivate company, membership/module, bank, profile/settings, quota/file finalize e auditoria devem continuar funcionando quando os triggers de invalidação do plano 06 forem instalados. Testes finais do plano 06 repetem cada uma dessas mutações.
- Senha provisória nunca é persistida, retornada, auditada ou logada. Ela expira em 24 horas, define `must_change_password`, invalida a continuidade do acesso normal e obriga a rota de troca já entregue pelo plano 01.
- Conta bancária, agência e documento do titular são cifrados com AES-256-GCM no servidor. Banco recebe apenas ciphertext, IV, tag, versão de chave e últimos quatro caracteres mascaráveis.
- Assets de perfil e institucionais aceitam PNG, JPG ou WebP, no máximo 5 MiB. O browser nunca recebe `service_role`: recebe um token de upload assinado para um único path aleatório de quarentena e o envia em `x-signature` ao endpoint TUS.
- Os componentes visuais seguem variance 5, motion 3 e density 6. Não usar Lucide, neon, gradiente decorativo, glassmorphism ou animação perpétua. Estados usam texto, ícone Phosphor e cor.
- Breakpoints de aceite: móvel `<640px`, tablet `640–1023px`, desktop `>=1024px`; todo alvo interativo mede pelo menos 44 px.

## Mapa de arquivos

### Banco, ambiente e segurança

- Create via CLI: migration com sufixo `_platform_users_settings_schema.sql` — tipos, tabelas, constraints, índices e buckets.
- Create via CLI: migration com sufixo `_platform_users_settings_rls.sql` — policies, grants, views seguras e proteção do último admin.
- Create via CLI: migration com sufixo `_file_upload_finalize_rpc.sql` — promoção/metadata/auditoria atômicas.
- Create via CLI: migration com sufixo `_download_audit_rpcs.sql` — tentativa autorizada e conclusão de todo stream privado/público.
- Create via CLI: migration com sufixo `_platform_company_provisioning_rpcs.sql` — saga empresa + primeiro admin.
- Create via CLI: migration com sufixo `_platform_company_management_rpcs.sql` — update/archive/reactivate com versão.
- Create via CLI: migration com sufixo `_company_membership_management_rpcs.sql` — admins, membros, módulos e reset.
- Create via CLI: migration com sufixo `_platform_bank_account_rpcs.sql` — contas/default/archive concorrentes.
- Create via CLI: migration com sufixo `_profile_settings_rpcs.sql` — display name, avatar e sincronização de e-mail confirmado.
- Create via CLI: migration com sufixo `_company_settings_rpcs.sql` — rascunho, configuração e attach de branding.
- Create: `supabase/tests/database/platform_users_settings_schema.test.sql`.
- Create: `supabase/tests/database/platform_users_settings_rls.test.sql`.
- Create: `supabase/tests/database/platform_users_settings_concurrency.test.sql`.
- Create: `docker-compose.files.yml`.
- Modify: `.env.example`.
- Modify: `package.json` e `package-lock.json`.
- Create: `src/lib/security/envelope-encryption.ts`.

### Arquivos compartilhados

- Create: `src/modules/files/domain/file-types.ts`.
- Create: `src/modules/files/domain/upload-policy.ts`.
- Create: `src/modules/files/server/clamav-client.ts`.
- Create: `src/modules/files/server/image-normalizer.ts`.
- Create: `src/modules/files/server/file-repository.ts`.
- Create: `src/modules/files/server/create-upload-intent.ts`.
- Create: `src/modules/files/server/finalize-upload-intent.ts`.
- Create: `src/modules/files/server/authorize-file-download.ts`.
- Create: `src/modules/files/ui/use-resumable-upload.ts`.
- Create: `src/modules/files/ui/image-upload-field.tsx`.
- Create: `src/app/api/files/uploads/route.ts`.
- Create: `src/app/api/files/uploads/[intentId]/finalize/route.ts`.
- Create: `src/app/api/files/[fileId]/download/route.ts`.
- Create: `src/modules/files/server/audited-download-streamer.ts`.

### Plataforma, empresas, usuários, bancos e auditoria

- Create: `src/modules/platform/domain/platform-types.ts`.
- Create: `src/modules/platform/schemas/platform-schemas.ts`.
- Create: `src/modules/platform/server/platform-repository.ts`.
- Create: `src/modules/platform/server/platform-health.ts`.
- Create: `src/modules/companies/schemas/company-schemas.ts`.
- Create: `src/modules/companies/server/company-provisioner.ts`.
- Create: `src/modules/companies/server/company-service.ts`.
- Create: `src/modules/users/schemas/user-schemas.ts`.
- Create: `src/modules/users/server/auth-admin-gateway.ts`.
- Create: `src/modules/users/server/user-provisioner.ts`.
- Create: `src/modules/users/server/user-service.ts`.
- Modify/reuse: `src/modules/auth/server/set-temporary-password.ts`.
- Create: `src/modules/bank-accounts/schemas/bank-account-schemas.ts`.
- Create: `src/modules/bank-accounts/server/bank-account-crypto.ts`.
- Create: `src/modules/bank-accounts/server/bank-account-service.ts`.
- Create: `src/modules/audit/server/list-platform-audit-events.ts`.
- Create: `src/modules/audit/ui/platform-audit-table.tsx`.
- Create: `src/modules/platform/ui/platform-dashboard.tsx`.
- Create: `src/modules/platform/ui/company-list.tsx`.
- Create: `src/modules/platform/ui/company-form.tsx`.
- Create: `src/modules/platform/ui/company-detail.tsx`.
- Create: `src/modules/platform/ui/admin-form.tsx`.
- Create: `src/modules/platform/ui/bank-account-dialog.tsx`.
- Create: `src/modules/platform/ui/platform-health-panel.tsx`.
- Create: route handlers sob `src/app/api/platform/companies/`, `src/app/api/platform/admins/`, `src/app/api/platform/audit/` e `src/app/api/platform/health/` detalhados nas tarefas.
- Create: pages sob `src/app/(protected)/platform/` detalhadas nas tarefas.

### Portal empresarial e configurações

- Create: `src/modules/settings/schemas/profile-schemas.ts`.
- Create: `src/modules/settings/schemas/company-settings-schemas.ts`.
- Create: `src/modules/settings/server/profile-service.ts`.
- Create: `src/modules/settings/server/company-settings-service.ts`.
- Create: `src/modules/settings/server/company-settings-draft-service.ts`.
- Create: `src/modules/settings/ui/profile-form.tsx`.
- Modify: `src/components/theme/theme-toggle.tsx`.
- Create: `src/modules/settings/ui/company-settings-form.tsx`.
- Create: `src/modules/settings/ui/company-bank-accounts-readonly.tsx`.
- Create: `src/modules/users/ui/company-users-page.tsx`.
- Create: `src/modules/users/ui/user-form.tsx`.
- Create: `src/modules/users/ui/reset-password-dialog.tsx`.
- Create: route handlers sob `src/app/api/company/users/`, `src/app/api/company/settings/` e `src/app/api/profile/` detalhados nas tarefas.
- Create: `src/app/(protected)/app/usuarios/page.tsx`.
- Create: `src/app/(protected)/app/configuracoes/perfil/page.tsx`.
- Create: `src/app/(protected)/app/configuracoes/empresa/page.tsx`.
- Modify: `src/components/layout/platform-shell.tsx`, `src/components/layout/company-shell.tsx`, `src/components/providers/scoped-providers.tsx`, `src/lib/db/bff.ts`, `src/lib/query/query-keys.ts`, `src/lib/query/mutation-sync.tsx` e `src/lib/theme/theme-provider.tsx`.

### Testes TypeScript e navegador

- Create: `tests/unit/security/envelope-encryption.test.ts`.
- Create: `tests/unit/files/upload-policy.test.ts`.
- Create: `tests/unit/settings/company-settings-schema.test.ts`.
- Create: `tests/unit/bank-accounts/bank-account-crypto.test.ts`.
- Create: `tests/integration/files/upload-pipeline.test.ts`.
- Create: `tests/integration/platform/company-provisioner.test.ts`.
- Create: `tests/integration/platform/company-api.test.ts`.
- Create: `tests/integration/platform/bank-accounts-api.test.ts`.
- Create: `tests/integration/users/company-users-api.test.ts`.
- Create: `tests/integration/users/temporary-password.test.ts`.
- Create: `tests/integration/settings/profile-api.test.ts`.
- Create: `tests/integration/settings/company-settings-api.test.ts`.
- Create: `tests/integration/security/idor-cache-concurrency.test.ts`.
- Create: `tests/e2e/platform-companies.spec.ts`.
- Create: `tests/e2e/company-users-settings.spec.ts`.
- Create: `tests/e2e/responsive-accessibility.spec.ts`.

## Convenção obrigatória para migrations

Nunca crie um nome com timestamp manual. Cada tarefa SQL abaixo fornece seu comando `npx supabase migration new` e sufixo concretos. Edite exatamente o path impresso pelo CLI; quando a tarefa definir `MIGRATION_PATH`, resolva somente o sufixo concreto daquela tarefa com `find`, confirme `test -n "$MIGRATION_PATH"` e nunca reutilize uma variável de outra migration.

O segundo comando deve terminar com status 0 e nenhuma saída.

Depois de aplicar cada migration deste plano, rode `npm run db:types`, depois `npm run typecheck`, e inclua `src/lib/supabase/database.types.ts` no mesmo commit da migration. Não acumule tipos desatualizados entre tasks.

### Task 1: Fixar dependências, scanner local e primitivas de criptografia

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Modify: `scripts/provision-local-env.ts`
- Modify: `src/lib/env/server.ts`
- Modify: `tests/unit/scripts/provision-local-env.test.ts`
- Modify: `tests/unit/env/server.test.ts`
- Create: `docker-compose.files.yml`
- Create: `tests/unit/security/envelope-encryption.test.ts`
- Create: `src/lib/security/envelope-encryption.ts`

- [ ] **Step 1: Instalar somente as dependências fixadas**

Run:

```bash
npm install --save-exact file-type@22.0.1 sharp@0.35.3 tus-js-client@4.3.1
```

Expected: `package.json` contém as três versões exatas e `npm ls file-type sharp tus-js-client` termina sem `invalid` ou `extraneous`.

- [ ] **Step 2: Adicionar comandos do scanner sem alterar os scripts do plano 01**

Em `package.json`, acrescente estes scripts:

```json
{
  "scripts": {
    "files:start": "docker compose -f docker-compose.files.yml up -d --wait",
    "files:stop": "docker compose -f docker-compose.files.yml down",
    "files:logs": "docker compose -f docker-compose.files.yml logs --tail=100 clamav"
  }
}
```

Preserve `test`, `test:unit`, `test:integration`, `test:rls`, `test:e2e`, `test:all`, `db:start`, `db:reset`, `db:stop` e `db:test`.

- [ ] **Step 3: Criar o serviço ClamAV local fixado**

Use em `docker-compose.files.yml`:

```yaml
services:
  clamav:
    image: clamav/clamav:1.5.3
    restart: unless-stopped
    ports:
      - "127.0.0.1:3310:3310"
    healthcheck:
      test: ["CMD-SHELL", "printf 'PING\\n' | nc 127.0.0.1 3310 | grep -q PONG"]
      interval: 10s
      timeout: 5s
      retries: 18
      start_period: 45s
```

Run: `npm run files:start`

Expected: o compose informa `clamav Healthy`; `printf 'PING\n' | nc 127.0.0.1 3310` responde `PONG`.

- [ ] **Step 4: Documentar apenas nomes de segredos e endpoints locais**

Acrescente a `.env.example`, mantendo valores secretos vazios:

```dotenv
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
SUPABASE_STORAGE_TUS_ENDPOINT=http://127.0.0.1:54321/storage/v1/upload/resumable
BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64=
PII_ENCRYPTION_KEY_V1_BASE64=
```

Nenhuma chave real entra no Git.

Estenda o provisionador único do plano 01; não crie um segundo `.env` writer. `npm run db:env` deriva CLAMAV/TUS dos endpoints locais, gera `BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64` e `PII_ENCRYPTION_KEY_V1_BASE64` como 32 bytes aleatórios em base64 somente quando ausentes, preserva os mesmos valores em rerun e preserva chaves opcionais desconhecidas de planos posteriores (por exemplo GEMINI) em vez de truncar o arquivo. A escrita continua atômica com mode 0600 e nunca imprime chave/valor. `getServerEnv()` valida host/porta/TUS local em desenvolvimento e exige cada chave decodificar para exatamente 32 bytes; em produção, endpoints/segredos vêm do ambiente e nenhum default é criado. Testes cobrem primeira execução, rerun estável, preservação de variável posterior, arquivo 0600, chave malformada e stdout/stderr redigidos.

- [ ] **Step 5: Escrever os testes falhos da cifra com AAD e rotação**

Use este núcleo em `tests/unit/security/envelope-encryption.test.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptValue, encryptValue, readEncryptionKey } from '@/lib/security/envelope-encryption'

describe('envelope-encryption', () => {
  const key = randomBytes(32)

  it('round-trips somente com a mesma chave, versão e AAD', () => {
    const encrypted = encryptValue('000123-4', key, 1, 'bank:account:company-a')
    expect(decryptValue(encrypted, key, 'bank:account:company-a')).toBe('000123-4')
    expect(() => decryptValue(encrypted, key, 'bank:account:company-b')).toThrow()
    expect(encrypted.ciphertext).not.toContain('000123-4')
  })

  it('recusa chave que não tenha exatamente 32 bytes', () => {
    expect(() => readEncryptionKey('BROKEN_KEY', Buffer.alloc(16).toString('base64'))).toThrow(
      'BROKEN_KEY must decode to 32 bytes',
    )
  })
})
```

Run: `npm run test:unit -- tests/unit/security/envelope-encryption.test.ts`

Expected: FAIL com `Cannot find module '@/lib/security/envelope-encryption'`.

- [ ] **Step 6: Implementar AES-256-GCM sem inicialização de segredo no escopo do módulo**

Use em `src/lib/security/envelope-encryption.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type EncryptedValue = {
  ciphertext: string
  iv: string
  tag: string
  keyVersion: number
}

export function readEncryptionKey(name: string, encoded = process.env[name]): Buffer {
  if (!encoded) throw new Error(`${name} is required`)
  const key = Buffer.from(encoded, 'base64')
  if (key.byteLength !== 32) throw new Error(`${name} must decode to 32 bytes`)
  return key
}

export function encryptValue(
  plaintext: string,
  key: Buffer,
  keyVersion: number,
  additionalAuthenticatedData: string,
): EncryptedValue {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(additionalAuthenticatedData, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    keyVersion,
  }
}

export function decryptValue(
  encrypted: EncryptedValue,
  key: Buffer,
  additionalAuthenticatedData: string,
): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'))
  decipher.setAAD(Buffer.from(additionalAuthenticatedData, 'utf8'))
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
```

Run: `npm run test:unit -- tests/unit/security/envelope-encryption.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 7: Confirmar a guarda de reautenticação herdada**

Run: `rg -n "export.*requireRecentAuthentication" src/modules/auth/server/guards.ts`

Expected: uma exportação `requireRecentAuthentication(context, maxAgeSeconds?)` e o único endpoint/modal `/api/auth/reauthenticate` do plano 01. Todas as ações sensíveis deste plano chamam a guarda com 600 segundos e reutilizam esse fluxo de rotação de sessão; não crie outro cookie nem endpoint concorrente.

- [ ] **Step 8: Commitar a infraestrutura isolada**

```bash
git add package.json package-lock.json .env.example scripts/provision-local-env.ts src/lib/env/server.ts tests/unit/scripts/provision-local-env.test.ts tests/unit/env/server.test.ts docker-compose.files.yml src/lib/security/envelope-encryption.ts tests/unit/security/envelope-encryption.test.ts
git commit -m "feat: add secure files and reauthentication primitives"
```

### Task 2: Criar schema de arquivos, bancos, settings e sagas

**Files:**
- Create: `supabase/tests/database/platform_users_settings_schema.test.sql`
- Create via CLI: migration com sufixo `_platform_users_settings_schema.sql`

- [ ] **Step 1: Escrever o teste pgTAP falho do schema**

Em `supabase/tests/database/platform_users_settings_schema.test.sql`, comece com `\ir helpers/fixtures.inc`, use `begin`, crie empresa A e Admin A com os helpers congelados, execute `select plan(20)` e finalize com `select * from finish(); rollback;`. Use estas 20 asserções:

A migration desta task também executa `create extension if not exists pg_cron with schema pg_catalog` antes de qualquer migration posterior agendar limpeza. O teste confirma extensão disponível; ambientes hosted sem permissão falham o gate de link/migration em vez de omitir silenciosamente os jobs.

```sql
select test_helpers.create_company(
  '30000000-0000-4000-8000-000000000001', 'Empresa A', '12345678000190'
);
select test_helpers.create_company_user(
  '20000000-0000-4000-8000-000000000001', 'admin-a@example.com',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', 'company_admin', '{}'
);
select has_table('public', 'file_objects');
select has_table('public', 'file_upload_intents');
select has_table('public', 'company_bank_accounts');
select has_table('public', 'company_settings');
select has_table('public', 'company_settings_drafts');
select has_table('public', 'provisioning_operations');
select has_table('private', 'company_storage_usage');
select has_column('public', 'profiles', 'avatar_file_id');
select col_not_null('public', 'file_objects', 'company_id');
select col_not_null('public', 'company_bank_accounts', 'account_ciphertext');
select has_index('public', 'company_bank_accounts', 'company_bank_accounts_one_active_default_idx');
select has_column('public', 'file_objects', 'promoted_at');
select has_index('public', 'file_objects', 'file_objects_company_purpose_status_idx');
select col_type_is('public', 'file_objects', 'scan_status', 'public', 'file_scan_status');
select results_eq(
  $$select quota_bytes from private.company_storage_usage
    where company_id = '30000000-0000-4000-8000-000000000001'$$,
  $$values (5368709120::bigint)$$,
  'new company receives the configured default quota'
);
select ok(
  (select used_bytes = 0 and reserved_bytes = 0
   from private.company_storage_usage
   where company_id = '30000000-0000-4000-8000-000000000001'),
  'new quota starts without phantom bytes'
);
select throws_ok(
  $$update private.company_storage_usage
    set reserved_bytes = quota_bytes + 1
    where company_id = '30000000-0000-4000-8000-000000000001'$$,
  '23514'
);
select is(
  private.format_company_address('Rua A', '10', null, null, 'Fortaleza', 'CE', '60000000'),
  'Rua A, 10 · Fortaleza/CE · CEP 60000000',
  'address omits empty separators'
);
select throws_ok(
  $$insert into public.company_bank_accounts
    (company_id, bank_code, bank_name, branch_ciphertext, branch_iv, branch_tag, branch_key_version,
     branch_last4, account_ciphertext, account_iv, account_tag, account_key_version, account_last4,
     account_type, holder_name, status, is_default, created_by, updated_by)
    values ('30000000-0000-4000-8000-000000000001', '001', 'Banco', 'plain', 'iv', 'tag', 1,
            '0001', 'plain', 'iv', 'tag', 1, '1234', 'checking', 'Titular', 'archived', true,
            '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001')$$,
  '23514'
);
select throws_ok(
  $$insert into public.company_settings_drafts(company_id,user_id,payload,base_version)
    values ('30000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001','[]'::jsonb,1)$$,
  '23514'
);
```

Run: `npm run db:test`

Expected: FAIL mencionando `file_objects` inexistente.

- [ ] **Step 2: Gerar a migration sem fabricar timestamp**

```bash
npx supabase migration new platform_users_settings_schema
MIGRATION_PATH="$(find supabase/migrations -type f -name '*_platform_users_settings_schema.sql' | sort | tail -1)"
test -n "$MIGRATION_PATH"
```

Expected: o primeiro comando imprime o path criado; o terceiro retorna 0.

- [ ] **Step 3: Criar enums e a função determinística de endereço**

No path impresso, crie:

```sql
create type public.file_purpose as enum (
  'profile_avatar', 'company_letterhead', 'company_signature', 'contract_attachment',
  'payment_invoice', 'certificate', 'generated_document'
);
create type public.file_scan_status as enum ('pending', 'clean', 'infected', 'failed');
create type public.file_status as enum ('ready', 'rejected', 'archived');
create type public.upload_intent_status as enum (
  'reserved', 'issued', 'finalizing', 'ready', 'rejected', 'expired', 'cancelled', 'cleanup_required'
);
create type public.bank_account_status as enum ('active', 'archived');
create type public.bank_account_type as enum ('checking', 'savings', 'payment');
create type public.provisioning_kind as enum ('company_first_admin', 'company_member');
create type public.provisioning_status as enum (
  'reserved', 'auth_created', 'committed', 'compensated', 'compensation_required', 'failed'
);

create or replace function private.format_company_address(
  p_street text,
  p_number text,
  p_complement text,
  p_neighborhood text,
  p_city text,
  p_state text,
  p_postal_code text
) returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(
    ' · ',
    nullif(concat_ws(', ', nullif(btrim(p_street), ''), nullif(btrim(p_number), '')), ''),
    nullif(btrim(p_complement), ''),
    nullif(btrim(p_neighborhood), ''),
    nullif(concat_ws('/', nullif(btrim(p_city), ''), nullif(upper(btrim(p_state)), '')), ''),
    case
      when nullif(regexp_replace(coalesce(p_postal_code, ''), '[^0-9]', '', 'g'), '') is null then null
      else 'CEP ' || regexp_replace(p_postal_code, '[^0-9]', '', 'g')
    end
  )
$$;
```

- [ ] **Step 4: Criar `file_objects` e intents de upload**

Use os campos e constraints exatos:

```sql
create table public.file_objects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  owner_user_id uuid references public.profiles(user_id) on delete restrict,
  purpose public.file_purpose not null,
  bucket text not null check (bucket = 'axsys-private'),
  object_path text not null check (object_path !~ '(\\.\\.|//|^/)'),
  original_name text not null check (char_length(original_name) between 1 and 255),
  detected_mime text not null,
  byte_size bigint not null check (
    byte_size >= 1 and (
      (purpose in ('profile_avatar', 'company_letterhead', 'company_signature') and byte_size <= 5242880)
      or (purpose = 'certificate' and byte_size <= 10485760)
      or (purpose = 'payment_invoice' and byte_size <= 15728640)
      or (purpose = 'contract_attachment' and byte_size <= 20971520)
      or (purpose = 'generated_document' and byte_size <= 26214400)
    )
  ),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  scan_status public.file_scan_status not null,
  status public.file_status not null,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  promoted_at timestamptz,
  archived_at timestamptz,
  retirement_not_before timestamptz,
  retirement_claim_id uuid,
  retirement_claimed_at timestamptz,
  storage_deleted_at timestamptz,
  quota_released_at timestamptz,
  unique (bucket, object_path),
  unique (company_id, id),
  check ((purpose = 'profile_avatar') = (owner_user_id is not null)),
  check (status <> 'ready' or (scan_status = 'clean' and promoted_at is not null)),
  check (scan_status <> 'infected' or status = 'rejected'),
  check ((status = 'archived') = (archived_at is not null)),
  check (retirement_not_before is null or purpose in ('profile_avatar','company_letterhead','company_signature')),
  check ((storage_deleted_at is null) = (quota_released_at is null))
);

create table public.file_upload_intents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  actor_user_id uuid not null references public.profiles(user_id) on delete restrict,
  purpose public.file_purpose not null,
  target_resource_id uuid,
  quarantine_object_path text not null unique check (quarantine_object_path !~ '(\\.\\.|//|^/)'),
  declared_name text not null check (char_length(declared_name) between 1 and 255),
  declared_mime text not null,
  declared_size bigint not null check (
    declared_size >= 1 and (
      (purpose in ('profile_avatar', 'company_letterhead', 'company_signature') and declared_size <= 5242880)
      or (purpose = 'certificate' and declared_size <= 10485760)
      or (purpose = 'payment_invoice' and declared_size <= 15728640)
      or (purpose = 'contract_attachment' and declared_size <= 20971520)
      or (purpose = 'generated_document' and declared_size <= 26214400)
    )
  ),
  status public.upload_intent_status not null default 'reserved',
  quota_hold_bytes bigint not null check (
    quota_hold_bytes in (0, declared_size, declared_size * 2)
  ),
  authorization_issued_at timestamptz,
  upload_authorization_expires_at timestamptz,
  cleanup_not_before timestamptz,
  authorization_retired_at timestamptz,
  authorization_cleanup_claim_id uuid,
  authorization_cleanup_claimed_at timestamptz,
  cleanup_error_code text check (
    cleanup_error_code is null or cleanup_error_code ~ '^[A-Z0-9_]{3,64}$'
  ),
  file_object_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id, file_object_id) references public.file_objects(company_id, id) on delete restrict,
  check (
    (status in ('reserved', 'cancelled') and authorization_issued_at is null
      and upload_authorization_expires_at is null and cleanup_not_before is null
      and ((status = 'reserved' and authorization_retired_at is null)
        or (status = 'cancelled' and authorization_retired_at is not null)))
    or
    (status not in ('reserved', 'cancelled') and authorization_issued_at is not null
      and upload_authorization_expires_at is not null and cleanup_not_before is not null)
  ),
  check (upload_authorization_expires_at is null
    or upload_authorization_expires_at between authorization_issued_at + interval '1 hour 55 minutes'
      and authorization_issued_at + interval '2 hours 5 minutes'),
  check (cleanup_not_before is null
    or cleanup_not_before >= upload_authorization_expires_at + interval '24 hours 15 minutes'),
  check (authorization_retired_at is null or cleanup_not_before is null
    or authorization_retired_at >= cleanup_not_before),
  check ((authorization_cleanup_claim_id is null) = (authorization_cleanup_claimed_at is null))
);

create table private.company_storage_usage (
  company_id uuid primary key references public.companies(id) on delete restrict,
  quota_bytes bigint not null default 5368709120 check (quota_bytes between 104857600 and 1099511627776),
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  reserved_bytes bigint not null default 0 check (reserved_bytes >= 0),
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  check (used_bytes + reserved_bytes <= quota_bytes)
);

insert into private.company_storage_usage(company_id)
select id from public.companies
on conflict (company_id) do nothing;

create function private.initialize_company_storage_usage() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.company_storage_usage(company_id) values (new.id)
  on conflict (company_id) do nothing;
  return new;
end;
$$;

create trigger companies_initialize_storage_usage
after insert on public.companies
for each row execute function private.initialize_company_storage_usage();

alter table public.profiles
  add column avatar_file_id uuid references public.file_objects(id) on delete set null;

create index file_objects_company_purpose_status_idx
  on public.file_objects(company_id, purpose, status);
create index file_upload_intents_actor_status_idx
  on public.file_upload_intents(actor_user_id, status, cleanup_not_before);
create index file_upload_intents_expiry_idx
  on public.file_upload_intents(cleanup_not_before)
  where authorization_retired_at is null;
```

The 5 GiB default is an initial configurable platform limit, not an unlimited promise. Only the reservation/finalize/reject/cleanup functions may lock and change `private.company_storage_usage`; direct application reads/writes are revoked. Initial reservation holds `2 * declared_size`: one slot for quarantine and one for the possible promoted copy while an old TUS capability still exists. Successful finalize converts one slot to exact `used_bytes` but retains one `declared_size` capability hold; rejection releases only the unused promotion slot and retains the capability hold. Physical retirement releases the remaining `quota_hold_bytes` only after final exact-path deletion succeeds and only after `cleanup_not_before`. Supabase signed upload tokens are fixed at two hours, while a TUS upload URL created near that boundary may remain valid for up to another 24 hours, so the reservation and quarantine path remain protected through the full authorization lifetime plus a 15-minute grace. Add a reconciler that compares private object metadata with this counter and emits an alert on drift without auto-forgiving bytes.

Inside the same locked quota transaction, allow at most three unretired upload capabilities and at most 100 MiB of declared capability holds per user. This is independent of the HTTP rate limit and prevents a member from reserving the company quota for a day by issuing handshakes without bytes. Suspension/revocation can block new work immediately, but neither Super Admin nor Company Admin may release an already issued capability hold before its safe retirement time; Company Admin sees only per-user count/held-byte diagnostics, while Platform health remains aggregate-only and never exposes tenant object/path details.

- [ ] **Step 5: Criar bancos cifrados com no máximo um default ativo**

```sql
create table public.company_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  bank_code text not null check (bank_code ~ '^[0-9]{3,8}$'),
  bank_name text not null check (char_length(btrim(bank_name)) between 2 and 120),
  branch_ciphertext text not null,
  branch_iv text not null,
  branch_tag text not null,
  branch_key_version integer not null check (branch_key_version > 0),
  branch_last4 text not null check (char_length(branch_last4) between 1 and 4),
  account_ciphertext text not null,
  account_iv text not null,
  account_tag text not null,
  account_key_version integer not null check (account_key_version > 0),
  account_last4 text not null check (char_length(account_last4) between 1 and 4),
  account_type public.bank_account_type not null,
  holder_name text not null check (char_length(btrim(holder_name)) between 2 and 160),
  holder_document_ciphertext text,
  holder_document_iv text,
  holder_document_tag text,
  holder_document_key_version integer,
  holder_document_last4 text,
  status public.bank_account_status not null default 'active',
  is_default boolean not null default false,
  version bigint not null default 1,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  updated_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (company_id, id),
  check (not is_default or status = 'active'),
  check ((status = 'archived') = (archived_at is not null)),
  check (
    (holder_document_ciphertext is null and holder_document_iv is null and holder_document_tag is null
      and holder_document_key_version is null and holder_document_last4 is null)
    or
    (holder_document_ciphertext is not null and holder_document_iv is not null and holder_document_tag is not null
      and holder_document_key_version is not null and holder_document_last4 is not null)
  )
);

create unique index company_bank_accounts_one_active_default_idx
  on public.company_bank_accounts(company_id)
  where status = 'active' and is_default;
create index company_bank_accounts_company_status_idx
  on public.company_bank_accounts(company_id, status, created_at);
```

- [ ] **Step 6: Criar settings institucionais e rascunho isolado**

```sql
create table public.company_settings (
  company_id uuid primary key references public.companies(id) on delete restrict,
  representative_name text,
  representative_role text,
  representative_document_ciphertext text,
  representative_document_iv text,
  representative_document_tag text,
  representative_document_key_version integer,
  representative_document_last4 text,
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  address_street text,
  address_number text,
  address_complement text,
  address_neighborhood text,
  address_city text,
  address_state text check (address_state is null or address_state ~ '^[A-Z]{2}$'),
  address_postal_code text check (address_postal_code is null or address_postal_code ~ '^[0-9]{8}$'),
  consolidated_address text generated always as (
    private.format_company_address(
      address_street, address_number, address_complement, address_neighborhood,
      address_city, address_state, address_postal_code
    )
  ) stored,
  letterhead_file_id uuid,
  signature_file_id uuid,
  version bigint not null default 1,
  updated_by uuid not null references public.profiles(user_id) on delete restrict,
  updated_at timestamptz not null default now(),
  foreign key (company_id, letterhead_file_id) references public.file_objects(company_id, id) on delete restrict,
  foreign key (company_id, signature_file_id) references public.file_objects(company_id, id) on delete restrict,
  check (
    (representative_document_ciphertext is null and representative_document_iv is null
      and representative_document_tag is null and representative_document_key_version is null
      and representative_document_last4 is null)
    or
    (representative_document_ciphertext is not null and representative_document_iv is not null
      and representative_document_tag is not null and representative_document_key_version is not null
      and representative_document_last4 is not null)
  )
);

create table public.company_settings_drafts (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  base_version bigint not null check (base_version > 0),
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
```

- [ ] **Step 7: Criar journal de saga sem armazenar payload sensível**

```sql
create table public.provisioning_operations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  kind public.provisioning_kind not null,
  actor_user_id uuid not null references public.profiles(user_id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  subject_email_hash text not null check (subject_email_hash ~ '^[0-9a-f]{64}$'),
  auth_user_id uuid,
  status public.provisioning_status not null default 'reserved',
  last_error_code text,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_user_id, idempotency_key)
);

create index provisioning_operations_reconcile_idx
  on public.provisioning_operations(status, updated_at)
  where status in ('reserved', 'auth_created', 'compensation_required');
```

O journal não recebe senha, nome completo, e-mail, CNPJ, CPF, agência ou conta. Use hashes para correlação.

- [ ] **Step 8: Criar buckets privados e habilitar RLS default-deny**

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'axsys-quarantine', 'axsys-quarantine', false, 26214400,
    array[
      'image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/xml', 'text/xml',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  ),
  (
    'axsys-private', 'axsys-private', false, 26214400,
    array[
      'image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/xml', 'text/xml',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.file_objects enable row level security;
alter table public.file_objects force row level security;
alter table public.file_upload_intents enable row level security;
alter table public.file_upload_intents force row level security;
alter table public.company_bank_accounts enable row level security;
alter table public.company_bank_accounts force row level security;
alter table public.company_settings enable row level security;
alter table public.company_settings force row level security;
alter table public.company_settings_drafts enable row level security;
alter table public.company_settings_drafts force row level security;
alter table public.provisioning_operations enable row level security;
alter table public.provisioning_operations force row level security;

revoke all on public.file_objects, public.file_upload_intents, public.company_bank_accounts,
  public.company_settings, public.company_settings_drafts, public.provisioning_operations
  from anon, authenticated;
revoke all on private.company_storage_usage from public, anon, authenticated, service_role, axsys_bff;
revoke all on function private.initialize_company_storage_usage() from public, anon, authenticated, service_role, axsys_bff;
```

Não crie policy ampla em `storage.objects`. O token assinado do TUS concede somente o path exato; toda leitura/promoção usa BFF após autorização.

- [ ] **Step 9: Aplicar do zero e executar o teste de schema**

Run:

```bash
npm run db:reset
npm run db:test
```

Expected: migrations aplicadas sem erro; `platform_users_settings_schema.test.sql .. ok`; `Result: PASS`.

- [ ] **Step 10: Commitar schema e teste**

```bash
git add supabase/migrations supabase/tests/database/platform_users_settings_schema.test.sql src/lib/supabase/database.types.ts
git commit -m "feat: add platform users settings schema"
```

### Task 3: Fechar RLS, grants seguros e invariantes concorrentes

**Files:**
- Create: `supabase/tests/database/platform_users_settings_rls.test.sql`
- Create: `supabase/tests/database/platform_users_settings_concurrency.test.sql`
- Create via CLI: migration com sufixo `_platform_users_settings_rls.sql`

- [ ] **Step 1: Escrever a matriz RLS falha para dois tenants e plataforma**

Em `supabase/tests/database/platform_users_settings_rls.test.sql`, comece com `\ir helpers/fixtures.inc`. Use `test_helpers.create_auth_user`, `test_helpers.create_company`, `test_helpers.create_company_user`, `test_helpers.set_jwt` e `test_helpers.clear_jwt` do plano 01 para criar Super Admin, Admin A, Admin A2, Member A, Finance A, Admin B e empresas A/B. Para cada ator, registre antes uma session_id UUID distinta com `private.register_auth_session` e passe exatamente essa session_id a `set_jwt`; nenhum teste RLS pode depender do argumento default. UUIDs de empresa A/B são `30000000-0000-4000-8000-000000000001` e `30000000-0000-4000-8000-000000000002`; Admin A é `20000000-0000-4000-8000-000000000001`. Use transação e asserte separadamente `SELECT`, `INSERT`, `UPDATE` e `DELETE`.

O núcleo negativo deve ser explícito:

```sql
select results_eq(
  $$select count(*)::bigint from public.company_settings where company_id = '30000000-0000-4000-8000-000000000002'$$,
  array[0::bigint],
  'Admin A cannot read settings B'
);
select results_eq(
  $$select count(*)::bigint from public.company_bank_accounts where company_id = '30000000-0000-4000-8000-000000000002'$$,
  array[0::bigint],
  'Finance A cannot infer bank accounts B'
);
select throws_ok(
  format(
    'insert into public.company_settings_drafts(company_id,user_id,payload,base_version) values (%L,%L,%L,1)',
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '{"addressCity":"Fortaleza"}'
  ),
  '42501',
  null,
  'Admin A cannot write a draft into company B'
);
select results_eq(
  $$select count(*)::bigint from public.file_upload_intents where actor_user_id <> (select auth.uid())$$,
  array[0::bigint],
  'upload intents are private to their actor'
);
select results_eq(
  $$select count(*)::bigint from public.audit_events where scope = 'platform'$$,
  array[0::bigint],
  'platform audit is not exposed through the user Data API'
);
```

Além disso, teste:

1. Admin A vê settings A e seu próprio rascunho.
2. Member A não grava settings nem rascunho.
3. Finance A lê somente a view mascarada de contas ativas A.
4. Nenhum usuário autenticado recebe ciphertext de banco ou documento do representante.
5. Super Admin autenticado não lê `company_settings`, drafts ou `file_objects` diretamente.
6. `anon` não acessa nenhuma tabela/view deste plano.
7. Upload direto nos buckets sem token assinado é negado.
8. Admin A não lê profiles alheios pela Data API, mas o reader BFF retorna somente o diretório seguro de A; Member A, Admin B e parâmetros cruzados falham.
9. Mesmo Admin A não consegue inserir `file_upload_intents` diretamente, nem para si, nem escolhendo path/target/purpose; somente a função BFF de reserva cria o registro.
10. Sessão revogada ou profile com `must_change_password` vê zero linhas operacionais deste plano, mesmo com JWT ainda não expirado.

Run: `npm run db:test`

Expected: FAIL porque policies/views ainda não existem.

- [ ] **Step 2: Escrever os testes concorrentes falhos do último admin e membership imutável**

Em `supabase/tests/database/platform_users_settings_concurrency.test.sql`, comece com `\ir helpers/fixtures.inc` e use `dblink` (habilitado somente no teste) para duas transações concorrentes que tentam suspender memberships `40000000-0000-4000-8000-000000000001` e `40000000-0000-4000-8000-000000000002` da empresa A. Exija que uma termine e a outra receba `23514/last_active_company_admin`; ao final reste exatamente um admin ativo.

Inclua também:

```sql
select throws_ok(
  format(
    'update public.company_memberships set company_id = %L where id = %L',
    '30000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001'
  ),
  'P0001',
  'AXSYS_MEMBERSHIP_IDENTITY_IMMUTABLE',
  'membership cannot move between tenants'
);
select throws_ok(
  format(
    'delete from public.company_memberships where id = %L',
    '40000000-0000-4000-8000-000000000001'
  ),
  '23514',
  'membership_delete_forbidden',
  'memberships are suspended, never deleted'
);
```

Run: `npm run db:test`

Expected: FAIL porque os triggers ainda não existem.

- [ ] **Step 3: Gerar a migration RLS com o CLI**

```bash
npx supabase migration new platform_users_settings_rls
MIGRATION_PATH="$(find supabase/migrations -type f -name '*_platform_users_settings_rls.sql' | sort | tail -1)"
test -n "$MIGRATION_PATH"
```

Expected: path criado pelo CLI e status 0.

- [ ] **Step 4: Criar policies de assets e intents sem abrir Storage**

Na migration:

```sql
grant select (id, company_id, owner_user_id, purpose, detected_mime, byte_size,
  scan_status, status, created_at, promoted_at, archived_at)
  on public.file_objects to authenticated;
grant select (id, company_id, actor_user_id, purpose, target_resource_id,
  declared_mime, declared_size, status, file_object_id, created_at)
  on public.file_upload_intents to authenticated;

create policy file_objects_tenant_select
on public.file_objects for select to authenticated
using (
  status = 'ready'
  and scan_status = 'clean'
  and private.is_active_company_member(company_id)
  and purpose in ('profile_avatar', 'company_letterhead', 'company_signature')
);

create policy upload_intents_own_select
on public.file_upload_intents for select to authenticated
using (
  actor_user_id = (select auth.uid())
  and private.is_active_company_member(company_id)
);

```

Não conceda `bucket`, `object_path`, `original_name`, `sha256`, authorization/token/deadline/claim/error columns nem `INSERT`/`UPDATE`/`DELETE` de intents ou qualquer DML de `file_objects` a `authenticated`. `has_column_privilege` e PostgREST testam explicitamente as negações. Crie um helper interno `private.reserve_upload_capability_core(derived_company,derived_actor,purpose,derived_target,declared_metadata)` que é callable somente pelo dono das funções (EXECUTE revogado também de axsys_bff) e centraliza path aleatório, status reserved, hold `2 * declared_size`, quota lock e caps de três/100 MiB por usuário. Crie `private.reserve_image_upload_intent`, `private.activate_file_upload_authorization` e `private.cancel_unissued_file_reservation` com search path vazio, actor/session revalidados, path/tenant/user/deadlines/status derivados no SQL e purpose restrito aos três assets deste plano; dê EXECUTE apenas às três fachadas necessárias em `axsys_bff` e exponha métodos tipados em `bffDb`. A fachada de imagem autoriza/deriva o target e só então chama o core; ativação fixa deadlines, e cancelamento exige status reserved, capability nunca ativada, marca cancelled/retired e libera exatamente o hold. A reserva de profile deriva o próprio user; letterhead/signature exigem company_admin. Nenhuma função aceita company_id, actor_user_id, quarantine path, bucket, owner, deadline ou status do browser. Planos posteriores adicionam fachadas purpose-specific que obrigatoriamente chamam esse mesmo core depois dos seus próprios joins; não reimplementam quota/path e não ampliam INSERT direto. Não crie policy para `axsys-quarantine` ou `axsys-private`; um request normal ao Storage deve continuar negado.

- [ ] **Step 5: Expor somente resumos mascarados de bancos**

```sql
grant select (
  id, company_id, bank_code, bank_name, branch_last4, account_last4, account_type,
  holder_name, holder_document_last4, status, is_default, version, created_at, updated_at
) on public.company_bank_accounts to authenticated;

create policy company_bank_accounts_tenant_select
on public.company_bank_accounts for select to authenticated
using (
  private.is_active_company_member(company_id)
  and (
    private.has_company_role(company_id, 'company_admin'::public.membership_role)
    or private.has_module(company_id, 'financial'::public.module_key)
  )
);

create view public.company_bank_account_summaries
with (security_invoker = true)
as
select
  id, company_id, bank_code, bank_name,
  repeat('•', greatest(0, 4 - char_length(branch_last4))) || branch_last4 as masked_branch,
  repeat('•', greatest(0, 4 - char_length(account_last4))) || account_last4 as masked_account,
  account_type, holder_name,
  case when holder_document_last4 is null then null else '••••' || holder_document_last4 end
    as masked_holder_document,
  status, is_default, version, created_at, updated_at
from public.company_bank_accounts;

revoke all on public.company_bank_account_summaries from anon;
grant select on public.company_bank_account_summaries to authenticated;
```

Use sempre o enum congelado do plano 01, `public.membership_role`; não crie um tipo concorrente.

- [ ] **Step 6: Fechar leitura de settings e CRUD isolado de rascunho**

```sql
grant select on public.company_settings_drafts to authenticated;

grant select (
  company_id, representative_name, representative_role, representative_document_last4,
  tax_rate, address_street, address_number, address_complement, address_neighborhood,
  address_city, address_state, address_postal_code, consolidated_address,
  letterhead_file_id, signature_file_id, version, updated_at
) on public.company_settings to authenticated;

create policy company_settings_tenant_select
on public.company_settings for select to authenticated
using (private.is_active_company_member(company_id));

create view public.company_settings_safe
with (security_invoker = true)
as
select
  company_id, representative_name, representative_role,
  case when representative_document_last4 is null then null
    else '••••' || representative_document_last4 end as masked_representative_document,
  tax_rate, address_street, address_number, address_complement, address_neighborhood,
  address_city, address_state, address_postal_code, consolidated_address,
  letterhead_file_id, signature_file_id, version, updated_at
from public.company_settings;

revoke all on public.company_settings_safe from anon;
grant select on public.company_settings_safe to authenticated;

create policy company_settings_drafts_own_select
on public.company_settings_drafts for select to authenticated
using (
  user_id = (select auth.uid())
  and private.has_company_role(company_id, 'company_admin'::public.membership_role)
);
```

Os grants de `company_settings` e `company_settings_drafts` são somente leitura. Não crie policies de INSERT/UPDATE/DELETE para drafts: `company_upsert_settings_draft` e `company_delete_settings_draft` da Task 12 são os únicos writers, com actor/session, payload allowlisted, CAS, `app.actor_id` e auditoria. pgTAP/PostgREST prova DML direto negado mesmo ao próprio admin.

Não crie policy para Company Admin selecionar `profiles` alheios. Crie `private.list_company_user_directory(actor,session,cursor,limit,query)` somente axsys_bff: deriva empresa/papel, retorna apenas `(userId,displayName,email,role,status,modules,createdAt)` e nunca `must_change_password`, expirações, password timestamps, avatar path/hash ou flags internas. Paginação/filtro são bounded/parametrizados. O self SELECT do Plan 01 permanece; pgTAP prova que admin não lê profile bruto alheio e que o reader não retorna colunas extras.

- [ ] **Step 7: Proteger identidade e último admin no banco**

```sql
create or replace function private.guard_membership_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.company_id <> old.company_id or new.user_id <> old.user_id then
    raise exception using errcode = 'P0001', message = 'AXSYS_MEMBERSHIP_IDENTITY_IMMUTABLE';
  end if;
  return new;
end
$$;

create trigger guard_membership_identity_before_update
before update of company_id, user_id on public.company_memberships
for each row execute function private.guard_membership_identity();

create or replace function private.protect_last_company_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '23514', message = 'membership_delete_forbidden';
  end if;

  if old.role = 'company_admin'
     and old.status = 'active'
     and (new.role <> 'company_admin' or new.status <> 'active') then
    perform pg_advisory_xact_lock(hashtextextended(old.company_id::text, 2102));
    if not exists (
      select 1 from public.company_memberships other
      where other.company_id = old.company_id
        and other.id <> old.id
        and other.role = 'company_admin'
        and other.status = 'active'
    ) then
      raise exception using errcode = '23514', message = 'last_active_company_admin';
    end if;
  end if;
  return new;
end
$$;

revoke all on function private.guard_membership_identity() from public, anon, authenticated;
revoke all on function private.protect_last_company_admin() from public, anon, authenticated;
```

O plano 01 já criou o trigger `protect_last_company_admin`; esta migration substitui somente sua função para adicionar o advisory lock, preservando `23514/last_active_company_admin` esperado pelos testes anteriores. O segundo trigger torna company/user imutáveis e proíbe DELETE em favor de suspensão.

- [ ] **Step 8: Impedir branding com asset errado mesmo sob RPC privilegiada**

```sql
create or replace function private.guard_company_branding_files()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.letterhead_file_id is not null and not exists (
    select 1 from public.file_objects f
    where f.company_id = new.company_id
      and f.id = new.letterhead_file_id
      and f.purpose = 'company_letterhead'
      and f.status = 'ready'
      and f.scan_status = 'clean'
  ) then
    raise exception using errcode = 'P0001', message = 'AXSYS_INVALID_LETTERHEAD_FILE';
  end if;

  if new.signature_file_id is not null and not exists (
    select 1 from public.file_objects f
    where f.company_id = new.company_id
      and f.id = new.signature_file_id
      and f.purpose = 'company_signature'
      and f.status = 'ready'
      and f.scan_status = 'clean'
  ) then
    raise exception using errcode = 'P0001', message = 'AXSYS_INVALID_SIGNATURE_FILE';
  end if;
  return new;
end
$$;

create trigger guard_company_branding_files_before_write
before insert or update of letterhead_file_id, signature_file_id
on public.company_settings
for each row execute function private.guard_company_branding_files();
```

- [ ] **Step 9: Aplicar e provar policies/locks**

Run:

```bash
npm run db:reset
npm run db:test
npx supabase db advisors --local
```

Expected: ambos os arquivos pgTAP `ok`, `Result: PASS`; advisors sem `security_definer_view`, `rls_disabled_in_public` ou `function_search_path_mutable` para objetos deste plano.

- [ ] **Step 10: Commitar RLS separadamente**

```bash
git add supabase/migrations supabase/tests/database/platform_users_settings_rls.test.sql supabase/tests/database/platform_users_settings_concurrency.test.sql src/lib/db/bff.ts src/lib/supabase/database.types.ts
git commit -m "feat: enforce tenant policies and admin invariants"
```

### Task 4: Construir o substrato TUS, quarentena, scan e promoção

**Files:**
- Create via CLI: migration com sufixo `_file_upload_finalize_rpc.sql`
- Create via CLI: migration com sufixo `_download_audit_rpcs.sql`
- Create: `src/modules/files/domain/file-types.ts`
- Create: `src/modules/files/domain/upload-policy.ts`
- Create: `src/modules/files/server/clamav-client.ts`
- Create: `src/modules/files/server/image-normalizer.ts`
- Create: `src/modules/files/server/file-repository.ts`
- Create: `src/modules/files/server/create-upload-intent.ts`
- Create: `src/modules/files/server/finalize-upload-intent.ts`
- Create: `src/modules/files/server/authorize-file-download.ts`
- Create: `src/modules/files/server/audited-download-streamer.ts`
- Create: `src/modules/files/server/expired-upload-cleaner.ts`
- Modify: `src/lib/db/bff.ts`
- Create: `scripts/reconcile-file-storage.ts`
- Create: `src/modules/files/ui/use-resumable-upload.ts`
- Create: `src/modules/files/ui/image-upload-field.tsx`
- Create: `src/app/api/files/uploads/route.ts`
- Create: `src/app/api/files/uploads/[intentId]/finalize/route.ts`
- Create: `src/app/api/files/[fileId]/download/route.ts`
- Create: `tests/unit/files/upload-policy.test.ts`
- Create: `tests/integration/files/upload-pipeline.test.ts`
- Create: `tests/integration/files/storage-quota.test.ts`

- [ ] **Step 1: Escrever o teste falho da allowlist de uploads**

```ts
import { describe, expect, it } from 'vitest'
import { getUploadPolicy, validateFile } from '@/modules/files/domain/upload-policy'

describe('getUploadPolicy', () => {
  it.each(['profile_avatar', 'company_letterhead', 'company_signature'] as const)(
    'aceita %s como imagem de até 5 MiB',
    (purpose) => {
      expect(getUploadPolicy(purpose)).toEqual({
        maxBytes: 5 * 1024 * 1024,
        declaredMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        detectedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        detectedExtensions: ['jpg', 'png', 'webp'],
        transform: 'reencode-image',
        outputMime: 'image/webp',
        outputExtension: 'webp',
      })
    },
  )

  it('recusa purpose reservado mas não habilitado neste ciclo', () => {
    expect(() => getUploadPolicy('contract_attachment')).toThrow('UPLOAD_PURPOSE_NOT_ENABLED')
  })

  it('deriva MIME, extensão, tamanho e hash dos bytes, não do nome', async () => {
    const result = await validateFile({
      purpose: 'profile_avatar',
      originalName: 'avatar.png',
      declaredMime: 'image/png',
      bytes: validPngBytes,
    })
    expect(result).toEqual({
      detectedMime: 'image/png',
      extension: 'png',
      byteSize: validPngBytes.byteLength,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })
})
```

Run: `npm run test:unit -- tests/unit/files/upload-policy.test.ts`

Expected: FAIL com módulo ausente.

- [ ] **Step 2: Definir os tipos compartilhados e a policy fechada**

Em `src/modules/files/domain/file-types.ts`:

```ts
export type FilePurpose =
  | 'profile_avatar'
  | 'company_letterhead'
  | 'company_signature'
  | 'contract_attachment'
  | 'payment_invoice'
  | 'certificate'
  | 'generated_document'

export type FileScanStatus = 'pending' | 'clean' | 'infected' | 'failed'
export type FileStatus = 'ready' | 'rejected' | 'archived'

export type FileObject = {
  id: string
  companyId: string
  ownerUserId: string | null
  purpose: FilePurpose
  bucket: 'axsys-private'
  objectPath: string
  originalName: string
  detectedMime: string
  byteSize: number
  sha256: string
  scanStatus: FileScanStatus
  status: FileStatus
  createdBy: string
  createdAt: string
  promotedAt: string | null
}
```

Em `src/modules/files/domain/upload-policy.ts`, implemente a allowlist testada com um `Readonly<Record<'profile_avatar' | 'company_letterhead' | 'company_signature', UploadPolicy>>`; qualquer outro purpose lança `ApiError.badRequest('UPLOAD_PURPOSE_NOT_ENABLED', 'Tipo de arquivo indisponível.')`. Congele também esta API pública, que planos posteriores ampliarão sem renomear:

```ts
export async function validateFile(input: {
  purpose: FilePurpose
  originalName: string
  declaredMime: string
  bytes: Buffer
}): Promise<{ detectedMime: string; extension: string; byteSize: number; sha256: string }>
```

Ela chama `fileTypeFromBuffer`, exige coincidência entre MIME declarado e detectado, valida extensão normalizada do nome contra a policy, aplica o limite por purpose e calcula SHA-256 dos bytes. Erros estáveis: `FILE_TOO_LARGE`, `FILE_TYPE_MISMATCH`, `FILE_EXTENSION_MISMATCH` e `FILE_MAGIC_BYTES_INVALID`.

Run: `npm run test:unit -- tests/unit/files/upload-policy.test.ts`

Expected: PASS, 5 casos.

- [ ] **Step 3: Escrever o teste de integração falho para a saga de arquivo**

Em `tests/integration/files/upload-pipeline.test.ts`, injete fakes para Storage, scanner, normalizador e repositório. Cubra, em testes distintos:

```ts
it('promove somente depois de magic bytes, scan e reencode', async () => {
  const result = await finalizeUploadIntent(deps, {
    context: companyAdminContext,
    intentId: '11111111-1111-4111-8111-111111111111',
    correlationId: '22222222-2222-4222-8222-222222222222',
  })
  expect(deps.scanner.scan).toHaveBeenCalledBefore(deps.storage.uploadPrivate)
  expect(deps.normalizer.toWebp).toHaveBeenCalledOnce()
  expect(result).toMatchObject({ purpose: 'company_letterhead', scanStatus: 'clean', status: 'ready' })
  expect(deps.storage.removeQuarantine).toHaveBeenCalledOnce()
})

it('rejeita MIME declarado divergente dos magic bytes', async () => {
  deps.storage.downloadQuarantine.mockResolvedValue(jpegBytes)
  deps.repository.getIntentForUpdate.mockResolvedValue(pngDeclaredIntent)
  await expect(finalizeUploadIntent(deps, finalizeInput)).rejects.toMatchObject({
    code: 'FILE_TYPE_MISMATCH',
  })
  expect(deps.storage.uploadPrivate).not.toHaveBeenCalled()
})

it('remove o promovido quando a persistência falha', async () => {
  deps.repository.commitReadyFile.mockRejectedValue(new Error('db unavailable'))
  await expect(finalizeUploadIntent(deps, finalizeInput)).rejects.toThrow('db unavailable')
  expect(deps.storage.removePrivate).toHaveBeenCalledWith('company-a/company_letterhead/file-id.webp')
  expect(deps.repository.markCleanupRequired).toHaveBeenCalled()
})
```

Inclua infectado, scan indisponível, intent expirado, intent de outro usuário, finalize repetido idempotente e path com outro tenant.

Run: `npm run test:integration -- tests/integration/files/upload-pipeline.test.ts`

Expected: FAIL com `finalizeUploadIntent` ausente.

- [ ] **Step 4: Implementar cliente ClamAV INSTREAM com limite estrito**

`src/modules/files/server/clamav-client.ts` exporta:

```ts
export type MalwareScanner = { scan(buffer: Buffer): Promise<'clean' | 'infected'> }
export function getClamAvScanner(): MalwareScanner
```

Abra `node:net` lazily dentro de `scan`, envie `zINSTREAM\0`, chunks de 64 KiB precedidos por tamanho big-endian de 4 bytes e finalize com quatro bytes zero. Timeout total: 15 segundos. Aceite somente resposta terminada em `OK`; `FOUND` retorna `infected`; timeout, socket fechado ou resposta desconhecida lançam `FILE_SCANNER_UNAVAILABLE`. Nunca logue o buffer ou nome original.

- [ ] **Step 5: Implementar detecção e normalização determinística**

`src/modules/files/server/image-normalizer.ts` recebe somente bytes já aprovados por `validateFile` e carrega `sharp` dentro da função:

```ts
export async function normalizeImage(buffer: Buffer, purpose: EnabledImagePurpose): Promise<Buffer> {
  const dimensions = purpose === 'profile_avatar' ? { width: 512, height: 512, fit: 'cover' as const }
    : { width: 2400, height: 2400, fit: 'inside' as const }
  return sharp(buffer, { failOn: 'warning', limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ ...dimensions, withoutEnlargement: true })
    .webp({ quality: 90, effort: 5 })
    .toBuffer()
}
```

Remova EXIF, ICC não necessário e metadados de localização; recuse animação e imagens com mais de 40 MP.

- [ ] **Step 6: Implementar o handshake de intent com path não controlável**

`createUploadIntent` deve ter a assinatura:

```ts
type CreateUploadIntentInput = {
  context: CompanyAccessContext
  purpose: FilePurpose
  targetResourceId: string | null
  declaredName: string
  declaredMime: string
  declaredSize: number
  correlationId: string
}

type UploadReservationDTO = Readonly<{
  intentId: string
  quarantinePath: string
  declaredSize: number
}>

type UploadHandshake = {
  intentId: string
  endpoint: string
  bucket: 'axsys-quarantine'
  path: string
  token: string
  uploadAuthorizationExpiresAt: string
  finalizeBefore: string
  maxBytes: number
  allowedMimeTypes: readonly string[]
}
```

Exporte `UploadReservationDTO` uma única vez de `src/modules/files/domain/file-types.ts`; `create-upload-intent.ts`, `bffDb` e os Planos 03–05 importam esse tipo em vez de redeclará-lo. Ele é o único retorno permitido para `reserve_image_upload_intent` e para todas as fachadas de reserva purpose-specific. O JSON SQL contém exatamente `intentId`, `quarantinePath` e `declaredSize`; não contém company, actor, target, bucket, token, deadline, status ou quota. O bucket é a constante server-only `axsys-quarantine`, e policy fornece `maxBytes`/MIMEs sem ampliar o DTO.

Valide policy antes de tocar Storage. Para os três purposes deste plano, chame `bffDb.reserveImageUploadIntent` com apenas session/actor verificados, purpose e metadados declarados; a função deriva company/user, aplica sob o mesmo quota lock os limites por usuário, gera `intentId`, random ID e path exato `${companyId}/${userId}/${intentId}/${randomId}`, mantém status `reserved` e segura `2 * declared_size`, retornando exatamente `UploadReservationDTO`. Somente depois use `getAdminSupabase().storage.from('axsys-quarantine').createSignedUploadUrl(quarantinePath, { upsert: false })`, e então chame `bffDb.activateFileUploadAuthorization`: ela faz CAS `reserved -> issued`, fixa `authorization_issued_at`, `upload_authorization_expires_at=issued_at+2h` e `cleanup_not_before=upload_authorization_expires_at+24h15m`, retornando exatamente `{uploadAuthorizationExpiresAt,finalizeBefore}`. Se assinatura ou ativação falhar antes de responder, `bffDb.cancelUnissuedFileReservation` exige status reserved, marca cancelled e libera tudo; se a ativação comitou mas a resposta caiu, o cleaner conserva a capacidade até a aposentadoria segura. Depois que o token pode ter saído, cancelamento/abandono nunca libera quota antes de `cleanup_not_before`. O cliente Supabase do usuário nunca insere intent, e o browser nunca determina um componente do path. Testes de contrato fazem igualdade recursiva das chaves desses dois retornos e rejeitam campos extras.

- [ ] **Step 7: Implementar finalize como máquina de estados compensável**

`src/modules/files/server/finalize-upload-intent.ts` deve executar, nesta ordem:

1. CAS `issued -> finalizing`, verificando ator, tenant e que `clock_timestamp() < cleanup_not_before`; se já `ready`, devolva o mesmo `file_object`. `upload_authorization_expires_at` impede iniciar/recriar o upload, mas uma sessão TUS iniciada a tempo ainda pode finalizar até `cleanup_not_before`.
2. Baixar o objeto exato de `axsys-quarantine`; conferir tamanho real, tamanho declarado e limite.
3. Detectar magic bytes e exigir MIME declarado compatível.
4. Escanear o original; `infected` move intent para `rejected`, remove imediatamente a quarentena por segurança, libera somente o slot de promoção e conserva o capability hold para uma segunda deleção após a janela TUS; audita sem nome/payload.
5. Aplicar a transformação definida pela policy: os três purposes de imagem deste plano são reencodados para WebP; extensões futuras devem declarar explicitamente `reencode-image` ou `preserve-validated-bytes`. PDF, DOC, DOCX e XML jamais passam por sharp, e nenhum formato ativo/executável é preservado.
6. Escanear novamente quando os bytes forem transformados; calcular SHA-256/MIME/extensão dos bytes finais, gerar `fileId` e path `${companyId}/${purpose}/${fileId}.${finalExtension}` sem usar o nome enviado.
7. Enviar com `upsert: false` para `axsys-private`.
8. Em uma função BFF/repository transaction, criar `file_objects` como `clean/ready`, converter apenas o slot de promoção para `used_bytes` pelo tamanho final, manter `declared_size` em `quota_hold_bytes`, preencher `promoted_at`, ligar intent e auditar.
9. Não remover a quarentena limpa antes de `cleanup_not_before`: mantê-la no path com `upsert:false` bloqueia reuso do token/outro TUS URL com `409`. Se o passo 8 falhar, tentar remover o promovido e marcar `cleanup_required`; nunca retornar um arquivo sem metadata committed. O cleaner fará a deleção final do path de quarentena após toda capacidade expirar.

O serviço exporta `finalizeUploadIntent(deps, input): Promise<FileObject>`; `deps` explicita `scanner`, `storage`, `repository`, `transformer`, `clock` e `uuid` para testes determinísticos. Testes congelam uma matriz: branding image→WebP; certificate/contract/payment image→WebP quando esses purposes forem habilitados; PDF/DOC/DOCX/XML→bytes e extensão validados preservados; qualquer purpose sem estratégia explícita falha fechado.

- [ ] **Step 8: Gerar e preencher a RPC atômica de metadata promovida**

```bash
npx supabase migration new file_upload_finalize_rpc
MIGRATION_PATH="$(find supabase/migrations -type f -name '*_file_upload_finalize_rpc.sql' | sort | tail -1)"
test -n "$MIGRATION_PATH"
```

Crie `private.internal_finalize_file_upload(p_actor_user_id uuid,p_session_id uuid,p_intent_id uuid,p_file_id uuid,p_object_path text,p_detected_mime text,p_final_extension text,p_byte_size bigint,p_sha256 text,p_correlation_id uuid) returns public.file_objects`, somente `axsys_bff`, SECURITY DEFINER e search path vazio. A função valida actor/session por `private.assert_auth_session`; company, owner, purpose e original name vêm exclusivamente do intent bloqueado. Ela revalida estado/deadline, o prefixo exato e a extensão final permitida, reduz `reserved_bytes`/`quota_hold_bytes` por exatamente um `declared_size`, incrementa `used_bytes` pelo tamanho final, conserva o capability hold remanescente, insere `file_objects` clean/ready, liga intent e audita no mesmo commit. Crie também `private.internal_mark_file_cleanup_required(actor,session,intent,reason_code)` e `private.internal_reject_file_upload(actor,session,intent,reason_code)`, revalidando actor contra o intent, reason codes allowlisted, retenção correta do capability hold e nenhum path/nome arbitrário. Revogue todos e conceda somente `axsys_bff`; adicione métodos tipados em `bffDb`. O service-role client continua restrito a copiar/remover o objeto exato no Storage.

- [ ] **Step 9: Implementar download privado com autorização antes da URL**

Gere a migration `_download_audit_rpcs.sql` depois que pg_cron já estiver habilitado. Crie a tabela privada `download_attempts` (id UUID, nonce_hash, actor/session nullable somente para público, company/resource_kind/resource_id derivados, correlation_id, started_at, completed_at, outcome allowlisted, byte_class allowlisted), sem grants para public/anon/authenticated/service_role/axsys_bff e com retenção curta. `private.begin_download_audit_core(...)` é owner-only, nunca executável pelo BFF: cada authorizer de propósito chama esse core somente depois de autorizar e recebe `{ attemptId, completionNonce }` junto com metadata server-only. O nonce aleatório de 32 bytes aparece uma vez, apenas na memória do servidor, e só seu hash é persistido. `private.complete_download_audit(attempt_id,completion_nonce,outcome,byte_class)` bloqueia attempt, consome nonce por CAS e cria owner-only `private.download_execution_context` keyed exatamente por `(txid_current(),pg_backend_pid(),operation_kind,attempt_id)` com kind `download_completion`; o emitter aceita somente o audit row que corresponde ao attempt bloqueado, mesmo se a sessão autenticada foi revogada depois do begin. A função grava exatamente um resultado `completed|aborted|integrity_failed|stream_failed` e apaga o contexto no commit. Tentativas negadas escrevem somente security telemetry neutra com correlation/reason allowlisted, sem IDs/nomes/path/hash.

Crie ainda `private.finalize_stale_download_attempts()` owner-only e um job pg_cron a cada cinco minutos: ele reivindica com `FOR UPDATE SKIP LOCKED` tentativas sem conclusão há mais de 15 minutos, cria o mesmo contexto com kind `download_stale` a partir do claim (não de nonce/sessão/GUC), grava exatamente uma auditoria `abandoned` correspondente e depois, em job separado, remove attempts concluídos há mais de 30 dias. Crash/kill do runtime portanto não deixa download sem desfecho. Nenhuma função de aplicação pode marcar stale/abandoned; pgTAP cobre público/autenticado, sessão revogada após begin, corrida completion-versus-sweeper, replay, cron/grants, context mismatch/no-forge e exatamente um outcome.

Crie `private.authorize_image_file_download(actor,session,file_id)` com EXECUTE apenas para `axsys_bff` e método tipado correspondente. Ela revalida sessão, deriva tenant, exige ready/clean e permite somente: profile_avatar do próprio usuário (ou leitura administrativa explicitamente testada dentro da mesma empresa) e letterhead/signature da empresa ativa do ator. Depois da autorização, chama o core e retorna bucket/path/MIME/tamanho/hash/nome mais attemptId/nonce somente ao código server-only. `createAuthorizedDownload({ context, fileId, correlationId })` baixa o objeto exato, limita bytes ao tamanho registrado, confirma SHA-256 e passa o stream ao único `audited-download-streamer.ts`, que finaliza a tentativa em sucesso, abort do cliente ou falha — nunca uma URL Storage. ID inexistente, outro tenant/purpose, hash/tamanho divergente ou falta de acesso retorna o mesmo `FILE_NOT_FOUND`/falha segura. Planos 03–05 devem fazer seus authorizers relacionais chamar o mesmo core e suas rotas usar o mesmo streamer; o portal público usa contexto confiável derivado com actor/session nulos. Testes matriciais exigem uma auditoria por download/abort de avatar, branding, contrato, certidão pública/autenticada, proposta e documento de pagamento, sem path/nome/hash/token, e provam replay/nonce forjado/attempt de outro usuário negados. A resposta é `no-store`, attachment por padrão e nunca cacheada.

- [ ] **Step 10: Criar as três route handlers com guardas completas**

`POST src/app/api/files/uploads/route.ts` valida CSRF/Origin, usa `requireCompanyContext()`, rate limit `20/min/user`, schema de handshake e chama `createUploadIntent`.

`POST src/app/api/files/uploads/[intentId]/finalize/route.ts` aguarda `params`, valida UUID, repete CSRF/Origin/context/rate limit e chama finalize.

`GET src/app/api/files/[fileId]/download/route.ts` aguarda `params`, exige contexto, rate limit `60/min/user`, chama o streamer auditado e transmite a resposta final com `Content-Disposition: attachment; filename*=UTF-8''<nome-normalizado>`, MIME allowlisted, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache` e `Referrer-Policy: no-referrer`. Teste os headers/corpo e a conclusão/aborto auditada dessa resposta final; headers em redirect não contam.

Todas usam `correlationId`, `toErrorResponse` e mensagens neutras.

- [ ] **Step 11: Implementar a folha cliente TUS sem token de sessão**

Em `src/modules/files/ui/use-resumable-upload.ts`, crie `useResumableUpload()` que:

```ts
const upload = new tus.Upload(file, {
  endpoint: handshake.endpoint,
  retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
  headers: { 'x-signature': handshake.token, 'x-upsert': 'false' },
  chunkSize: 6 * 1024 * 1024,
  uploadDataDuringCreation: true,
  storeFingerprintForResuming: false,
  removeFingerprintOnSuccess: true,
  urlStorage: null,
  metadata: {
    bucketName: handshake.bucket,
    objectName: handshake.path,
    contentType: file.type,
    cacheControl: '0',
  },
  onProgress(bytesUploaded, bytesTotal) {
    setState({ kind: 'uploading', progress: Math.round((bytesUploaded / bytesTotal) * 100) })
  },
  onError() { setState({ kind: 'failed', code: 'UPLOAD_TRANSFER_FAILED' }) },
  onSuccess() { void finalize(handshake.intentId) },
})
upload.start()
```

Estados discriminados: `idle`, `validating`, `uploading`, `quarantined`, `scanning`, `ready`, `failed`. Retry/resume existe somente na memória da instância montada; não chame `findPreviousUploads()`. Abort/cleanup encerra a instância. Testes inspecionam localStorage e sessionStorage durante upload incompleto e garantem que não há fingerprint, TUS URL, signed token ou capability path persistido. Não use `getSession`, publishable JWT, path do usuário ou service key.

- [ ] **Step 12: Criar `ImageUploadField` acessível**

`src/modules/files/ui/image-upload-field.tsx` é uma folha `'use client'`: input com label/descrição/erro ligados por IDs, drop zone acionável por teclado, progresso com `role="progressbar"`, estado anunciado em `aria-live="polite"`, retry e cancelamento. Mostre preview somente com `URL.createObjectURL` e sempre execute `URL.revokeObjectURL` no cleanup.

- [ ] **Step 13: Implementar expiração, limpeza e reconciliação de quota**

Crie `private.claim_upload_authorizations_for_retirement(limit,worker_id)` e `private.complete_upload_authorization_retirement(intent_id,claim_id,expected_version)` somente para axsys_bff. Claim usa `FOR UPDATE SKIP LOCKED`, considera qualquer status ativado com `cleanup_not_before <= clock_timestamp()` e `authorization_retired_at is null`, toma um lease UUID/horário (recuperável após timeout) e retorna apenas intent ID + path exato + estado terminal necessário; não libera quota nem muda o estado de negócio. `expired-upload-cleaner.ts` remove o objeto exato de quarentena de modo idempotente e só então chama complete, que confere claim/version sob lock, define `authorization_retired_at`, zera e libera exatamente o `quota_hold_bytes` remanescente uma única vez; issued/finalizing vira expired, enquanto ready/rejected permanece como está. Falha de Storage registra somente código allowlisted, solta/expira o lease para retry e mantém a reserva contabilizada. Intents `reserved` antigos, cujo token nunca foi ativado/entregue, são reconciliados por uma função separada e podem ser cancelados cedo. `scripts/reconcile-file-storage.ts` executa lotes limitados, compara used/reserved/holds com intents/file_objects e os objetos esperados, reporta apenas IDs/contagens e sai nonzero em drift; adicione scripts `files:cleanup` e `files:reconcile`. Nenhuma função administrativa libera um capability hold ativado antes de `cleanup_not_before`.

Para assets substituíveis, o writer que troca avatar/timbrado/assinatura marca o anterior `archived`, define `retirement_not_before=clock_timestamp()+interval '30 days'` e mantém used_bytes. Crie claims owner-only `claim_unreferenced_file_objects_for_retirement`/`complete_file_object_retirement`. O claim também inclui qualquer `ready` de qualquer purpose promovido há mais de 48 horas cuja autorização originária já foi aposentada e que não possua FK viva em profile/settings/certificate_versions/contract_attachments/payment_requests/generated_documents. Ele bloqueia file+intent e marca claim antes de um attach; todo attach/version writer bloqueia a mesma file row e rejeita claim ativo. O worker remove primeiro o path privado exato e só então complete converte um ready abandonado para archived, fixa archived_at/storage_deleted_at/quota_released_at e decrementa used_bytes uma vez. Arquivos históricos referenciados nunca entram; falha mantém quota/lease e corrida attach-vs-GC produz exatamente um vencedor seguro. `files:cleanup` executa authorization e object claims. Testes cobrem finalize→aba fechada, todos os purposes, attach antes/depois do claim, delete-first, retry, double-complete, 30 dias e quota sem perdão silencioso.

Em `storage-quota.test.ts`, cubra near-limit, duas reservas concorrentes, três-intents/100-MiB per-user cap, um usuário malicioso abandonando handshakes sem bloquear o colega além de sua própria cota, 20 intents abandonados em usuários distintos, claim/lease concorrente, deleção Storage falha, retry, double-complete, finalize com tamanho final menor/maior que declarado, quota excedida sem URL assinada, generated file usage e reconciliação sem PII. Com relógio falso, prove que um signed token ainda válido não libera quota, que um TUS URL criado imediatamente antes de 2h não pode causar cleanup até depois das 24h+grace, que o quarantine object conservado força `409` em reuso com upsert false, que upload/finalize após o prazo seguro falha, e que tentar recriar o objeto depois do cleanup não gera órfão não contabilizado. Em produção, o runbook do plano 06 deve agendar `files:cleanup` a cada cinco minutos; localmente o comando é executável sob demanda e antes dos E2E.

- [ ] **Step 14: Rodar unitários e integração com scanner real**

Run:

```bash
npm run files:start
npm run test:unit -- tests/unit/files/upload-policy.test.ts
npm run test:integration -- tests/integration/files/upload-pipeline.test.ts
npm run test:integration -- tests/integration/files/storage-quota.test.ts
npm run files:cleanup
npm run files:reconcile
npm run typecheck
```

Expected: todos PASS; teste EICAR retorna `infected`; PNG/JPG/WebP válidos terminam `ready`; TypeScript sem erros.

- [ ] **Step 15: Commitar o substrato compartilhado**

```bash
git add supabase/migrations package.json src/lib/db/bff.ts src/lib/supabase/database.types.ts src/modules/files src/app/api/files scripts/reconcile-file-storage.ts tests/unit/files tests/integration/files
git commit -m "feat: add quarantined resumable upload pipeline"
```

### Task 5: Implementar criação compensável de empresa + primeiro admin

**Files:**
- Create via CLI: migration com sufixo `_platform_company_provisioning_rpcs.sql`
- Create: `src/modules/companies/schemas/company-schemas.ts`
- Create: `src/modules/users/server/auth-admin-gateway.ts`
- Create: `src/modules/companies/server/company-provisioner.ts`
- Create: `tests/integration/platform/company-provisioner.test.ts`
- Create: `src/app/api/platform/companies/route.ts`

- [ ] **Step 1: Escrever schemas falhos sem aceitar campos protegidos**

Em `src/modules/companies/schemas/company-schemas.ts`, teste antes em `tests/unit/companies/company-schemas.test.ts`:

```ts
const validInput = {
  legalName: 'Axsys Serviços Ltda.',
  tradeName: 'Axsys',
  cnpj: '12.345.678/0001-90',
  contactEmail: 'CONTATO@EXAMPLE.COM',
  contactPhone: '+55 85 99999-0000',
  timezone: 'America/Fortaleza',
  firstAdmin: {
    displayName: 'Maria Administradora',
    email: 'MARIA@EXAMPLE.COM',
    temporaryPassword: 'frase provisoria segura 2026',
    modules: ['administrative', 'financial'],
  },
}

expect(createCompanySchema.parse(validInput)).toMatchObject({
  cnpj: '12345678000190',
  contactEmail: 'contato@example.com',
  firstAdmin: { email: 'maria@example.com' },
})
expect(() => createCompanySchema.parse({ ...validInput, status: 'active' })).toThrow()
expect(() => createCompanySchema.parse({ ...validInput, companyId: crypto.randomUUID() })).toThrow()
```

O schema usa `.strict()`, reutiliza a password policy do plano 01, valida CNPJ com dígitos verificadores, deduplica módulos e aceita apenas `administrative|financial|certificates`.

Run: `npm run test:unit -- tests/unit/companies/company-schemas.test.ts`

Expected: FAIL com `createCompanySchema` ausente.

- [ ] **Step 2: Implementar os schemas de entrada e DTO de saída**

Exporte `createCompanySchema`, `updateCompanySchema`, `companyListFiltersSchema` e os tipos inferidos. `updateCompanySchema` exige `version: z.number().int().positive()` e aceita somente `legalName`, `tradeName`, `contactEmail`, `contactPhone` e `timezone`; status usa endpoint separado. A migration mantém uma allowlist versionada owner-only de zonas brasileiras canônicas (`America/Araguaina`, `Bahia`, `Belem`, `Boa_Vista`, `Campo_Grande`, `Cuiaba`, `Fortaleza`, `Maceio`, `Manaus`, `Noronha`, `Porto_Velho`, `Recife`, `Rio_Branco`, `Santarem`, `Sao_Paulo`) e um mapa explícito somente para `Brazil/Acre|DeNoronha|East|West`. O schema aceita identificador 1–255 sem controles/espaços; o writer exige match case-sensitive na allowlist/mapa e sempre persiste o canonical. POSIX/abreviações/outros aliases falham. Default/seed é `America/Fortaleza`; testes cobrem inválida, case, BRT/EST5EDT, cada alias mapeado, CAS e transição que impacta datas.

Run: `npm run test:unit -- tests/unit/companies/company-schemas.test.ts`

Expected: PASS.

- [ ] **Step 3: Escrever a saga falha com todas as fronteiras de falha**

Em `tests/integration/platform/company-provisioner.test.ts`, use interfaces injetadas e senha marcada como `SensitiveString` no fake. Crie testes separados para:

```ts
it('cria Auth antes do commit e devolve o registro confirmado', async () => {
  const result = await provisionCompany(deps, command)
  expect(deps.repository.reserve).toHaveBeenCalledOnce()
  expect(deps.auth.createUser).toHaveBeenCalledWith({
    email: 'maria@example.com',
    password: 'frase provisoria segura 2026',
    emailConfirm: true,
  })
  expect(deps.repository.commit).toHaveBeenCalledAfter(deps.auth.createUser)
  expect(result.company.status).toBe('active')
})

it('apaga e comprova a compensação quando o commit SQL falha', async () => {
  deps.repository.commit.mockRejectedValue(new Error('unique cnpj'))
  await expect(provisionCompany(deps, command)).rejects.toMatchObject({ code: 'COMPANY_CREATE_FAILED' })
  expect(deps.auth.deleteUser).toHaveBeenCalledWith(authUserId)
  expect(deps.repository.markCompensated).toHaveBeenCalledWith(operationId, 'DB_COMMIT_FAILED')
})

it('bane o Auth orphan e agenda reconciliação se delete falha', async () => {
  deps.repository.commit.mockRejectedValue(new Error('database unavailable'))
  deps.auth.deleteUser.mockRejectedValue(new Error('auth unavailable'))
  await expect(provisionCompany(deps, command)).rejects.toMatchObject({
    code: 'COMPANY_CREATE_COMPENSATION_PENDING',
  })
  expect(deps.auth.banUser).toHaveBeenCalledWith(authUserId)
  expect(deps.repository.markCompensationRequired).toHaveBeenCalled()
})
```

Cubra também falha no Auth sem empresa criada, replay da mesma `Idempotency-Key`, mesma chave com payload diferente (`409 IDEMPOTENCY_KEY_REUSED`), crash recuperado em `auth_created`, CNPJ concorrente e e-mail já cadastrado com mensagem neutra.

Run: `npm run test:integration -- tests/integration/platform/company-provisioner.test.ts`

Expected: FAIL com módulos ausentes.

- [ ] **Step 4: Gerar a migration das RPCs de provisionamento**

```bash
npx supabase migration new platform_company_provisioning_rpcs
MIGRATION_PATH="$(find supabase/migrations -type f -name '*_platform_company_provisioning_rpcs.sql' | sort | tail -1)"
test -n "$MIGRATION_PATH"
```

Expected: path gerado e status 0.

- [ ] **Step 5: Criar a reserva idempotente restrita a plataforma**

A migration cria `private.internal_reserve_company_provisioning(p_actor_user_id uuid,p_session_id uuid,p_idempotency_key text,p_request_hash text,p_subject_email_hash text,p_correlation_id uuid) returns public.provisioning_operations`, SECURITY DEFINER, `set search_path = ''`. Antes da lógica abaixo, ela exige `private.assert_auth_session(p_session_id,p_actor_user_id)`. A implementação deve:

```sql
if not exists (
  select 1 from public.platform_roles
  where user_id = p_actor_user_id and role = 'super_admin' and is_active
) then
  raise exception using errcode = '42501', message = 'AXSYS_PLATFORM_REQUIRED';
end if;

select * into v_existing
from public.provisioning_operations
where actor_user_id = p_actor_user_id and idempotency_key = p_idempotency_key
for update;

if found then
  if v_existing.request_hash <> p_request_hash then
    raise exception using errcode = 'P0001', message = 'AXSYS_IDEMPOTENCY_KEY_REUSED';
  end if;
  return v_existing;
end if;

insert into public.provisioning_operations (
  idempotency_key, request_hash, kind, actor_user_id, subject_email_hash,
  status, correlation_id
) values (
  p_idempotency_key, p_request_hash, 'company_first_admin', p_actor_user_id,
  p_subject_email_hash, 'reserved', p_correlation_id
) returning * into v_existing;
return v_existing;
```

Revogue de `PUBLIC`, `anon`, `authenticated` e `service_role`; conceda somente a `axsys_bff` e adicione um método tipado explícito a `bffDb`.

- [ ] **Step 6: Criar RPCs de transição e compensação**

Crie todas em schema `private`, com search path vazio, validação de ator/sessão, lock da operation, EXECUTE apenas para `axsys_bff` e método tipado correspondente em `bffDb`:

```sql
private.internal_mark_provisioning_auth_created(
  p_operation_id uuid, p_actor_user_id uuid, p_session_id uuid, p_auth_user_id uuid
) returns void

private.internal_commit_company_provisioning(
  p_operation_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_auth_user_id uuid,
  p_company_id uuid,
  p_legal_name text,
  p_trade_name text,
  p_cnpj_normalized text,
  p_contact_email extensions.citext,
  p_contact_phone text,
  p_timezone text,
  p_admin_display_name text,
  p_admin_email extensions.citext,
  p_modules public.module_key[],
  p_correlation_id uuid
) returns jsonb

private.internal_mark_provisioning_compensation(
  p_operation_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_status public.provisioning_status,
  p_error_code text
) returns void
```

`internal_commit_company_provisioning` executa em uma transação implícita da função:

1. Exige operation `auth_created`, mesmo ator e mesmo `auth_user_id`.
2. Resolve `p_timezone` pela allowlist/mapa owner-only, grava o resultado em `v_timezone` e insere `companies.timezone=v_timezone`; entrada inválida aborta a saga antes de qualquer linha empresarial.
3. Insere explicitamente `profiles(user_id,email,display_name,preferred_theme,must_change_password,temporary_password_expires_at,is_active)` com tema `dark`, flag `true` e expiração `clock_timestamp()+interval '24 hours'`. O plano 01 não cria profile por trigger.
4. Insere `company_memberships` como `company_admin/active` e `member_modules` para o array validado.
5. Insere `company_settings` vazia com `updated_by=p_actor_user_id`.
6. Marca operation `committed` e `company_id`.
7. Insere `audit_events(scope='platform', action='company.created', resource_type='company', resource_id=p_company_id, outcome='success')` com metadata somente `{ "firstAdminUserId": authUserId, "moduleCount": n }`.
8. Retorna JSON com company, membership e modules persistidos; nunca retorna senha.

- [ ] **Step 7: Implementar o gateway Auth Admin estreito**

`src/modules/users/server/auth-admin-gateway.ts` exporta interface e factory lazy:

```ts
export type AuthAdminGateway = {
  createUser(input: {
    email: string
    password: string
    emailConfirm: true
  }): Promise<{ id: string }>
  banUser(userId: string): Promise<void>
  unbanUser(userId: string): Promise<void>
  deleteUser(userId: string): Promise<void>
}
```

Mapeie para `auth.admin.createUser({ email, password, email_confirm: true })`, `updateUserById({ ban_duration: '876000h' })`, `updateUserById({ ban_duration: 'none' })` e `deleteUser(id, false)`. Reset de senha reutiliza o serviço Auth do plano 01. Não grave papel, company, módulos ou estado de provisionamento em `raw_user_meta_data`; autorização permanece no banco. Redija e-mail nos logs e nunca passe password para logger/telemetria.

- [ ] **Step 8: Implementar `provisionCompany` com replay e reconciliação**

`src/modules/companies/server/company-provisioner.ts` exporta:

```ts
export async function provisionCompany(
  deps: CompanyProvisioningDependencies,
  command: {
    actorUserId: string
    idempotencyKey: string
    correlationId: string
    input: CreateCompanyInput
  },
): Promise<ProvisionedCompany>

export async function reconcileCompanyProvisioning(
  deps: CompanyProvisioningDependencies,
  operationId: string,
): Promise<'committed' | 'compensated' | 'compensation_required'>
```

Calcule request hash de JSON canônico substituindo `temporaryPassword` por um fingerprint HMAC com segredo de servidor; assim a senha não é persistida e a mesma chave com senha diferente ainda conflita. O hash de e-mail também usa HMAC, não SHA simples. Replay `committed` devolve o resultado existente; `reserved` retoma Auth; `auth_created` retoma commit. Um reconciliador de `reserved` compara o HMAC dos e-mails retornados por paginação Auth Admin para localizar um user criado antes de um crash. Ao compensar, confirme `deleteUser`; se falhar, `banUser` e marque para `/platform/saude`.

- [ ] **Step 9: Criar POST `/api/platform/companies` com todos os gates**

O POST de `src/app/api/platform/companies/route.ts`:

```ts
const correlationId = getCorrelationId(request)
const env = getServerEnv()
assertMutationOrigin(request.headers.get('origin'), env.APP_ORIGIN)
const store = await cookies()
assertCsrf(
  request.headers.get('x-csrf-token'),
  store.get('__Host-axsys-csrf')?.value ?? null,
  env.CSRF_SECRET,
)
const context = await requirePlatformContext()
await requireRecentAuthentication(context, 600)
const idempotencyKey = z.string().min(16).max(128).parse(request.headers.get('idempotency-key'))
const input = createCompanySchema.parse(await request.json())
const result = await provisionCompany(deps, {
  actorUserId: context.userId,
  idempotencyKey,
  correlationId,
  input,
})
return withNoStore(Response.json(result, { status: 201 }))
```

Rate limit: 10 tentativas/hora/Super Admin. CNPJ/e-mail duplicado retornam `409 COMPANY_CONFLICT` sem revelar conta Auth. `temporaryPassword` nunca aparece na resposta.

- [ ] **Step 10: Rodar DB, integração e verificar ausência de senha**

Run:

```bash
npm run db:reset
npm run db:test
npm run test:integration -- tests/integration/platform/company-provisioner.test.ts
rg -n "temporaryPassword|password" src/modules/companies src/app/api/platform/companies
```

Expected: testes PASS; o `rg` encontra apenas leitura do input e chamada do gateway, nunca log, retorno, audit metadata ou SQL.

- [ ] **Step 11: Commitar a unidade lógica de provisionamento**

```bash
git add supabase/migrations src/lib/db/bff.ts src/lib/supabase/database.types.ts src/modules/companies src/modules/users/server/auth-admin-gateway.ts src/app/api/platform/companies/route.ts tests/unit/companies tests/integration/platform/company-provisioner.test.ts
git commit -m "feat: provision companies with compensating admin saga"
```

### Task 6: Entregar CRUD, arquivamento e reativação de empresas

**Files:**
- Create via CLI: migration com sufixo `_platform_company_management_rpcs.sql`
- Create: `src/modules/companies/server/company-service.ts`
- Create: `src/modules/platform/server/platform-repository.ts`
- Create: `src/app/api/platform/companies/[companyId]/route.ts`
- Create: `src/app/api/platform/companies/[companyId]/status/route.ts`
- Create: `tests/integration/platform/company-api.test.ts`

- [ ] **Step 1: Escrever testes falhos do contrato HTTP**

Em `tests/integration/platform/company-api.test.ts`, teste:

- GET lista com busca, status, cursor e limite máximo 100; resposta `no-store`/`Vary`.
- GET detail aceita UUID e devolve apenas empresa, admins, bancos mascarados e contadores administrativos; nunca consulta tabelas operacionais.
- PATCH exige `version`; duas atualizações com versão 4 produzem um 200 e um 409 com `current.version=5`.
- companyId inexistente e ID válido sem autorização retornam o mesmo 404.
- archive exige `requireRecentAuthentication(context, 600)` e versão, bloqueia novas operações imediatamente e registra audit.
- reactivate restaura acesso somente de memberships que já estavam ativas.
- GET em `/platform` por usuário empresarial retorna 403; Super Admin nunca é redirecionado para `/app` por query param.

Run: `npm run test:integration -- tests/integration/platform/company-api.test.ts`

Expected: FAIL com routes/serviços ausentes.

- [ ] **Step 2: Gerar migration de management**

```bash
npx supabase migration new platform_company_management_rpcs
MIGRATION_PATH="$(find supabase/migrations -type f -name '*_platform_company_management_rpcs.sql' | sort | tail -1)"
test -n "$MIGRATION_PATH"
```

Expected: path gerado pelo CLI.

- [ ] **Step 3: Criar update otimista e status com lock**

Crie `private.internal_update_company` e `private.internal_set_company_status`, com actor/session revalidados, `set search_path=''`, EXECUTE revogado de service_role e concedido somente a axsys_bff; adicione métodos tipados ao bffDb.

Antes do UPDATE, `internal_update_company` resolve `p_timezone` pela mesma allowlist/mapa, guarda o canonical em `v_timezone` e o snippet abaixo deve atribuir `timezone = v_timezone`, nunca `p_timezone`; ausência/ambiguidade falha com `AXSYS_INVALID_TIMEZONE`. Testes SQL provam que nenhum valor não canônico chega a `timezone(companies.timezone, ...)`.

O update usa:

```sql
update public.companies
set legal_name = p_legal_name,
    trade_name = p_trade_name,
    contact_email = p_contact_email,
    contact_phone = p_contact_phone,
    timezone = v_timezone
where id = p_company_id and version = p_expected_version
returning * into v_company;

if not found then
  if exists (select 1 from public.companies where id = p_company_id) then
    raise exception using errcode = 'P0001', message = 'AXSYS_VERSION_CONFLICT';
  end if;
  raise exception using errcode = 'P0001', message = 'AXSYS_COMPANY_NOT_FOUND';
end if;
```

O status bloqueia a linha com `select id,status,version from public.companies where id=p_company_id for update`, confere versão, altera `status/archived_at/archived_by`, e audita `company.archived` ou `company.reactivated` na mesma transação. O trigger `companies_touch_version` do plano 01 incrementa versão/updated_at uma única vez. Repetir o mesmo destino com a nova versão é idempotente; versão antiga continua 409.

- [ ] **Step 4: Implementar repository com seleção allowlisted e paginação keyset**

`platform-repository.ts` nunca usa `select('*')`. A lista seleciona `id,legal_name,trade_name,cnpj_normalized,contact_email,contact_phone,timezone,status,version,created_at,updated_at`, ordena `(created_at desc,id desc)` e codifica cursor JSON em base64url validado por Zod. Detail seleciona apenas tabelas base deste plano; não importe módulos administrative, finance, contracts ou certificates.

- [ ] **Step 5: Implementar serviço e revogação defensiva de acesso**

Após commit de archive, liste `user_id` das memberships e chame `authAdminGateway.banUser` em lotes de 10. Falha não reabre o tenant: `requireCompanyContext` consulta company ativa e bloqueia imediatamente; registre `security_events`/health reconciliation sem PII. Reactivate chama `unbanUser` apenas para memberships `active`. O endpoint retorna `accessReconciliation: 'complete'|'pending'`.

- [ ] **Step 6: Criar handlers GET/PATCH/status**

`src/app/api/platform/companies/[companyId]/route.ts` exporta GET/PATCH; `params` é `Promise<{ companyId: string }>` e deve ser aguardado no Next 16. PATCH aplica Origin, CSRF e `requireRecentAuthentication(context, 600)`. `status/route.ts` aceita schema estrito `{ action: 'archive'|'reactivate', version, reason }`; reason obrigatório entre 10 e 500 caracteres para archive.

Toda resposta usa `withNoStore(Response.json(body, init))` do plano 01. Mapeie `AXSYS_VERSION_CONFLICT` para 409 com o snapshot allowlisted atual; não sobrescreva silenciosamente.

- [ ] **Step 7: Rodar integração e advisors**

Run:

```bash
npm run db:reset
npm run test:integration -- tests/integration/platform/company-api.test.ts
npx supabase db advisors --local
```

Expected: PASS; nenhum advisor novo de segurança ou índice faltante nas queries de status/lista.

- [ ] **Step 8: Commitar CRUD de empresa**

```bash
git add supabase/migrations src/lib/db/bff.ts src/lib/supabase/database.types.ts src/modules/companies/server/company-service.ts src/modules/platform/server/platform-repository.ts src/app/api/platform/companies tests/integration/platform/company-api.test.ts
git commit -m "feat: manage company lifecycle on platform"
```

### Task 7: Gerenciar administradores, usuários, módulos e senha provisória

**Files:**
- Create via CLI: migration com sufixo `_company_membership_management_rpcs.sql`
- Create: `src/modules/users/schemas/user-schemas.ts`
- Create: `src/modules/users/server/user-provisioner.ts`
- Create: `src/modules/users/server/user-service.ts`
- Modify/reuse: `src/modules/auth/server/set-temporary-password.ts`
- Create: platform routes sob `src/app/api/platform/companies/[companyId]/admins/` e `src/app/api/platform/admins/[membershipId]/`
- Create: company routes sob `src/app/api/company/users/`
- Create: `tests/integration/users/company-users-api.test.ts`
- Create: `tests/integration/users/temporary-password.test.ts`

- [ ] **Step 1: Escrever os testes falhos de autorização e último admin**

Em `company-users-api.test.ts`, cubra:

```ts
it('admin A cannot inspect or mutate membership B', async () => {
  const get = await asAdminA.get(`/api/company/users/${membershipB}`)
  const patch = await asAdminA.patch(`/api/company/users/${membershipB}`, {
    role: 'member', modules: ['financial'], status: 'active', version: 1,
  })
  expect(get.status).toBe(404)
  expect(patch.status).toBe(404)
})

it('cannot suspend or demote the last active admin', async () => {
  const response = await asOnlyAdmin.patch(`/api/company/users/${onlyAdminMembership}`, {
    role: 'member', modules: [], status: 'suspended', version: 1,
  })
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ error: { code: 'LAST_ACTIVE_ADMIN' } })
})

it('admin management works even without operational modules', async () => {
  const response = await asAdminWithoutModules.get('/api/company/users')
  expect(response.status).toBe(200)
})
```

Inclua: member comum 403, self role/status/modules bloqueados, `company_id` e `user_id` no payload rejeitados, módulo fora dos três rejeitado, mudança concorrente 409, empresa arquivada 403 e mudança de permissão exigindo `requireRecentAuthentication(context, 600)`.

- [ ] **Step 2: Escrever testes falhos de criação/reset provisório**

Em `temporary-password.test.ts`, prove:

1. create user chama Auth Admin no servidor, persiste perfil/membership/modules como unidade e marca expiração em 24h.
2. falha do commit apaga/ban o Auth user pela mesma saga da Task 5.
3. reset administrativo recusa self, exige `requireRecentAuthentication(context, 600)`, troca senha, marca `must_change_password`, bloqueia rotas empresariais e invalida refresh da sessão antiga.
4. access token antigo ainda criptograficamente válido recebe redirect/403 no BFF e zero linhas em chamadas PostgREST diretas porque `get-access-context` e `private.has_active_app_session()` relêem flag/revogação em cada acesso.
5. fluxo `/forgot-password` do plano 01 continua funcionando e não limpa a regra de temporary password sem troca bem-sucedida.
6. senha não aparece em DB, audit, logs capturados ou response body.

Run:

```bash
npm run test:integration -- tests/integration/users/company-users-api.test.ts tests/integration/users/temporary-password.test.ts
```

Expected: FAIL por serviços/routes ausentes.

- [ ] **Step 3: Implementar schemas estritos**

`user-schemas.ts` exporta:

```ts
export const createCompanyUserSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: normalizedEmailSchema,
  temporaryPassword: passwordSchema,
  role: z.enum(['company_admin', 'member']),
  modules: z.array(z.enum(['administrative', 'financial', 'certificates'])).max(3),
}).strict()

export const updateCompanyUserSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  role: z.enum(['company_admin', 'member']),
  modules: z.array(z.enum(['administrative', 'financial', 'certificates'])).max(3),
  status: z.enum(['active', 'suspended']),
  suspensionReason: z.string().trim().min(10).max(500).nullable(),
  version: z.number().int().positive(),
}).strict()

export const temporaryPasswordResetSchema = z.object({
  temporaryPassword: passwordSchema,
  reason: z.string().trim().min(10).max(500),
}).strict()
```

Normalize/deduplique/sort modules antes do hash/audit.

- [ ] **Step 4: Gerar migration das RPCs de membership**

```bash
npx supabase migration new company_membership_management_rpcs
MIGRATION_PATH="$(find supabase/migrations -type f -name '*_company_membership_management_rpcs.sql' | sort | tail -1)"
test -n "$MIGRATION_PATH"
```

Expected: migration criada pelo CLI.

- [ ] **Step 5: Criar reserva/commit de membro autenticados**

Crie `company_reserve_member_provisioning` e `company_commit_member_provisioning`. Ambas são `security definer`, `set search_path=''`, revogadas de `PUBLIC/anon` e concedidas a `authenticated`. A primeira deriva ator de `(select auth.uid())`, exige `private.has_company_role(company_id,'company_admin')` e tenant ativo; a segunda repete as guardas dentro da transação, nunca confia em company do browser, insere explicitamente o profile depois que Auth existe, insere membership/modules, marca operation e audita `tenant user.created`.

Para o portal da plataforma, crie wrappers `private.internal_reserve_company_admin_provisioning` e `private.internal_commit_company_admin_provisioning`, somente `axsys_bff`, que validam ator/sessão/Super Admin e forçam `role='company_admin'`; exponha somente métodos tipados no bffDb.

- [ ] **Step 6: Criar mutation RPC com proteção em profundidade**

`company_update_membership(p_membership_id,p_display_name,p_role,p_status,p_modules,p_reason,p_expected_version,p_correlation_id)`:

- deriva company do ator e busca alvo por `(id, company_id)`; outro tenant vira `AXSYS_MEMBERSHIP_NOT_FOUND`;
- rejeita alterar a si mesmo em `role`, `status` ou modules com `AXSYS_SELF_PRIVILEGE_CHANGE`;
- atualiza por `where id=p_membership_id and company_id=v_actor_company_id and version=p_expected_version`; zero rows com alvo existente gera `AXSYS_VERSION_CONFLICT`;
- substitui `member_modules` na mesma transação;
- sincroniza `profiles.is_active` com o status efetivo, sem tocar e-mail, senha ou tema;
- deixa o trigger da Task 3 serializar a proteção de último admin;
- audita somente role/status/module names, sem e-mail completo ou reason bruto; reason entra como `reason_code` categorizado.

Crie wrapper `private.internal_platform_update_company_admin` com as mesmas invariantes, sessão ativa e EXECUTE somente para axsys_bff.

A própria função privada purpose-specific de suspensão valida actor/session/role/tenant, seta `app.actor_id`, inativa profile/membership e chama o core owner-only de revogação de sessões na mesma transação; não existe chamada/método genérico `revoke_auth_sessions(targetUserId,...)` no serviço. Só depois `user-service.ts` chama `authAdminGateway.banUser`; reativação chama `unbanUser`. Se Auth estiver indisponível, profile/membership inativos mantêm o BFF fail-closed e a reconciliação aparece em `/platform/saude`.

- [ ] **Step 7: Implementar `userProvisioner` reutilizando a saga**

`user-provisioner.ts` recebe `CompanyAccessContext | PlatformAccessContext`, escolhe a reserve/commit correta, cria Auth user, marca auth-created, faz commit e compensa igual à Task 5. A assinatura pública:

```ts
export async function provisionCompanyUser(
  deps: UserProvisioningDependencies,
  command: {
    actor: AccessContext
    companyId: string
    idempotencyKey: string
    correlationId: string
    input: CreateCompanyUserInput
    platformAdminOnly: boolean
  },
): Promise<CompanyUserDto>
```

Se `platformAdminOnly`, rejeite `role='member'`; se ator empresarial, ignore qualquer companyId externo e use `context.companyId`.

- [ ] **Step 8: Reutilizar o reset fail-closed do plano 01**

Não crie outro serviço de credencial. Os adapters desta task chamam `setTemporaryPassword({ actor, targetUserId, password, correlationId })` de `src/modules/auth/server/set-temporary-password.ts`, que já usa a saga durável do plano 01: reserva/flag/revogação/RLS antes de Auth, conclusão ou falha sem reabrir acesso e retry reconciliável. Acrescente somente: proibição explícita de self, mapeamento uniforme de outro tenant para 404 e `reason` categorizado no evento sem texto sensível. Mantenha pgTAP, fault-injection e E2E do plano 01 verdes junto aos novos testes de UI/IDOR.

- [ ] **Step 9: Criar routes de plataforma e empresa sem duplicar regra**

Crie:

```text
src/app/api/platform/companies/[companyId]/admins/route.ts             GET, POST
src/app/api/platform/admins/[membershipId]/route.ts                    PATCH
src/app/api/platform/admins/[membershipId]/reset-password/route.ts     POST
src/app/api/company/users/route.ts                                     GET, POST
src/app/api/company/users/[membershipId]/route.ts                      GET, PATCH
src/app/api/company/users/[membershipId]/reset-password/route.ts       POST
```

Todos os POST/PATCH exigem Origin, CSRF, `requireRecentAuthentication(context, 600)` e idempotency quando criam. Plataforma usa `requirePlatformContext`; empresa usa `requireCompanyContext()` e confere `role==='company_admin'`, sem exigir módulo operacional. Erro cross-tenant é 404 neutro. Após mutação, publique somente os scopes canônicos `users`, `platform-admins`, `navigation` e `session` aplicáveis; a UI não faz update otimista de permissão.

- [ ] **Step 10: Rodar a matriz de usuários e RLS**

Run:

```bash
npm run db:reset
npm run db:test
npm run test:integration -- tests/integration/users/company-users-api.test.ts tests/integration/users/temporary-password.test.ts
```

Expected: PASS; o teste concorrente mantém um admin ativo; acesso antigo é bloqueado imediatamente.

- [ ] **Step 11: Commitar gestão de acesso empresarial**

```bash
git add supabase/migrations src/lib/db/bff.ts src/lib/supabase/database.types.ts src/modules/users 'src/app/api/platform/companies/[companyId]/admins' src/app/api/platform/admins src/app/api/company/users tests/integration/users
git commit -m "feat: manage company users modules and temporary passwords"
```

### Task 8: Implementar contas bancárias cifradas e default concorrente

**Files:**
- Create via CLI: migration com sufixo `_platform_bank_account_rpcs.sql`
- Create: `src/modules/bank-accounts/schemas/bank-account-schemas.ts`
- Create: `src/modules/bank-accounts/server/bank-account-crypto.ts`
- Create: `src/modules/bank-accounts/server/bank-account-service.ts`
- Create: routes sob `src/app/api/platform/companies/[companyId]/bank-accounts/`
- Create: `tests/unit/bank-accounts/bank-account-crypto.test.ts`
- Create: `tests/integration/platform/bank-accounts-api.test.ts`

- [ ] **Step 1: Escrever testes falhos de cifra/máscara**

```ts
it('uses company+bankAccount+field as AAD and keeps only last4 searchable', () => {
  const encrypted = encryptBankAccount({
    companyId: 'company-a', bankAccountId: 'bank-a', branch: '1234-5', account: '987654-3', holderDocument: '12345678901',
  }, keyring)
  expect(encrypted).toMatchObject({ branchLast4: '2345', accountLast4: '6543', holderDocumentLast4: '8901' })
  expect(JSON.stringify(encrypted)).not.toContain('987654-3')
  expect(() => decryptBankField(encrypted.account, keyring, 'company-b', 'bank-a', 'account')).toThrow()
  expect(() => decryptBankField(encrypted.account, keyring, 'company-a', 'bank-b', 'account')).toThrow()
  expect(() => decryptBankField(encrypted.account, keyring, 'company-a', 'bank-a', 'branch')).toThrow()
})
```

Inclua rotação `keyVersion=1`, chave ausente e masking de 1–4 caracteres.

Run: `npm run test:unit -- tests/unit/bank-accounts/bank-account-crypto.test.ts`

Expected: FAIL com módulo ausente.

- [ ] **Step 2: Implementar schemas e crypto adapter**

O schema de create aceita `bankCode`, `bankName`, `branch`, `account`, `accountType`, `holderName`, `holderDocument?` e `makeDefault`; update exige `version` e nunca aceita `companyId`, ciphertext, IV, tag, keyVersion, status ou `isDefault` diretamente.

`bank-account-crypto.ts` chama `readEncryptionKey('BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64')` dentro da operação, nunca no import. O `bankAccountId` UUID é gerado pelo servidor antes da cifragem e é obrigatório em `encryptBankAccount`/`decryptBankField`; AADs exatos: `bank:${companyId}:${bankAccountId}:branch`, `bank:${companyId}:${bankAccountId}:account`, `bank:${companyId}:${bankAccountId}:holderDocument`. Normalize números antes de cifrar e exponha somente `maskBankSummary`. Exporte uma fixture cifrada versionada consumida novamente pelo plano 05; company, bankAccountId ou field errados devem falhar autenticação.

- [ ] **Step 3: Escrever integração falha de default e sigilo**

Teste:

- primeira conta ativa vira default mesmo que `makeDefault=false`;
- criar/setar duas defaults concorrentemente resulta exatamente uma default;
- trocar default limpa a anterior na mesma transação;
- arquivar default exige `replacementDefaultId` ativo da mesma empresa, salvo se não restar conta ativa;
- version conflito retorna 409 com resumo mascarado, nunca ciphertext;
- reauth é exigida em create/update/default/archive;
- Admin/Finance empresarial lê view mascarada, não muta;
- outro tenant e member sem Finance recebem 404/403 sem inferência;
- logs/audit não contêm agência, conta ou documento completos.

Run: `npm run test:integration -- tests/integration/platform/bank-accounts-api.test.ts`

Expected: FAIL com serviço/RPC ausente.

- [ ] **Step 4: Gerar migration bancária**

```bash
npx supabase migration new platform_bank_account_rpcs
MIGRATION_PATH="$(find supabase/migrations -type f -name '*_platform_bank_account_rpcs.sql' | sort | tail -1)"
test -n "$MIGRATION_PATH"
```

Expected: migration criada pelo CLI.

- [ ] **Step 5: Criar RPC única de upsert com lock por empresa**

`internal_upsert_bank_account` recebe apenas ciphertext/IV/tag/version/last4 já produzidos pelo servidor e campos públicos. Ela:

```sql
perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 2108));
perform 1 from public.companies
  where id = p_company_id and status = 'active'
  for update;
if not found then
  raise exception using errcode = 'P0001', message = 'AXSYS_COMPANY_NOT_FOUND';
end if;

select not exists (
  select 1 from public.company_bank_accounts
  where company_id = p_company_id and status = 'active'
) into v_make_default;
v_make_default := v_make_default or p_make_default;

if v_make_default then
  update public.company_bank_accounts
  set is_default = false, version = version + 1, updated_at = now(), updated_by = p_actor_user_id
  where company_id = p_company_id and status = 'active' and is_default;
end if;
```

Depois insira/update com expected version e audit `bank_account.created|updated`; metadata recebe apenas `bankCode`, `accountLast4`, `madeDefault` e `keyVersion`.

- [ ] **Step 6: Criar RPCs de default/archive atômicas**

`internal_set_default_bank_account` usa o mesmo advisory lock, exige conta ativa `(id,company_id)`, confere expected version, limpa default anterior e marca alvo.

`internal_archive_bank_account` usa o lock, confere versão e:

- se alvo default e existe outra ativa, exige replacement ID da mesma empresa e a promove;
- se alvo é a última ativa, permite ficar sem default;
- seta alvo `archived`, `is_default=false`, timestamps/version;
- audita na transação.

Todas ficam em `private`, revalidam ator/sessão/Super Admin, têm EXECUTE somente para axsys_bff e são chamadas por métodos tipados do bffDb; service_role permanece somente no gateway Auth/Storage.

- [ ] **Step 7: Implementar serviço sem plaintext fora do frame**

`bank-account-service.ts` gera ID antes de cifrar para compor AAD, cifra, chama RPC e sobrescreve variáveis de Buffer com `fill(0)` em `finally`. DTOs de retorno são `BankAccountSummary`; detail descriptografado é permitido somente em uma chamada de plataforma com `requireRecentAuthentication(context, 600)` e nunca serializa documento integral por padrão.

- [ ] **Step 8: Criar routes de plataforma e leitura empresarial**

```text
src/app/api/platform/companies/[companyId]/bank-accounts/route.ts             GET, POST
src/app/api/platform/companies/[companyId]/bank-accounts/[bankAccountId]/route.ts PATCH
src/app/api/platform/companies/[companyId]/bank-accounts/[bankAccountId]/default/route.ts POST
src/app/api/platform/companies/[companyId]/bank-accounts/[bankAccountId]/archive/route.ts POST
src/app/api/company/settings/bank-accounts/route.ts                           GET somente view
```

Mutations: platform guard + Origin + CSRF + `requireRecentAuthentication(context, 600)`. GET empresarial: `requireCompanyContext()`, depois role admin ou module financial; consulta `company_bank_account_summaries` com o cliente do usuário. Todas `no-store`.

- [ ] **Step 9: Provar concorrência e ciphertext**

Run:

```bash
npm run db:reset
npm run test:unit -- tests/unit/bank-accounts/bank-account-crypto.test.ts
npm run test:integration -- tests/integration/platform/bank-accounts-api.test.ts
npm run db:test
```

Expected: PASS; query SQL confirma uma default no máximo; busca por plaintext em colunas e logs retorna zero.

- [ ] **Step 10: Commitar bancos isoladamente**

```bash
git add supabase/migrations src/lib/db/bff.ts src/lib/supabase/database.types.ts src/modules/bank-accounts 'src/app/api/platform/companies/[companyId]/bank-accounts' src/app/api/company/settings/bank-accounts tests/unit/bank-accounts tests/integration/platform/bank-accounts-api.test.ts
git commit -m "feat: manage encrypted company bank accounts"
```

### Task 9: Montar o portal `/platform`, auditoria e saúde operacional

**Files:**
- Create: pages sob `src/app/(protected)/platform/`
- Create: `src/modules/platform/ui/platform-dashboard.tsx`
- Create: `src/modules/platform/ui/company-list.tsx`
- Create: `src/modules/platform/ui/company-form.tsx`
- Create: `src/modules/platform/ui/company-detail.tsx`
- Create: `src/modules/platform/ui/admin-form.tsx`
- Create: `src/modules/platform/ui/bank-account-dialog.tsx`
- Create: `src/modules/platform/server/platform-health.ts`
- Create: `src/modules/audit/server/list-platform-audit-events.ts`
- Create: `src/modules/audit/ui/platform-audit-table.tsx`
- Create: `src/app/api/platform/audit/route.ts`
- Create: `src/app/api/platform/health/route.ts`
- Modify: `src/components/layout/platform-shell.tsx`
- Create: `tests/e2e/platform-companies.spec.ts`

- [ ] **Step 1: Escrever o E2E falho do portal separado**

Em `tests/e2e/platform-companies.spec.ts`, autentique o Super Admin do fixture e prove:

```ts
await page.goto('/platform')
await expect(page.getByRole('heading', { name: 'Visão da plataforma' })).toBeVisible()
await expect(page.getByRole('navigation', { name: 'Plataforma' })).toContainText('Empresas')
await expect(page.getByRole('navigation', { name: 'Plataforma' })).not.toContainText('Propostas')
await page.goto('/app/dashboard')
await expect(page).toHaveURL('/platform')
```

Depois crie empresa + primeiro admin, edite com versão, adicione admin, conta/default, arquive/reative e filtre audit. Confirme que senha e conta integral nunca aparecem no DOM. Como usuário empresarial, navegar diretamente a `/platform/empresas` deve redirecionar a `/app/dashboard` ou mostrar 403 sem shell de plataforma.

Run: `npm run test:e2e -- tests/e2e/platform-companies.spec.ts`

Expected: FAIL porque pages ainda não existem.

- [ ] **Step 2: Criar pages Server Component com leitura fresca**

Crie estes arquivos, todos sem `'use client'`, com `export const dynamic = 'force-dynamic'`, `await requirePlatformContext()` e repositório direto no servidor:

```text
src/app/(protected)/platform/page.tsx
src/app/(protected)/platform/empresas/page.tsx
src/app/(protected)/platform/empresas/[companyId]/page.tsx
src/app/(protected)/platform/administradores/page.tsx
src/app/(protected)/platform/auditoria/page.tsx
src/app/(protected)/platform/saude/page.tsx
```

Em `[companyId]/page.tsx`, `params` é Promise e o ID passa por `z.string().uuid()` antes da query. Use `notFound()` para ID ausente/não permitido. Busque cards independentes em `Promise.all` e passe DTOs serializáveis para folhas cliente.

- [ ] **Step 3: Criar loading/error/empty states por segmento**

Crie `loading.tsx` para `/platform`, `/empresas` e `/auditoria` com Skeleton shadcn; `error.tsx` é uma folha cliente com correlation ID redigido e botão retry de 44 px. Lista define estados `empty`, `no-results`, `temporarily-unavailable`; acesso negado nunca é confundido com lista vazia.

- [ ] **Step 4: Atualizar o shell com navegação exclusiva**

`platform-shell.tsx` usa `Buildings`, `UsersThree`, `ShieldCheck`, `Heartbeat` e `SignOut` de `@phosphor-icons/react`. Desktop tem sidebar fixa; tablet recolhível; móvel usa `Sheet` com overlay, Escape, focus trap e retorno de foco. Links: Visão geral, Empresas, Administradores, Auditoria e Saúde. Nenhum link operacional empresarial aparece.

- [ ] **Step 5: Implementar formulários como folhas cliente**

`company-form.tsx`, `admin-form.tsx` e `bank-account-dialog.tsx` são os únicos componentes interativos de suas árvores. Use `react-hook-form@7.81.0`, `zodResolver` e os schemas desta entrega, todos já fixados pelo plano 01. Senha provisória usa `type=password`, autocomplete `new-password`, indicador textual e limpeza do state depois do submit. Conta usa `autocomplete=off`, nunca reidrata plaintext e fecha/zera ao sucesso.

- [ ] **Step 6: Implementar auditoria de plataforma com cursor**

`list-platform-audit-events.ts` usa `bffDb.listPlatformAuditEvents`, cuja função privada revalida ator/sessão/Super Admin e retorna somente `scope='platform'` com campos `id,actor_user_id,action,resource_type,resource_id,outcome,reason_code,correlation_id,metadata,occurred_at`, keyset `(occurred_at,id)` e limite máximo 100. Não usa admin client nem SELECT de tabela. Sanitize metadata novamente na saída e permita apenas chaves conhecidas: `moduleCount`, `bankCode`, `accountLast4`, `madeDefault`, `previousStatus`, `nextStatus`, `accessReconciliation`.

`GET /api/platform/audit` exige platform context, filtros Zod, rate limit e `no-store`. `platform-audit-table.tsx` vira cards no móvel, filtros em Sheet e chips ativos; timestamps/IDs usam Geist Mono.

- [ ] **Step 7: Implementar health real, sem controles simulados**

`platform-health.ts` consulta em paralelo: `bffDb.getPlatformHealth` (função privada que valida ator/sessão/Super Admin e retorna DB time, compensações, cleanup_required, scans failed, quota/used/reserved e drift por empresa), status do Auth `/health` em URL fixa e acesso ao bucket privado sem listar objetos. Não usa admin SELECT em tabelas. Resposta:

```ts
type PlatformHealth = {
  checkedAt: string
  database: 'healthy' | 'degraded'
  auth: 'healthy' | 'degraded'
  storage: 'healthy' | 'degraded'
  pendingCompensations: number
  pendingFileCleanup: number
  scanFailures: number
  storageBytes: number
  reservedStorageBytes: number
  companiesNearQuota: number
  quotaDriftAlerts: number
}
```

O fetch de health usa URL fixa de env; não aceita URL do request. A page não oferece botão de correção que este ciclo não implemente.

- [ ] **Step 8: Integrar mutation sync sem optimistic auth/finance**

Ao sucesso de empresa/admin/banco, chame a API de `mutation-sync` com os scopes canônicos exatos aplicáveis: `platform-dashboard`, `platform-companies`, `platform-admins`, `platform-audit`, `platform-health`. A raiz `platform-companies` cobre lista e detalhe; não existe alias dinâmico com ID. Em seguida `router.refresh()`. Não altere permissões, status ou default otimisticamente.

- [ ] **Step 9: Rodar E2E e build**

Run:

```bash
npm run test:e2e -- tests/e2e/platform-companies.spec.ts
npm run build
```

Expected: jornada PASS; build lista pages como dinâmicas e não acusa Client Component indevido ou segredo no bundle.

- [ ] **Step 10: Commitar portal de plataforma**

```bash
git add src/app/'(protected)'/platform src/app/api/platform/audit src/app/api/platform/health src/modules/platform src/modules/audit src/components/layout/platform-shell.tsx tests/e2e/platform-companies.spec.ts
git commit -m "feat: deliver separate platform administration portal"
```

### Task 10: Construir a UI empresarial de usuários e módulos

**Files:**
- Create: `src/app/(protected)/app/usuarios/page.tsx`
- Create: `src/app/(protected)/app/usuarios/loading.tsx`
- Create: `src/app/(protected)/app/usuarios/error.tsx`
- Create: `src/modules/users/ui/company-users-page.tsx`
- Create: `src/modules/users/ui/user-form.tsx`
- Create: `src/modules/users/ui/reset-password-dialog.tsx`
- Modify: `src/components/layout/company-shell.tsx`
- Create: `tests/e2e/company-users-settings.spec.ts`

- [ ] **Step 1: Escrever a primeira metade falha da jornada empresarial**

Em `company-users-settings.spec.ts`, Admin sem módulos operacionais abre `/app/usuarios`, cria member Finance, altera para Certidões, abre segunda aba e confirma menu/rota/API atualizados sem reload forçado. Tente suspender o último admin e espere alerta `A empresa precisa manter ao menos um administrador ativo.`. Member comum recebe 403 ao URL direto.

Run: `npm run test:e2e -- tests/e2e/company-users-settings.spec.ts --grep "usuários"`

Expected: FAIL porque page/UI ainda não existem.

- [ ] **Step 2: Criar page Server Component protegida por papel, não módulo**

`usuarios/page.tsx` chama `requireCompanyContext()`, verifica `role==='company_admin'` e retorna acesso negado padronizado caso contrário. Carrega directory somente por `bffDb.listCompanyUserDirectory(actor,session,filters)`, sem service role ou SELECT de profiles alheios. Passe currentMembershipId para a UI desabilitar self; servidor/RPC continuam autoridade.

- [ ] **Step 3: Criar tabela/cards e estados completos**

`company-users-page.tsx` recebe dados iniciais. Desktop/tablet largo usa Table; móvel usa cards com nome, e-mail, papel, status, chips de módulo e menu de ações. Busca/filtro sem resultado tem mensagem distinta de empresa sem usuários. Status não usa só cor.

- [ ] **Step 4: Criar formulário e reset acessíveis**

`user-form.tsx` tem seções Identidade/Acesso/Módulos, rodapé fixo no móvel e labels/erros associados. Explique que Admin sempre gerencia usuários/settings, mesmo sem módulo. `reset-password-dialog.tsx` exige senha provisória + confirmação + motivo; dialog desktop vira Sheet/tela cheia no móvel e exige reauth antes do submit.

- [ ] **Step 5: Atualizar menu empresarial reativamente**

`company-shell.tsx` mostra Usuários e Configurações para `company_admin` independentemente de modules; rotas Administrativo/Financeiro/Certidões dependem do array atual. O listener do mutation sync invalida access-context/navigation, refaz leitura autorizada e remove imediatamente links revogados. Não confie no evento Realtime como dado final.

- [ ] **Step 6: Rodar journey e commit**

Run:

```bash
npm run test:e2e -- tests/e2e/company-users-settings.spec.ts --grep "usuários"
npm run test:integration -- tests/integration/users/company-users-api.test.ts
```

Expected: PASS, inclusive duas abas e URL direta.

```bash
git add src/app/'(protected)'/app/usuarios src/modules/users/ui src/components/layout/company-shell.tsx tests/e2e/company-users-settings.spec.ts
git commit -m "feat: add responsive company user management"
```

### Task 11: Entregar perfil, avatar, e-mail e tema por usuário

**Files:**
- Create via CLI: migration com sufixo `_profile_settings_rpcs.sql`
- Create: `src/modules/settings/schemas/profile-schemas.ts`
- Create: `src/modules/settings/server/profile-service.ts`
- Create: `src/modules/settings/ui/profile-form.tsx`
- Modify: `src/components/theme/theme-toggle.tsx`
- Create: `src/app/api/profile/route.ts`
- Create: `src/app/api/profile/avatar/route.ts`
- Modify: `src/app/auth/callback/route.ts`
- Create: `src/app/(protected)/app/configuracoes/perfil/page.tsx`
- Modify: `src/lib/theme/theme-provider.tsx`
- Modify: `src/components/providers/scoped-providers.tsx`
- Create: `tests/integration/settings/profile-api.test.ts`

- [ ] **Step 1: Escrever testes falhos de profile/version/avatar/theme**

Em `profile-api.test.ts`, cubra: próprio profile apenas; payload de role/company/modules rejeitado; display name com version; conflito 409 preserva edição; e-mail exige `requireRecentAuthentication(context, 600)` e fica pending até confirmação real; avatar exige file `profile_avatar`, ready/clean, owner/tenant correto; tema default dark e light persiste em outro dispositivo; cookie é hint, banco é autoridade; respostas `no-store`.

Run: `npm run test:integration -- tests/integration/settings/profile-api.test.ts`

Expected: FAIL com routes ausentes.

- [ ] **Step 2: Criar migration/RPCs de profile**

```bash
npx supabase migration new profile_settings_rpcs
MIGRATION_PATH="$(find supabase/migrations -type f -name '*_profile_settings_rpcs.sql' | sort | tail -1)"
test -n "$MIGRATION_PATH"
```

Crie `profile_update_display_name(actor,session,display_name,expected_version,correlation_id)` e `profile_attach_avatar(actor,session,file_id,expected_version,correlation_id)`, SECURITY DEFINER, search path vazio, grant somente axsys_bff. Ambas validam actor/session, derivam o próprio profile, aplicam CAS, incrementam version e auditam no mesmo commit. Attach bloqueia file row, cancela claim concorrente quando legal e valida owner/company/purpose/ready/clean. Revogue definitivamente o antigo grant direto de `display_name`; apenas `preferred_theme` mantém o fluxo RLS/API congelado no plano 01.

- [ ] **Step 3: Implementar e-mail sem divergência Auth/Profile**

`profile-service.ts` chama `supabase.auth.updateUser({ email: normalized }, { emailRedirectTo: APP_ORIGIN + '/auth/callback?flow=email_change&next=/app/configuracoes/perfil' })` com cliente server do usuário após `requireRecentAuthentication(context, 600)`; não altera `profiles.email` antes da confirmação. No callback allowlisted do plano 01, somente o fluxo Auth verificado como `email_change` chama `private.sync_confirmed_profile_email(actor,session)` depois de `getClaims`. A função aceita nenhum e-mail/user arbitrário, executa `assert_auth_session(session,actor)`, lê o e-mail autoritativo diretamente de `auth.users where id=actor`, normaliza, atualiza profile/version e audita idempotentemente. Ela não usa `auth.uid()` porque a conexão Postgres.js axsys_bff não carrega JWT; um JWT antigo não reintroduz endereço anterior. Revogue de public/anon/authenticated/service_role e conceda somente axsys_bff. Mailpit/E2E prova `auth.uid() is null` nessa conexão, actor/session cruzados, forged input inexistente, JWT antigo, replay e cross-flow.

- [ ] **Step 4: Criar APIs de profile/avatar/theme**

PATCH `/api/profile` usa schema `{ displayName, email?, version }`; POST `/api/profile/avatar` usa `{ fileId, version }`. Ambas usam Origin/CSRF; e-mail usa `requireRecentAuthentication(context, 600)`; respostas são no-store. Reutilize o PATCH `/api/profile/theme` do plano 01 sem recriá-lo. Avatar primeiro passa pelo pipeline genérico da Task 4 e só depois attach. Arquivo anterior vira `archived` e recebe o prazo de 30 dias na mesma transação; remoção/quota seguem exclusivamente o claim delete-first da Task 4.

- [ ] **Step 5: Persistir tema sem localStorage autoritativo**

Reutilize `src/lib/theme/theme-provider.tsx`, `src/components/theme/theme-toggle.tsx` e o PATCH `/api/profile/theme` entregues pelo plano 01: o toggle espera o 200 persistido antes de trocar a classe e publica o scope canônico user-targeted `settings`. `scoped-providers.tsx` recebe o AccessContext completo e passa `context.profile.preferredTheme`/userId ao único provider de tema protegido; o provider observa também `profile.version` e chama `setTheme(databaseTheme)` quando a leitura autoritativa muda, sobrescrevendo o hint antigo no storageKey do usuário. `app-providers.tsx` raiz não monta theme/toast. Em divergência, DB vence qualquer hint de apresentação, inclusive alteração feita por outro dispositivo; o primeiro acesso sem preferência é dark. Renderize o mesmo toggle no `company-shell.tsx` e no `platform-shell.tsx`, portanto a preferência também persiste para Super Admin; avatar continua restrito a perfis empresariais porque todo `file_objects.company_id` é obrigatório. Testes começam com localStorage divergente, atualizam por segunda aba/dispositivo e provam reconciliação sem flash persistente.

- [ ] **Step 6: Criar profile page responsiva**

Page Server Component fornece DTO e uma rota autenticada de avatar que reautoriza e transmite os bytes server-side com hash/tamanho/nosniff/no-store; nunca fornece URL Storage assinada. Form usa `ImageUploadField`, estados de quarentena/scan/retry, seções e action footer fixo no móvel. Use `UserCircle`, `Camera`, `Sun`, `Moon` Phosphor; não anime o toggle perpetuamente.

- [ ] **Step 7: Testar e commit**

Run:

```bash
npm run db:reset
npm run test:integration -- tests/integration/settings/profile-api.test.ts
npm run test:e2e -- tests/e2e/company-users-settings.spec.ts --grep "perfil|tema"
```

Expected: PASS; novo browser usa preferência do banco; outro usuário permanece dark.

```bash
git add supabase/migrations src/lib/db/bff.ts src/lib/supabase/database.types.ts src/modules/settings/schemas/profile-schemas.ts src/modules/settings/server/profile-service.ts src/modules/settings/ui/profile-form.tsx src/components/theme/theme-toggle.tsx src/components/providers/scoped-providers.tsx src/app/api/profile/route.ts src/app/api/profile/avatar src/app/auth/callback/route.ts src/app/'(protected)'/app/configuracoes/perfil src/components/layout/platform-shell.tsx src/components/layout/company-shell.tsx tests/integration/settings/profile-api.test.ts
git commit -m "feat: add secure profile avatar and user theme"
```

### Task 12: Entregar configurações institucionais, branding e rascunho

**Files:**
- Create via CLI: migration com sufixo `_company_settings_rpcs.sql`
- Create: `src/modules/settings/schemas/company-settings-schemas.ts`
- Create: `src/modules/settings/server/company-settings-service.ts`
- Create: `src/modules/settings/server/company-settings-draft-service.ts`
- Create: `src/modules/settings/ui/company-settings-form.tsx`
- Create: `src/modules/settings/ui/company-bank-accounts-readonly.tsx`
- Create: `src/app/api/company/settings/route.ts`
- Create: `src/app/api/company/settings/draft/route.ts`
- Create: `src/app/(protected)/app/configuracoes/empresa/page.tsx`
- Create: `tests/unit/settings/company-settings-schema.test.ts`
- Create: `tests/integration/settings/company-settings-api.test.ts`

- [ ] **Step 1: Escrever unitários falhos de normalização**

Teste `companySettingsSchema`: UF uppercase, CEP só 8 dígitos, alíquota 0–100 com duas casas, CPF validado, strings vazias viram null, file IDs UUID. Teste endereço parcial esperado: rua+número, cidade/UF e CEP sem `, ,`, `· ·`, `/ ·` ou separadores finais. O valor final vem da coluna gerada do banco, não do browser.

Run: `npm run test:unit -- tests/unit/settings/company-settings-schema.test.ts`

Expected: FAIL com schema ausente.

- [ ] **Step 2: Escrever integração falha do rascunho/conflito/assets**

Cubra: apenas company_admin; draft por `(company,user)` sobrevive navegação e não aparece para Admin A2; autosave com version; save settings apaga somente draft do ator; conflito 409 devolve `current` e preserva payload local; asset de outro tenant/purpose/quarentena rejeitado; timbrado/assinatura ready aceitos; CPF cifrado; banco aparece read-only com orientação ao Super Admin; empresa arquivada bloqueia; audit sem CPF/arquivo.

Run: `npm run test:integration -- tests/integration/settings/company-settings-api.test.ts`

Expected: FAIL com service/RPC ausente.

- [ ] **Step 3: Implementar schema e criptografia de CPF**

Exporte `companySettingsSchema`, `companySettingsDraftSchema` e `companySettingsDtoSchema`. Draft aceita exatamente os campos editáveis e `baseVersion`; rejeita companyId/userId/version protegidos. `company-settings-service.ts` cifra CPF com `PII_ENCRYPTION_KEY_V1_BASE64`, AAD `company:${companyId}:representative-document`, guarda last4 e nunca devolve plaintext após save.

- [ ] **Step 4: Gerar migration das RPCs de settings**

```bash
npx supabase migration new company_settings_rpcs
MIGRATION_PATH="$(find supabase/migrations -type f -name '*_company_settings_rpcs.sql' | sort | tail -1)"
test -n "$MIGRATION_PATH"
```

Expected: migration criada pelo CLI.

- [ ] **Step 5: Criar RPC de rascunho com CAS**

`company_upsert_settings_draft(payload,base_version,expected_draft_version,correlation_id)` deriva user/company, exige company_admin e empresa ativa. Insert começa version 1; update usa expected version e incrementa. Conflito lança `AXSYS_DRAFT_VERSION_CONFLICT`. `company_delete_settings_draft()` apaga somente `(context.company_id,auth.uid())`. Grants apenas authenticated.

- [ ] **Step 6: Criar save transacional com versão e limpeza seletiva**

`company_save_settings` recebe campos normalizados/cifrados, file IDs, expected version e correlation. Deriva company do ator, exige admin, atualiza por `where company_id=v_actor_company_id and version=p_expected_version`, deixa trigger validar branding, lê `consolidated_address` gerado, apaga draft do ator e audita `company.settings_updated` na mesma transação. Se conflito, não apaga draft e retorna erro mapeável a 409.

- [ ] **Step 7: Criar APIs e autosave resiliente**

GET/PATCH `/api/company/settings`: company context + admin, PATCH Origin/CSRF, no-store. GET/PUT/DELETE `/api/company/settings/draft`: mesmo gate; PUT rate limit 30/min e payload limitado. `company-settings-form.tsx` debounce 750 ms após mudança, flush em `visibilitychange`/navegação, status `Salvando rascunho/Salvo/Falha`, e nunca confunde draft com cache de leitura.

- [ ] **Step 8: Integrar timbrado, assinatura e bancos read-only**

Use dois `ImageUploadField` com purposes exatos. Após finalize, mantenha fileId no draft; save oficial o anexa. Renderize preview por download autorizado, nunca URL persistente. `company-bank-accounts-readonly.tsx` lista summaries, default com texto/ícone e mensagem `Solicite alterações ao Super Admin`; não renderize editar/criar/remover.

- [ ] **Step 9: Criar page e conflito comparável**

Page Server Component requer company admin sem módulo. Em 409, client mostra painel com `Sua edição` e `Versão atual`, preserva local, oferece `Revisar e tentar novamente`; nunca faz overwrite automático. Form longo usa seções Dados fiscais/Endereço/Representante/Identidade documental/Bancos e footer fixo no móvel.

- [ ] **Step 10: Testar e commit**

Run:

```bash
npm run db:reset
npm run test:unit -- tests/unit/settings/company-settings-schema.test.ts
npm run test:integration -- tests/integration/settings/company-settings-api.test.ts
npm run test:e2e -- tests/e2e/company-users-settings.spec.ts --grep "configurações|rascunho|timbrado"
```

Expected: PASS; duas contas editando detectam conflito; draft do outro admin fica invisível.

```bash
git add supabase/migrations src/lib/db/bff.ts src/lib/supabase/database.types.ts src/modules/settings src/app/api/company/settings src/app/'(protected)'/app/configuracoes/empresa tests/unit/settings tests/integration/settings/company-settings-api.test.ts
git commit -m "feat: add institutional settings branding and drafts"
```

### Task 13: Fechar IDOR, cache, concorrência, responsividade e aceite

**Files:**
- Modify: `src/lib/query/query-keys.ts`
- Modify: `src/lib/query/mutation-sync.tsx`
- Create: `tests/integration/security/idor-cache-concurrency.test.ts`
- Create: `tests/e2e/responsive-accessibility.spec.ts`
- Modify: testes desta entrega quando uma lacuna for encontrada

- [ ] **Step 1: Escrever a matriz final falha de IDOR/cache**

`idor-cache-concurrency.test.ts` percorre cada route deste plano com: ID válido de tenant B, UUID aleatório, companyId adulterado no body/query/header, role/module adulterado e session swap. Exija 404/403 neutro, nenhum nome/e-mail/CNPJ inferível, nenhum SQL/stack, correlation ID presente. Asserte em toda resposta autenticada:

```ts
expect(response.headers.get('cache-control')).toContain('private')
expect(response.headers.get('cache-control')).toContain('no-store')
expect(response.headers.get('vary')).toContain('Cookie')
expect(response.headers.get('vary')).toContain('Authorization')
```

Troque user A→B no mesmo QueryClient e prove que nenhuma key/data A permanece. Dispare mutação em aba 1, evento BroadcastChannel/Realtime em aba 2 e prove refetch autorizado, não uso do payload como verdade.

- [ ] **Step 2: Congelar query keys por identidade e filtros**

Em `query-keys.ts`, acrescente factories:

```ts
platformKeys.companies(userId, filters)
platformKeys.company(userId, companyId)
platformKeys.admins(userId, filters)
platformKeys.audit(userId, filters)
platformKeys.health(userId)
companyKeys.users(userId, companyId, filters)
companyKeys.profile(userId, companyId)
companyKeys.settings(userId, companyId)
companyKeys.settingsDraft(userId, companyId)
companyKeys.bankAccounts(userId, companyId)
```

Todas começam `['axsys',userId,scope]`; normalize filtros antes da key. Logout/session change executa `queryClient.clear()` e encerra channels. Nunca persista QueryClient.

- [ ] **Step 3: Fechar sync/invalidation exata**

`mutation-sync.tsx` mapeia resources para keys relacionadas e chama invalidate/refetch. Evento contém somente `{ scope, resources }`, nunca row/payload. Focus, reconnect e resume refazem queries visíveis. Permissão, status de empresa, banco default e settings não usam optimistic update.

- [ ] **Step 4: Rodar duas atualizações concorrentes por recurso**

Teste empresa, membership, banco, profile, settings e draft com mesma versão em duas conexões: exatamente um commit e um 409; resposta 409 inclui snapshot seguro atual; audit tem um success. Para dois defaults e duas suspensões de admins, valide invariantes depois das transações.

- [ ] **Step 5: Escrever visual/accessibility falho nos três breakpoints**

`responsive-accessibility.spec.ts` usa viewports `390x844`, `768x1024`, `1440x900`. Em portal platform, users, profile e settings, prove: sem overflow horizontal; drawer/sidebar corretos; tabela vira cards quando necessário; dialogs viram sheet/fullscreen; footer fixo não cobre campos; touch targets >=44; Tab percorre controles; foco preso/retornado; Escape; labels/errors; `aria-live`; tema dark/light; contraste AA via axe.

Run: `npm run test:e2e -- tests/e2e/responsive-accessibility.spec.ts`

Expected: FAIL até os ajustes de layout/a11y.

- [ ] **Step 6: Corrigir somente violações demonstradas e repetir**

Mantenha Server Components como default e mova `'use client'` para a menor folha. Use tokens shadcn/Geist, Phosphor 2.1.10 e transições de 120–180 ms somente em interações. Não adicione animação perpétua, neon ou densidade baixa incompatível com tabelas administrativas.

- [ ] **Step 7: Executar a verificação completa em ambiente limpo**

Run:

```bash
npm run files:start
npm run db:reset
npm run lint
npm run typecheck
npm run test:unit
npm run db:test
npm run test:integration
npm run test:e2e
npm run build
npx supabase db advisors --local
```

Expected: todos os comandos status 0; pgTAP `Result: PASS`; Playwright sem retry ocultando falha; build sem segredo/rota estática autenticada; advisors sem achados novos de security/performance deste plano.

- [ ] **Step 8: Executar scans negativos finais**

Run:

```bash
rg -n "dangerouslySetInnerHTML|document\.write|localStorage|service_role|SUPABASE_SERVICE_ROLE" src
rg -n "from ['\"]lucide|lucide-react|animate-infinite|neon" src
rg -n "select\(\s*['\"]\*|\.select\(\s*['\"]\*" src/modules src/app/api
```

Expected: primeiro comando encontra `service_role` somente no factory server-only do plano 01 e nenhum storage de sessão/dados; segundo retorna zero; terceiro retorna zero nos módulos desta entrega. Revise qualquer match antes de aceitar.

- [ ] **Step 9: Commit final de hardening**

```bash
git add src/lib/query/query-keys.ts src/lib/query/mutation-sync.tsx src/components/layout/platform-shell.tsx src/components/layout/company-shell.tsx src/modules/platform/ui src/modules/users/ui src/modules/settings/ui tests/integration/security tests/e2e/responsive-accessibility.spec.ts
git commit -m "test: harden platform users settings flows"
```

## Matriz de aceite rastreável

| Requisito | Implementação | Prova principal |
|---|---|---|
| Portal `/platform` separado | Tasks 6 e 9 | `platform-companies.spec.ts` |
| CRUD/archive/reactivate empresas | Task 6 | `company-api.test.ts` |
| Empresa + primeiro admin compensáveis | Task 5 | `company-provisioner.test.ts` |
| Administradores/usuários/módulos | Tasks 7 e 10 | `company-users-api.test.ts`, E2E |
| Senha provisória/reset | Tasks 5 e 7 | `temporary-password.test.ts` |
| Último admin | Tasks 3 e 7 | pgTAP concorrente + integration |
| Bancos cifrados/default | Task 8 | crypto unit + API concorrente |
| Auditoria de plataforma | Tasks 5–9 | audit UI/API + E2E |
| Upload seguro compartilhado | Tasks 2–4 | upload pipeline + RLS |
| Perfil/avatar/e-mail/tema | Task 11 | `profile-api.test.ts` + E2E |
| Settings/endereço/branding/draft | Tasks 2, 3 e 12 | settings unit/integration/E2E |
| RLS/IDOR/cache/concorrência | Tasks 3 e 13 | pgTAP + security integration |
| Responsividade/acessibilidade | Tasks 9–13 | `responsive-accessibility.spec.ts` |

## Handoff de execução

Plano completo salvo em `docs/superpowers/plans/2026-07-10-axsys-02-platform-users-settings.md`.

Opções de execução:

1. **Subagent-Driven (recomendado):** usar `superpowers:subagent-driven-development`, um agente novo por task e revisão de spec/qualidade entre tasks.
2. **Inline Execution:** usar `superpowers:executing-plans`, executar em batches com checkpoints de revisão.
