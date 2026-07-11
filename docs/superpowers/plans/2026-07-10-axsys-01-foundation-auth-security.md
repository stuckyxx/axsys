# Axsys 01 — Foundation, Auth & Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a fundação local executável do Axsys com identidade visual, Supabase multi-tenant default-deny, autenticação SSR/BFF segura, shells separados e invalidação imediata verificável.

**Architecture:** Um monólito modular Next.js App Router mantém sessões em cookies de servidor e concentra mutações no BFF; consultas normais continuam usando a identidade do usuário e RLS, enquanto a chave secreta fica limitada à API Auth administrativa (e, nos planos de arquivo, a operações Storage de path exato). Auditoria, sessões e rate limit usam o papel BFF allowlisted. PostgreSQL é a fonte de verdade; TanStack Query, BroadcastChannel e Realtime apenas coordenam novas leituras autorizadas, sem cache persistente nem payload Realtime tratado como dado definitivo.

**Tech Stack:** Node.js 24.13.0, npm 11.6.2, Next.js 16.2.10, React 19.2.7, TypeScript, Tailwind CSS 4, shadcn 4.13.0/Radix, Geist/Geist Mono, Phosphor Icons 2.1.10, Supabase CLI 2.109.1 + `@supabase/ssr` 0.12.0 + `@supabase/supabase-js` 2.110.2, PostgreSQL/RLS, Postgres.js 3.4.9, TanStack Query 5.101.2, Zod 4.4.3, Vitest 4.1.10, Playwright 1.61.1 e pgTAP.

---

## Regras de execução

- Execute em worktree dedicada e preserve qualquer alteração preexistente. Nunca use `git add .`; os commits abaixo nomeiam somente os arquivos da tarefa.
- Aplique RED → confirme a falha correta → GREEN mínimo → confirme a suíte verde → refatore → confirme novamente. Código de produção sem teste que falhou antes deve ser removido e refeito.
- Use somente npm e mantenha `package-lock.json`. Todas as instalações usam versão exata.
- Crie cada migration exclusivamente com `npx supabase migration new <nome>`. Edite o caminho que o CLI imprimir. Nunca crie, copie ou suponha um timestamp.
- Antes de usar um comando Supabase diferente dos scripts congelados, rode `npx supabase <grupo> <comando> --help` na versão instalada.
- O browser não chama `.from()`, `.rpc()` ou Storage. `src/lib/supabase/browser.ts` existe somente para Realtime com token efêmero obtido do BFF e com persistência de sessão desativada.
- `getClaims()` valida identidade. `getSession()` só pode aparecer na rota que, depois de `getClaims()`, extrai o access token necessário ao Realtime.
- Nenhuma autorização usa `user_metadata`, parâmetro de rota, `company_id`, papel ou módulo enviados pelo cliente.
- A service role não recebe CRUD em tabelas públicas/privadas. Nesta fundação ela é usada somente pela API Auth administrativa; planos de arquivo permitem depois operações Storage de path exato. Sessão, rate limit, auditoria e eventos de segurança passam exclusivamente pelas funções allowlisted do papel axsys_bff.
- Toda função futura de `bffDb` que muta dado de negócio recebe actor+session verificados, chama `private.assert_auth_session`, revalida papel/módulo/tenant em tabelas e somente então executa `set_config('app.actor_id', actor_id::text, true)` na própria transação. Nunca aceita actor/company/role como autoridade isolada. Isso permite auditoria/invalidação transacional sem confiar no browser.
- Toda resposta autenticada ou de Auth usa `Cache-Control: private, no-store, max-age=0, must-revalidate`, `Pragma: no-cache`, `Expires: 0` e `Vary: Cookie, Authorization`.
- Não crie Service Worker, persistência do TanStack Query, cópia de dado empresarial em localStorage/IndexedDB, atualização otimista de permissão ou tela com número simulado.
- O tema pode usar localStorage somente como preferência visual auxiliar, com chave contendo o `userId`; `profiles.preferred_theme` permanece autoritativo.
- O design usa variação 5/10, movimento 3/10 e densidade 6/10: sem gradiente ornamental, neon, glow ou animação perpétua; toda transição respeita `prefers-reduced-motion`.

## Mapa de arquivos e responsabilidades

| Unidade | Arquivos | Responsabilidade |
|---|---|---|
| Toolchain | `package.json`, `package-lock.json`, `.nvmrc`, `.npmrc`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs` | Versões, scripts e gates reproduzíveis. |
| Design | `src/app/globals.css`, `src/app/layout.tsx`, `components.json`, `src/components/ui/*`, `src/components/brand/axsys-logo.tsx`, `src/lib/theme/theme-provider.tsx` | Tokens Axsys, Geist, shadcn customizado, dark-first e preferência por usuário. |
| HTTP/segurança | `src/lib/http/*`, `src/lib/security/*` | Envelope de erro, correlation ID, no-store, CSP, Origin, CSRF, hashing/redaction e rate limit. |
| Supabase | `src/lib/supabase/{server,browser,admin,proxy,database.types}.ts`, `src/proxy.ts` | Clientes separados, cookies SSR e renovação de sessão. |
| SQL restrito | `supabase/roles.sql`, `src/lib/db/bff.ts` | Papel `axsys_bff` sem BYPASSRLS/CRUD e facade lazy que não exporta cliente/SQL bruto, somente métodos privados allowlisted. |
| Auth | `src/modules/auth/domain/*`, `src/modules/auth/schemas/*`, `src/modules/auth/server/*`, `src/modules/auth/ui/*` | Política de senha, contexto efetivo, guards, login/logout, senha provisória e recovery. |
| BFF Auth | `src/app/api/auth/**/route.ts`, `src/app/auth/callback/route.ts`, `src/app/api/profile/theme/route.ts` | Fronteira HTTP validada por Zod, CSRF/Origin, rate limit e respostas sem cache. |
| Portais | `src/app/(public)/*`, `src/app/(protected)/platform/*`, `src/app/(protected)/app/*`, `src/components/layout/*` | Login/recovery e separação `/platform` versus `/app`. |
| Consistência | `src/lib/query/*`, `src/lib/realtime/invalidation-channel.ts` | Chaves com identidade/tenant, invalidação local, entre abas e por sinal RLS-safe. |
| Banco | `supabase/config.toml`, migrations criadas pelo CLI, `supabase/seed.sql` | Tipos, tabelas base, constraints, grants, helpers e RLS default-deny. |
| Auditoria | `src/modules/audit/server/write-audit-event.ts` | Escrita allowlisted fora de transações de domínio; RPCs futuras auditam na própria transação. |
| Testes | `vitest.config.ts`, `vitest.setup.ts`, `playwright.config.ts`, `tests/{unit,integration,e2e,helpers}`, `supabase/tests/database` | Domínio, handlers reais, SQL/RLS, navegador, IDOR e cache. |

## Contratos compartilhados congelados

```ts
export type CompanyRole = "company_admin" | "member"
export type ModuleKey = "administrative" | "financial" | "certificates"
export type ThemePreference = "dark" | "light"

export type AccessContext =
  | {
      kind: "platform"
      userId: string
      sessionId: string
      authenticatedAt: number
      profile: { displayName: string; email: string; preferredTheme: ThemePreference; version: number }
    }
  | {
      kind: "company"
      userId: string
      sessionId: string
      authenticatedAt: number
      companyId: string
      membershipId: string
      role: CompanyRole
      modules: readonly ModuleKey[]
      profile: { displayName: string; email: string; preferredTheme: ThemePreference; version: number }
    }
```

```ts
import type { Json } from "@/lib/supabase/database.types"

export type ApiErrorBody = {
  error: {
    code: string
    message: string
    correlationId: string
    fieldErrors?: Record<string, string[]>
  }
}

export type AuthenticatedAuditEventInput = {
  actorUserId: string
  sessionId: string
  action: string
  resourceType: string
  resourceId?: string | null
  outcome: "success" | "denied" | "failure"
  reasonCode?: string | null
  correlationId: string
  ipHash?: string | null
  userAgentHash?: string | null
  metadata?: Record<string, Json>
}
```

Scope/company belong to a separate server-internal persistence row derived by the database; callers never construct or submit them.

As query keys sempre começam por `['axsys', userId, companyId ?? 'platform', ...]`. Os guards exportados são `requireAccessContext()`, `requirePlatformContext()`, `requireCompanyContext(requiredModule?)` e `requireRecentAuthentication(context, maxAgeSeconds?)`.

### Task 1: Scaffold reproduzível do Next.js e dependências fixas

**Files:**
- Create: `.nvmrc`
- Create: `.npmrc`
- Create/Modify generated: `package.json`
- Create generated: `package-lock.json`
- Create generated: `tsconfig.json`
- Create generated: `next.config.ts`
- Create generated: `eslint.config.mjs`
- Create generated: `.gitignore`
- Create generated: `next-env.d.ts`
- Create generated: `postcss.config.mjs`
- Create generated: `src/app/layout.tsx`
- Create generated: `src/app/page.tsx`
- Create generated: `src/app/globals.css`
- Delete generated: `public/next.svg`
- Delete generated: `public/vercel.svg`

- [ ] **Step 1: Verificar o diretório e as ferramentas sem alterar arquivos**

Run:

```bash
pwd
git status --short
node --version
npm --version
docker version --format '{{.Server.Version}}'
```

Expected: o diretório termina em `/bas`; Node imprime `v24.13.0`; npm imprime `11.6.2`; Docker responde com a versão do servidor. Registre arquivos preexistentes e não os inclua nos commits.

- [ ] **Step 2: Gerar o App Router de forma não interativa**

Run:

```bash
SCAFFOLD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/axsys-scaffold.XXXXXX")"
npx create-next-app@16.2.10 "$SCAFFOLD_ROOT/axsys" --yes --typescript --tailwind --eslint --app --src-dir --import-alias '@/*' --use-npm --skip-install --disable-git
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'README.md' --exclude 'AGENTS.md' --exclude 'CLAUDE.md' "$SCAFFOLD_ROOT/axsys/" ./
rm -rf "$SCAFFOLD_ROOT"
```

Expected: `Success! Created` aparece; `src/app`, `.gitignore` e `next-env.d.ts` existem; `docs/`, `outputs/` e outros arquivos preexistentes permanecem intactos. As exclusões impedem que documentos genéricos sobrescrevam os artefatos Axsys.

- [ ] **Step 3: Fixar runtime, gerenciador e dependências de produção**

Create `.nvmrc`:

```text
24.13.0
```

Create `.npmrc`:

```ini
save-exact=true
engine-strict=true
fund=false
audit=true
```

Run:

```bash
npm pkg set packageManager='npm@11.6.2' engines.node='24.13.0'
npm install --save-exact next@16.2.10 react@19.2.7 react-dom@19.2.7 @supabase/ssr@0.12.0 @supabase/supabase-js@2.110.2 @tanstack/react-query@5.101.2 zod@4.4.3 react-hook-form@7.81.0 @hookform/resolvers@5.4.0 next-themes@0.4.6 sonner@2.0.7 @phosphor-icons/react@2.1.10 postgres@3.4.9 server-only@0.0.1
npm install --save-dev --save-exact typescript@5.9.3 tailwindcss@4.3.2 @tailwindcss/postcss@4.3.2 eslint@9.39.4 eslint-config-next@16.2.10 @types/node@24.13.3 @types/react@19.2.17 @types/react-dom@19.2.3 supabase@2.109.1 vitest@4.1.10 @playwright/test@1.61.1 @testing-library/react@16.3.2 @testing-library/jest-dom@6.9.1 @testing-library/user-event@14.6.1 jsdom@29.1.1 vite-tsconfig-paths@6.1.1 tsx@4.23.0
```

Expected: `package-lock.json` atualizado, sem ranges `^` ou `~` nas dependências nomeadas.

- [ ] **Step 4: Congelar scripts operacionais**

Set the complete `scripts` object in `package.json` to:

```json
{
  "dev": "next dev --turbopack",
  "build": "next build",
  "start": "next start",
  "lint": "eslint . --max-warnings=0",
  "typecheck": "tsc --noEmit",
  "test": "npm run test:unit",
  "test:watch": "vitest",
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration --maxWorkers=1",
  "test:rls": "supabase test db supabase/tests/database",
  "test:e2e": "playwright test",
  "test:all": "npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run test:rls && npm run test:e2e && npm run build",
  "db:start": "supabase start",
  "db:stop": "supabase stop",
  "db:status": "supabase status",
  "db:env": "tsx scripts/provision-local-env.ts",
  "db:reset": "supabase db reset --local",
  "db:test": "supabase test db",
  "db:lint": "supabase db lint --local --level warning --fail-on warning",
  "db:advisors": "supabase db advisors --local --fail-on warn",
  "db:types": "supabase gen types typescript --local --schema public > src/lib/supabase/database.types.ts",
  "bootstrap:local": "tsx scripts/bootstrap-local.ts"
}
```

- [ ] **Step 5: Remover a demonstração gerada e provar que o scaffold compila**

Delete every generated demo SVG under `public/` (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, and `window.svg`) using the file-editing mechanism; do not use a broad deletion outside that exact generated set. Replace `src/app/page.tsx` with:

```tsx
import { redirect } from "next/navigation"

export default function HomePage() {
  redirect("/login")
}
```

Run:

```bash
npx supabase --version
npm run lint
npm run typecheck
npm run build
```

Expected: Supabase imprime `2.109.1`; lint, typecheck e build terminam com exit code 0.

- [ ] **Step 6: Commit do scaffold**

```bash
git add .nvmrc .npmrc .gitignore next-env.d.ts package.json package-lock.json tsconfig.json next.config.ts eslint.config.mjs postcss.config.mjs src/app
git commit -m "chore: scaffold pinned Axsys application"
```

### Task 2: Design system Axsys, Geist e shadcn customizado

**Files:**
- Create/Modify generated: `components.json`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `src/app/(public)/layout.tsx`
- Create generated then customize: `src/components/ui/{alert,avatar,button,card,checkbox,dropdown-menu,input,label,separator,sheet,skeleton,sonner,tooltip}.tsx`
- Create with imagegen from `/Users/gabrielmachado/Downloads/axsys.png`: `public/brand/axsys-mark.png`
- Create with imagegen from `/Users/gabrielmachado/Downloads/axsys.png`: `public/brand/axsys-wordmark.png`
- Create with imagegen from `/Users/gabrielmachado/Downloads/axsys.png`: `public/brand/axsys-monochrome.png`
- Create with imagegen from `/Users/gabrielmachado/Downloads/axsys.png`: `public/brand/axsys-mark-monochrome.png`
- Create: `src/components/brand/axsys-logo.tsx`
- Create: `src/components/providers/app-providers.tsx`
- Create: `src/lib/theme/theme-provider.tsx`
- Test: `tests/unit/components/axsys-logo.test.tsx`
- Test: `tests/unit/theme/theme-provider.test.tsx`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`

- [ ] **Step 1: Inicializar shadcn 4.13.0 e adicionar somente os primitives da fundação**

Run:

```bash
npx shadcn@4.13.0 init -d --base radix
npx shadcn@4.13.0 add alert avatar button card checkbox dropdown-menu input label separator sheet skeleton sonner tooltip
```

Expected: `components.json` usa `new-york`, RSC e CSS variables; os componentes aparecem em `src/components/ui`.

Before the first component test, create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
  },
})
```

Create `vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest"
import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

afterEach(() => cleanup())
```

Task 3 extends this configuration for Node integration tests and the `server-only` alias.

- [ ] **Step 2: Escrever os testes RED da marca e do tema dark-first**

Create `tests/unit/components/axsys-logo.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AxsysLogo } from "@/components/brand/axsys-logo"

describe("AxsysLogo", () => {
  it("expõe nome acessível e variantes compacta e horizontal", () => {
    const { rerender } = render(<AxsysLogo variant="horizontal" />)
    expect(screen.getByLabelText("Axsys")).toHaveAttribute("data-variant", "horizontal")

    rerender(<AxsysLogo variant="compact" monochrome />)
    expect(screen.getByLabelText("Axsys")).toHaveAttribute("data-monochrome", "true")
    expect(screen.queryByText("Axsys")).not.toBeInTheDocument()
  })
})
```

Create `tests/unit/theme/theme-provider.test.tsx`:

```tsx
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AxsysThemeProvider } from "@/lib/theme/theme-provider"

describe("AxsysThemeProvider", () => {
  it("usa dark como padrão e isola a chave visual por usuário", () => {
    render(
      <AxsysThemeProvider userId="user-a" initialTheme="dark">
        <span>conteúdo</span>
      </AxsysThemeProvider>,
    )
    expect(document.documentElement).toHaveClass("dark")
    expect(localStorage.getItem("axsys-theme:user-b")).toBeNull()
  })
})
```

- [ ] **Step 3: Rodar os testes e confirmar a falha por módulos ausentes**

Run: `npm run test:unit -- tests/unit/components/axsys-logo.test.tsx tests/unit/theme/theme-provider.test.tsx`

Expected: FAIL porque `AxsysLogo` e `AxsysThemeProvider` ainda não existem.

- [ ] **Step 4: Derivar assets fiéis da marca fornecida e implementar variantes acessíveis**

Use the `imagegen` skill during implementation. First inspect `/Users/gabrielmachado/Downloads/axsys.png`; then pass that exact file as the reference image and request: "Preserve the Axsys symbol and wordmark geometry, proportions, colors and spacing exactly. Produce (1) a transparent compact symbol crop, (2) a transparent horizontal symbol+wordmark crop, (3) a transparent single-color white monochrome horizontal variant and (4) a transparent single-color white monochrome compact mark. Do not redesign, stylize, add a container, shadow, glow, gradient or new lettering." Save the outputs respectively as `public/brand/axsys-mark.png`, `public/brand/axsys-wordmark.png`, `public/brand/axsys-monochrome.png` and `public/brand/axsys-mark-monochrome.png`. Visually compare each result at original detail against the reference before continuing; rerun imagegen if geometry, colors or clear space drift.

Create `src/components/brand/axsys-logo.tsx`:

```tsx
import Image from "next/image"
import { cn } from "@/lib/utils"

type AxsysLogoProps = {
  variant?: "compact" | "horizontal"
  monochrome?: boolean
  className?: string
}

export function AxsysLogo({
  variant = "horizontal",
  monochrome = false,
  className,
}: AxsysLogoProps) {
  return (
    <span
      aria-label="Axsys"
      className={cn("inline-flex items-center gap-2.5", className)}
      data-monochrome={String(monochrome)}
      data-variant={variant}
    >
      <Image
        alt=""
        className={cn(variant === "compact" ? "h-8 w-auto" : "h-8 w-auto")}
        height={32}
        priority
        src={
          monochrome
            ? variant === "compact"
              ? "/brand/axsys-mark-monochrome.png"
              : "/brand/axsys-monochrome.png"
            : variant === "compact"
              ? "/brand/axsys-mark.png"
              : "/brand/axsys-wordmark.png"
        }
        width={variant === "compact" ? 32 : 132}
      />
    </span>
  )
}
```

- [ ] **Step 5: Implementar provider dark-first sem tema do sistema**

Create `src/lib/theme/theme-provider.tsx`:

```tsx
"use client"

import type { ReactNode } from "react"
import { ThemeProvider } from "next-themes"

type AxsysThemeProviderProps = {
  children: ReactNode
  userId: string
  initialTheme?: "dark" | "light"
}

export function AxsysThemeProvider({
  children,
  userId,
  initialTheme = "dark",
}: AxsysThemeProviderProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={initialTheme}
      enableSystem={false}
      storageKey={`axsys-theme:${userId}`}
    >
      {children}
    </ThemeProvider>
  )
}
```

Create `src/components/providers/app-providers.tsx`:

```tsx
"use client"

import type { ReactNode } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
export function AppProviders({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}
```

The root provider owns only tooltip behavior. Create `src/app/(public)/layout.tsx` as a full-viewport `className="dark"` wrapper with no next-themes provider or Web Storage key and mount its dark Toaster inside that wrapper. Each protected platform/company layout mounts exactly one `AxsysThemeProvider` inside `ScopedProviders`, keyed by the verified user ID and initialized from the database, with its Toaster inside that provider. Tests assert there are never nested theme providers, toast colors follow dark/light, and `axsys-theme:public` is absent before/after login and in a new light-theme tab.

- [ ] **Step 6: Aplicar Geist corretamente no Tailwind 4 e tokens Axsys**

Replace `src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { connection } from "next/server"
import type { ReactNode } from "react"
import { AppProviders } from "@/components/providers/app-providers"
import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: { default: "Axsys", template: "%s | Axsys" },
  description: "Gestão segura para fornecedores e prestadores do setor público.",
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection()
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
```

In `src/app/globals.css`, retain the shadcn structural imports and replace the generated color/font declarations with these complete token blocks:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --font-sans: "Geist", "Geist Fallback", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", "Geist Mono Fallback", ui-monospace, monospace;
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-highlight-violet: var(--highlight-violet);
  --color-highlight-orange: var(--highlight-orange);
  --radius-sm: calc(var(--radius) * 0.75);
  --radius-md: calc(var(--radius) * 0.875);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.5);
}

:root {
  --radius: 0.625rem;
  --background: oklch(0.975 0.008 248);
  --foreground: oklch(0.205 0.028 252);
  --card: oklch(0.995 0.004 248);
  --card-foreground: var(--foreground);
  --popover: var(--card);
  --popover-foreground: var(--foreground);
  --primary: oklch(0.56 0.18 244);
  --primary-foreground: oklch(0.985 0.005 248);
  --secondary: oklch(0.925 0.024 246);
  --secondary-foreground: oklch(0.27 0.04 250);
  --muted: oklch(0.94 0.014 248);
  --muted-foreground: oklch(0.49 0.032 250);
  --accent: oklch(0.89 0.052 211);
  --accent-foreground: oklch(0.27 0.05 232);
  --destructive: oklch(0.58 0.2 25);
  --border: oklch(0.87 0.022 248);
  --input: oklch(0.87 0.022 248);
  --ring: oklch(0.61 0.16 235);
  --highlight-violet: oklch(0.58 0.16 292);
  --highlight-orange: oklch(0.72 0.16 60);
}

.dark {
  --background: oklch(0.16 0.021 252);
  --foreground: oklch(0.95 0.01 245);
  --card: oklch(0.205 0.025 252);
  --card-foreground: var(--foreground);
  --popover: oklch(0.19 0.025 252);
  --popover-foreground: var(--foreground);
  --primary: oklch(0.69 0.16 238);
  --primary-foreground: oklch(0.16 0.025 252);
  --secondary: oklch(0.265 0.032 252);
  --secondary-foreground: oklch(0.93 0.012 245);
  --muted: oklch(0.245 0.026 252);
  --muted-foreground: oklch(0.69 0.025 246);
  --accent: oklch(0.34 0.073 218);
  --accent-foreground: oklch(0.91 0.035 205);
  --destructive: oklch(0.67 0.2 24);
  --border: oklch(0.31 0.028 251);
  --input: oklch(0.285 0.027 251);
  --ring: oklch(0.7 0.14 226);
  --highlight-violet: oklch(0.69 0.15 292);
  --highlight-orange: oklch(0.76 0.15 66);
}

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground; }
  :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 7: Substituir todos os ícones Lucide gerados por Phosphor**

Use `X`, `Check`, `CaretDown`, `CaretRight`, `CaretUp`, `Circle` e outros equivalentes de `@phosphor-icons/react` nos arquivos gerados. Depois rode:

```bash
npm uninstall lucide-react
rg 'lucide-react|from "lucide' src components.json package.json
```

Expected: `rg` termina sem matches. Os PNGs da marca preservam o ativo fornecido e não pertencem ao sistema de ícones funcionais.

- [ ] **Step 8: Confirmar GREEN, acessibilidade básica e build**

Run:

```bash
npm run test:unit -- tests/unit/components/axsys-logo.test.tsx tests/unit/theme/theme-provider.test.tsx
npm run lint
npm run typecheck
npm run build
```

Expected: testes PASS; nenhuma referência circular `--font-sans: var(--font-sans)`; build sem download de fonte no runtime.

- [ ] **Step 9: Commit do design system**

```bash
git add components.json package.json package-lock.json public/brand src/app/globals.css src/app/layout.tsx 'src/app/(public)/layout.tsx' src/components src/lib/theme vitest.config.ts vitest.setup.ts tests/unit/components tests/unit/theme
git commit -m "feat: establish Axsys design system"
```

### Task 3: Completar harness Vitest, Playwright e pgTAP

**Files:**
- Modify: `vitest.config.ts`
- Verify: `vitest.setup.ts`
- Create: `playwright.config.ts`
- Create: `tests/helpers/render.tsx`
- Create: `tests/helpers/query-client.ts`
- Create: `tests/helpers/auth.ts`
- Create: `tests/helpers/server-only.ts`
- Create: `src/modules/auth/domain/access-context.ts`
- Create: `tests/unit/tooling/versions.test.ts`
- Create: `tests/e2e/public/root-redirect.spec.ts`
- Create: `supabase/tests/database/00_harness.test.sql`

- [ ] **Step 1: Criar configuração Vitest com ambientes separados**

Create `vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/helpers/server-only.ts", import.meta.url)),
    },
  },
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/{unit,integration}/**/*.{test,spec}.{ts,tsx}"],
    environment: "jsdom",
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    coverage: {
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/components/ui/**", "src/lib/supabase/database.types.ts"],
    },
  },
})
```

Create `vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest"
import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

afterEach(() => cleanup())
```

- [ ] **Step 2: Criar helpers determinísticos de React Query e render**

Create the shared type contract first at `src/modules/auth/domain/access-context.ts`:

```ts
export type CompanyRole = "company_admin" | "member"
export type ModuleKey = "administrative" | "financial" | "certificates"
export type ThemePreference = "dark" | "light"

type ProfileSummary = {
  displayName: string
  email: string
  preferredTheme: ThemePreference
  version: number
}

export type AccessContext =
  | {
      kind: "platform"
      userId: string
      sessionId: string
      authenticatedAt: number
      profile: ProfileSummary
    }
  | {
      kind: "company"
      userId: string
      sessionId: string
      authenticatedAt: number
      companyId: string
      membershipId: string
      role: CompanyRole
      modules: readonly ModuleKey[]
      profile: ProfileSummary
    }
```

Create `tests/helpers/query-client.ts`:

```ts
import { QueryClient } from "@tanstack/react-query"

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
}
```

Create `tests/helpers/server-only.ts`:

```ts
export {}
```

Create `tests/helpers/render.tsx`:

```tsx
import { QueryClientProvider } from "@tanstack/react-query"
import { render, type RenderOptions } from "@testing-library/react"
import type { ReactElement, ReactNode } from "react"
import { createTestQueryClient } from "./query-client"

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = createTestQueryClient()
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) }
}
```

Create `tests/helpers/auth.ts`:

```ts
import type { AccessContext } from "@/modules/auth/domain/access-context"

export const platformContext: AccessContext = {
  kind: "platform",
  userId: "10000000-0000-4000-8000-000000000001",
  sessionId: "90000000-0000-4000-8000-000000000001",
  authenticatedAt: 1_788_000_000,
  profile: {
    displayName: "Admin da Plataforma",
    email: "platform@example.test",
    preferredTheme: "dark",
    version: 1,
  },
}

export const companyContext: AccessContext = {
  kind: "company",
  userId: "20000000-0000-4000-8000-000000000001",
  sessionId: "90000000-0000-4000-8000-000000000002",
  authenticatedAt: 1_788_000_000,
  companyId: "30000000-0000-4000-8000-000000000001",
  membershipId: "40000000-0000-4000-8000-000000000001",
  role: "company_admin",
  modules: ["administrative", "financial", "certificates"],
  profile: {
    displayName: "Admin Empresa A",
    email: "admin-a@example.test",
    preferredTheme: "dark",
    version: 1,
  },
}
```

- [ ] **Step 3: Testar os pins antes de depender do lockfile**

Create `tests/unit/tooling/versions.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const pkg = JSON.parse(readFileSync("package.json", "utf8"))

describe("toolchain", () => {
  it.each([
    ["next", "16.2.10"],
    ["react", "19.2.7"],
    ["react-dom", "19.2.7"],
    ["@supabase/ssr", "0.12.0"],
    ["@supabase/supabase-js", "2.110.2"],
    ["@tanstack/react-query", "5.101.2"],
    ["@phosphor-icons/react", "2.1.10"],
  ])("fixa %s em %s", (name, version) => {
    expect(pkg.dependencies[name]).toBe(version)
  })

  it("fixa Supabase CLI e npm", () => {
    expect(pkg.devDependencies.supabase).toBe("2.109.1")
    expect(pkg.packageManager).toBe("npm@11.6.2")
  })
})
```

- [ ] **Step 4: Configurar Playwright sem reutilizar servidor externo em CI**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

Create `tests/e2e/public/root-redirect.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

test("a raiz redireciona para o login", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)
})
```

- [ ] **Step 5: Criar o primeiro teste pgTAP**

Create `supabase/tests/database/00_harness.test.sql`:

```sql
begin;
select plan(1);
select pass('pgTAP executa dentro do Supabase local');
select * from finish();
rollback;
```

- [ ] **Step 6: Executar o que já pode passar**

Run:

```bash
npm run test:unit -- tests/unit/tooling/versions.test.ts
npx playwright install chromium
npm run test:e2e -- tests/e2e/public/root-redirect.spec.ts
```

Expected: teste de versões PASS; Playwright ainda pode falhar com `ERR_CONNECTION_REFUSED` somente se o `webServer` não iniciar, o que deve ser corrigido antes de seguir; redirect PASS quando o servidor sobe.

- [ ] **Step 7: Commit do harness JS/browser; pgTAP será executado após o Supabase local**

```bash
git add package.json package-lock.json vitest.config.ts vitest.setup.ts playwright.config.ts src/modules/auth/domain/access-context.ts tests/helpers tests/unit/tooling tests/e2e/public supabase/tests/database/00_harness.test.sql
git commit -m "test: add Axsys verification harness"
```

### Task 4: Supabase CLI local, segredos e papel SQL BFF restrito

**Files:**
- Create generated: `supabase/config.toml`
- Create: `supabase/roles.sql`
- Create: `supabase/seed.sql`
- Create: `.env.example`
- Create: `.env.test.example`
- Modify: `.gitignore`
- Create: `scripts/provision-local-env.ts`
- Create: `src/lib/env/server.ts`
- Create: `src/lib/env/public.ts`
- Create: `src/lib/db/bff.ts`
- Create: `src/lib/realtime/server-invalidation.ts`
- Test: `tests/unit/env/server.test.ts`
- Test: `tests/integration/db/bff-role.test.ts`

- [ ] **Step 1: Descobrir a CLI fixada e inicializar o projeto local**

Run:

```bash
npx supabase --version
npx supabase init --help
npx supabase init
```

Expected: versão `2.109.1`, ajuda exibida e `supabase/config.toml` criado. Se `config.toml` já existir, pare e revise em vez de usar `--force`.

- [ ] **Step 2: Configurar Auth, Mailpit, Realtime e redirects locais**

Keep all generated sections in `supabase/config.toml`, but set these exact values in their corresponding sections:

```toml
project_id = "axsys-local"

[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
major_version = 17

[realtime]
enabled = true

[inbucket]
enabled = true
port = 54324
smtp_port = 54325
pop3_port = 54326
admin_email = "nao-responda@axsys.local"
sender_name = "Axsys"

[auth]
enabled = true
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = [
  "http://127.0.0.1:3000/auth/callback",
  "http://127.0.0.1:3000/reset-password"
]
jwt_expiry = 900
enable_signup = false
enable_anonymous_sign_ins = false
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10

[auth.rate_limit]
email_sent = 10
sign_in_sign_ups = 20
token_refresh = 150
token_verifications = 30

[auth.email]
# The provider must stay enabled so administrator-created users can sign in.
# Global [auth].enable_signup=false still blocks public registration.
enable_signup = true
double_confirm_changes = true
enable_confirmations = true
secure_password_change = true
max_frequency = "1m"
```

Run `npx supabase start --help` before start. The configured 15-minute JWT reduces the maximum window of a revoked access token; application session controls added later enforce 8 hours or 30 days independently.

- [ ] **Step 3: Criar o papel de login sem privilégios herdados**

Create `supabase/roles.sql`:

```sql
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'axsys_bff') then
    create role axsys_bff
      login
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls
      connection limit 20;
  end if;
end
$$;

alter role axsys_bff
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 20;

revoke all on schema public from axsys_bff;
revoke all on all tables in schema public from axsys_bff;
revoke all on all sequences in schema public from axsys_bff;
revoke all on all functions in schema public from axsys_bff;
grant connect on database postgres to axsys_bff;
```

Do not place a password in this file. Local provisioning sets a random password after `supabase start`; hosted provisioning sets a different secret out of band.

- [ ] **Step 4: Garantir que seed e exemplos não contêm credenciais**

Create `supabase/seed.sql`:

```sql
-- Intentionally empty: users and passwords are provisioned from untracked environment variables.
-- Domain fixtures live inside transactional pgTAP tests and are rolled back.
```

Create `.env.example`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
DATABASE_URL=
BFF_DATABASE_URL=
APP_ORIGIN=http://127.0.0.1:3000
CSRF_SECRET=
SECURITY_HASH_PEPPER=
TRUST_PROXY=false
AXSYS_BOOTSTRAP_SUPER_ADMIN_EMAIL=
AXSYS_BOOTSTRAP_SUPER_ADMIN_PASSWORD=
```

Create `.env.test.example`:

```dotenv
AXSYS_E2E_PLATFORM_EMAIL=
AXSYS_E2E_PLATFORM_PASSWORD=
AXSYS_E2E_COMPANY_A_EMAIL=
AXSYS_E2E_COMPANY_A_PASSWORD=
AXSYS_E2E_COMPANY_B_EMAIL=
AXSYS_E2E_COMPANY_B_PASSWORD=
```

Ensure `.gitignore` contains:

```gitignore
.env
.env.*
!.env.example
!.env.test.example
playwright-report/
test-results/
coverage/
supabase/.temp/
```

- [ ] **Step 5: Escrever teste RED para validação server-only**

Create `tests/unit/env/server.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"

describe("serverEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("recusa inicialização sem BFF_DATABASE_URL e segredos", async () => {
    vi.stubEnv("BFF_DATABASE_URL", "")
    vi.stubEnv("SUPABASE_SECRET_KEY", "")
    const { getServerEnv } = await import("@/lib/env/server")
    expect(() => getServerEnv()).toThrow("Invalid server environment")
  })
})
```

Run: `npm run test:unit -- tests/unit/env/server.test.ts`

Expected: FAIL porque `@/lib/env/server` não existe.

- [ ] **Step 6: Implementar schemas de ambiente separados**

Create `src/lib/env/public.ts`:

```ts
import { z } from "zod"

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
})

export function getPublicEnv() {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  })
}
```

Create `src/lib/env/server.ts`:

```ts
import "server-only"
import { z } from "zod"

const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20),
  BFF_DATABASE_URL: z.url().startsWith("postgres"),
  APP_ORIGIN: z.url(),
  CSRF_SECRET: z.string().min(32),
  SECURITY_HASH_PEPPER: z.string().min(32),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
})

export function getServerEnv() {
  const parsed = serverEnvSchema.safeParse(process.env)
  if (!parsed.success) throw new Error("Invalid server environment")
  return parsed.data
}
```

Run: `npm run test:unit -- tests/unit/env/server.test.ts`

Expected: PASS.

- [ ] **Step 7: Provisionar `.env.local` sem imprimir segredos**

Create `scripts/provision-local-env.ts`:

```ts
import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import postgres from "postgres"

function parseEnv(text: string) {
  return Object.fromEntries(
    text
      .split(/\r?\n/u)
      .filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=")
        return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/gu, "")]
      }),
  )
}

function existing(name: string) {
  try {
    return parseEnv(readFileSync(".env.local", "utf8"))[name]
  } catch {
    return undefined
  }
}

const status = parseEnv(
  execFileSync("npx", ["supabase", "status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
)
const apiUrl = status.API_URL
const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY
const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY
const databaseUrl = status.DB_URL
if (!apiUrl || !publishableKey || !secretKey || !databaseUrl) {
  throw new Error("Supabase status did not return required local credentials")
}

const bffPassword = randomBytes(32).toString("base64url")
const adminSql = postgres(databaseUrl, { max: 1 })
await adminSql.unsafe(`alter role axsys_bff password '${bffPassword}'`)
await adminSql.end()

const bffUrl = new URL(databaseUrl)
bffUrl.username = "axsys_bff"
bffUrl.password = bffPassword

const output = [
  `NEXT_PUBLIC_SUPABASE_URL=${apiUrl}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
  `SUPABASE_SECRET_KEY=${secretKey}`,
  `DATABASE_URL=${databaseUrl}`,
  `BFF_DATABASE_URL=${bffUrl.toString()}`,
  "APP_ORIGIN=http://127.0.0.1:3000",
  `CSRF_SECRET=${existing("CSRF_SECRET") ?? randomBytes(32).toString("base64url")}`,
  `SECURITY_HASH_PEPPER=${existing("SECURITY_HASH_PEPPER") ?? randomBytes(32).toString("base64url")}`,
  "TRUST_PROXY=false",
  "",
].join("\n")

writeFileSync(".env.local", output, { encoding: "utf8", mode: 0o600 })
process.stdout.write("Local environment provisioned without printing secrets.\n")
```

The interpolated password is safe here because it is generated as base64url, whose alphabet excludes quotes and SQL metacharacters. Never generalize this `unsafe` call to user-controlled input.

- [ ] **Step 8: Subir a stack, provisionar env e executar o primeiro pgTAP**

Run:

```bash
npm run db:start
npm run db:env
npm run db:status
npm run db:test -- supabase/tests/database/00_harness.test.sql
```

Expected: stack healthy; provisioning prints somente a frase de sucesso; Mailpit em `http://127.0.0.1:54324`; pgTAP mostra `All tests successful` e `Result: PASS`.

- [ ] **Step 9: Escrever teste RED do papel BFF antes de conceder funções**

Create `tests/integration/db/bff-role.test.ts`:

```ts
import postgres from "postgres"
import { afterAll, describe, expect, it } from "vitest"

const sql = postgres(process.env.BFF_DATABASE_URL!, { max: 1 })
afterAll(() => sql.end())

describe("axsys_bff", () => {
  it("não possui BYPASSRLS nem CRUD em public", async () => {
    const [role] = await sql<{ rolbypassrls: boolean }[]>`
      select rolbypassrls from pg_roles where rolname = current_user
    `
    expect(role.rolbypassrls).toBe(false)
    await expect(sql`select * from public.companies`).rejects.toThrow(/permission denied|does not exist/u)
  })
})
```

Run: `npm run test:integration -- tests/integration/db/bff-role.test.ts`

Expected: o teste de BYPASSRLS passa e a asserção de tabela aceita `does not exist` nesta etapa; depois da migration de tabelas, ela continuará passando somente por `permission denied`.

- [ ] **Step 10: Implementar facade SQL lazy sem exportar executor bruto**

Create `src/lib/db/bff.ts`:

```ts
import "server-only"
import postgres, { type Sql } from "postgres"
import { getServerEnv } from "@/lib/env/server"

let bffSql: Sql | undefined

function getSql(): Sql {
  bffSql ??= postgres(getServerEnv().BFF_DATABASE_URL, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    connection: { application_name: "axsys-bff" },
  })
  return bffSql
}

export type RateLimitDecision = {
  allowed: boolean
  attempts: number
  retryAfterSeconds: number
}

export const bffDb = {
  async consumeRateLimit(input: {
    bucket: string
    keyHash: string
    limit: number
    windowSeconds: number
    blockSeconds: number
  }): Promise<RateLimitDecision> {
    const [row] = await getSql()<RateLimitDecision[]>`
      select allowed, attempts, retry_after_seconds as "retryAfterSeconds"
      from private.consume_rate_limit(
        ${input.bucket}, ${input.keyHash}, ${input.limit}, ${input.windowSeconds}, ${input.blockSeconds}
      )
    `
    return row
  },
  async clearRateLimit(bucket: string, keyHash: string): Promise<void> {
    await getSql()`select private.clear_rate_limit(${bucket}, ${keyHash})`
  },
  async registerAuthSession(sessionId: string, userId: string, rememberMe: boolean): Promise<string> {
    const [row] = await getSql()<[{ expiresAt: string }]>`
      select private.register_auth_session(
        ${sessionId}::uuid, ${userId}::uuid, ${rememberMe}
      ) as "expiresAt"
    `
    return row.expiresAt
  },
  async assertAuthSession(sessionId: string, userId: string): Promise<boolean> {
    const [row] = await getSql()<[{ active: boolean }]>`
      select private.assert_auth_session(${sessionId}::uuid, ${userId}::uuid) as active
    `
    return row.active
  },
}
```

`getSql`, the Postgres.js client, tagged-template executor, transaction object, `unsafe`, and dynamic function names remain module-private. Tests use `expectTypeOf` plus a source scan to prove none is exported and no application file outside this facade imports `postgres`. Later plans extend `bffDb` with one typed method per newly granted private function; there is no generic `call`, raw query callback, dynamic identifier, or string-to-SQL escape hatch.

- [ ] **Step 11: Definir a interface server-side de invalidação sem criar tabela**

Create `src/lib/realtime/server-invalidation.ts`:

```ts
import "server-only"

export type InvalidationScope = {
  userId: string
  companyId: string | null
}

export type InvalidationEvent = {
  scope: InvalidationScope
  resources: readonly string[]
  correlationId: string
}

export interface ServerInvalidationPublisher {
  publish(event: InvalidationEvent): Promise<void>
}

export const noOpInvalidationPublisher: ServerInvalidationPublisher = {
  async publish() {},
}
```

The durable outbox/table and concrete Realtime publisher are intentionally supplied by the later notification/invalidation plan; every mutation service can already receive this interface by dependency injection.

- [ ] **Step 12: Verificar e commit**

Run:

```bash
npm run test:unit -- tests/unit/env/server.test.ts
npm run test:integration -- tests/integration/db/bff-role.test.ts
npm run lint
npm run typecheck
git status --short
```

Expected: PASS; `.env.local` não aparece no status; nenhum segredo aparece no diff.

```bash
git add .gitignore .env.example .env.test.example package.json package-lock.json supabase/config.toml supabase/roles.sql supabase/seed.sql scripts/provision-local-env.ts src/lib/env src/lib/db src/lib/realtime/server-invalidation.ts tests/unit/env tests/integration/db
git commit -m "feat: configure local Supabase and restricted BFF role"
```

### Task 5: Schema de identidade, empresas e memberships

**Files:**
- Create via CLI: `supabase/migrations/<CLI_TIMESTAMP>_foundation_identity.sql`
- Create: `supabase/tests/database/helpers/fixtures.inc`
- Create: `supabase/tests/database/01_foundation_identity.test.sql`
- Create: `tests/integration/db/identity-concurrency.test.ts`
- Modify: `tests/integration/db/bff-role.test.ts`

- [ ] **Step 1: Criar o include de fixtures transacionais sem senha de usuário**

Create `supabase/tests/database/helpers/fixtures.inc`:

```sql
create schema if not exists test_helpers;

create or replace function test_helpers.create_auth_user(
  p_user_id uuid,
  p_email text
) returns void
language sql
as $$
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    p_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    lower(btrim(p_email)),
    '',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  ) on conflict (id) do nothing;
$$;

create or replace function test_helpers.create_company(
  p_company_id uuid,
  p_legal_name text,
  p_cnpj text
) returns void
language sql
as $$
  insert into public.companies (
    id, legal_name, cnpj_normalized, contact_email
  ) values (
    p_company_id, p_legal_name, p_cnpj,
    lower(replace(p_legal_name, ' ', '.')) || '@example.test'
  ) on conflict (id) do nothing;
$$;

create or replace function test_helpers.create_company_user(
  p_user_id uuid,
  p_email text,
  p_company_id uuid,
  p_membership_id uuid,
  p_role public.membership_role,
  p_modules public.module_key[] default '{}'::public.module_key[]
) returns void
language plpgsql
as $$
declare
  v_module public.module_key;
begin
  perform test_helpers.create_auth_user(p_user_id, p_email);
  perform test_helpers.create_company(
    p_company_id,
    'Empresa ' || right(p_company_id::text, 1),
    lpad((10000000000000 + ascii(right(p_company_id::text, 1)))::text, 14, '0')
  );
  insert into public.profiles (user_id, email, display_name)
  values (p_user_id, lower(btrim(p_email)), split_part(p_email, '@', 1))
  on conflict (user_id) do nothing;
  insert into public.company_memberships (id, company_id, user_id, role)
  values (p_membership_id, p_company_id, p_user_id, p_role)
  on conflict (id) do nothing;
  foreach v_module in array p_modules loop
    insert into public.member_modules (company_id, membership_id, module)
    values (p_company_id, p_membership_id, v_module)
    on conflict do nothing;
  end loop;
end;
$$;

create or replace function test_helpers.set_jwt(
  p_user_id uuid,
  p_session_id uuid default '90000000-0000-4000-8000-000000000001'
) returns void
language plpgsql
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_user_id,
      'role', 'authenticated',
      'session_id', p_session_id,
      'aal', 'aal1',
      'is_anonymous', false
    )::text,
    true
  );
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
end;
$$;

create or replace function test_helpers.clear_jwt() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;
```

Every consuming `.test.sql` includes it with `\ir helpers/fixtures.inc`, creates fixtures before `set local role authenticated`, then uses `reset role` before cleanup/assertions requiring owner privileges.

- [ ] **Step 2: Escrever o pgTAP RED da estrutura e default-deny**

Create `supabase/tests/database/01_foundation_identity.test.sql`:

```sql
begin;
\ir helpers/fixtures.inc
select no_plan();

select has_type('public', 'company_status');
select has_type('public', 'platform_role');
select has_type('public', 'membership_role');
select has_type('public', 'membership_status');
select has_type('public', 'module_key');
select has_type('public', 'theme_preference');
select has_table('public', 'profiles');
select has_table('public', 'platform_roles');
select has_table('public', 'companies');
select has_table('public', 'company_memberships');
select has_table('public', 'member_modules');
select results_eq(
  $$select relname::text from pg_class join pg_namespace n on n.oid = relnamespace
    where n.nspname = 'public'
      and relname in ('profiles','platform_roles','companies','company_memberships','member_modules')
      and relrowsecurity
      and relforcerowsecurity
    order by relname$$,
  $$values ('companies'),('company_memberships'),('member_modules'),('platform_roles'),('profiles')$$,
  'todas as tabelas base habilitam e forçam RLS'
);
select col_is_unique('public', 'company_memberships', 'user_id');

select is_empty(
  $$select role_name || ':' || relation_name || ':' || privilege_name
    from unnest(array['anon','authenticated','service_role','axsys_bff']) roles(role_name)
    cross join unnest(array['profiles','platform_roles','companies','company_memberships','member_modules']) relations(relation_name)
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privileges(privilege_name)
    where has_table_privilege(
      role_name,
      format('public.%I', relation_name),
      privilege_name
    )$$,
  'nenhum papel de API/BFF herda privilégio de tabela'
);
select has_schema('private');
select ok(
  coalesce(
    has_schema_privilege('axsys_bff', to_regnamespace('private'), 'USAGE'),
    false
  ),
  'axsys_bff recebe somente USAGE no schema privado'
);
select ok(
  not coalesce(
    has_schema_privilege('service_role', to_regnamespace('private'), 'USAGE'),
    false
  ),
  'service_role não recebe USAGE no schema privado'
);
select is_empty(
  $$select proc.oid::regprocedure::text || ':' ||
           coalesce(grantee.rolname, 'PUBLIC') || ':' || grant_item.privilege_type
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    cross join lateral aclexplode(
      coalesce(proc.proacl, acldefault('f', proc.proowner))
    ) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where namespace.nspname = 'private'
      and (
        grant_item.grantee = 0
        or grantee.rolname in ('anon','authenticated','service_role','axsys_bff')
      )$$,
  'funções privadas não possuem EXECUTE inesperado'
);

-- Somente o runner pgTAP recebe acesso transacional às assertions; o rollback remove estes grants.
grant usage on schema extensions to authenticated, service_role;
grant execute on all functions in schema extensions to authenticated, service_role;
set local role authenticated;
select extensions.throws_ok(
  $$select user_id from public.profiles limit 1$$,
  '42501', null, 'authenticated não lê tabela base sem grant'
);
reset role;
set local role service_role;
select extensions.throws_ok(
  $$select id from public.companies limit 1$$,
  '42501', null, 'service_role BYPASSRLS continua bloqueado sem grant'
);
reset role;

select * from finish();
rollback;
```

Use the pgTAP harness already verified by `00_harness.test.sql` and supplied by `supabase test db`; do not install or persist pgTAP from this test file. The only grants above are transaction-local test access to the existing assertion functions and disappear on rollback.

Run: `npm run db:test -- supabase/tests/database/01_foundation_identity.test.sql`

Expected: FAIL com tipos/tabelas ausentes, provando que o teste antecede a migration.

- [ ] **Step 3: Gerar a migration pelo CLI e capturar o caminho impresso**

Run:

```bash
npx supabase migration new foundation_identity
```

Expected: `Created new migration at supabase/migrations/<timestamp>_foundation_identity.sql`. Abra exatamente esse arquivo; não renomeie o prefixo.

- [ ] **Step 4: Implementar enums, tabelas, constraints e triggers**

Put this complete SQL in the CLI-created migration:

```sql
do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_IDENTITY_MIGRATION_OWNER_INVALID';
  end if;

  if not exists (
    select 1
    from pg_default_acl defaults
    where defaults.defaclrole = 'postgres'::regrole
      and defaults.defaclnamespace = 0
      and defaults.defaclobjtype = 'f'
      and not exists (
        select 1
        from aclexplode(defaults.defaclacl) grant_item
        left join pg_roles grantee on grantee.oid = grant_item.grantee
        where grant_item.grantee = 0
           or grantee.rolname in ('anon','authenticated','service_role','axsys_bff')
      )
  ) or exists (
    select 1
    from pg_default_acl defaults
    cross join lateral aclexplode(defaults.defaclacl) grant_item
    left join pg_roles grantee on grantee.oid = grant_item.grantee
    where defaults.defaclrole = 'postgres'::regrole
      and defaults.defaclnamespace = 0
      and defaults.defaclobjtype in ('r','S','f')
      and (
        grant_item.grantee = 0
        or grantee.rolname in ('anon','authenticated','service_role','axsys_bff')
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'AXSYS_GLOBAL_DEFAULT_ACL_NOT_HARDENED';
  end if;
end
$$;

create extension if not exists citext with schema extensions;

create type public.company_status as enum ('active', 'archived');
create type public.platform_role as enum ('super_admin');
create type public.membership_role as enum ('company_admin', 'member');
create type public.membership_status as enum ('active', 'suspended');
create type public.module_key as enum ('administrative', 'financial', 'certificates');
create type public.theme_preference as enum ('dark', 'light');

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role, axsys_bff;
grant usage on schema private to axsys_bff;
-- Defesa em profundidade por schema; a autoridade é o revoke global validado acima.
alter default privileges for role postgres in schema private
  revoke execute on functions from public;
alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated, service_role, axsys_bff;
revoke all on schema public from public;
grant all on schema public to postgres;
grant usage on schema public to authenticator, anon, authenticated, service_role,
  supabase_admin;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email extensions.citext not null unique,
  display_name text not null,
  preferred_theme public.theme_preference not null default 'dark',
  must_change_password boolean not null default false,
  temporary_password_expires_at timestamptz,
  password_changed_at timestamptz,
  is_active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint profiles_email_normalized check (email::text = lower(btrim(email::text))),
  constraint profiles_display_name_length check (char_length(btrim(display_name)) between 2 and 120),
  constraint profiles_temporary_password_state check (
    (must_change_password and temporary_password_expires_at is not null)
    or (not must_change_password and temporary_password_expires_at is null)
  )
);

create table public.platform_roles (
  user_id uuid primary key references public.profiles(user_id) on delete restrict,
  role public.platform_role not null default 'super_admin',
  is_active boolean not null default true,
  created_by uuid references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text,
  cnpj_normalized text not null unique,
  contact_email extensions.citext not null,
  contact_phone text,
  timezone text not null default 'America/Fortaleza',
  status public.company_status not null default 'active',
  archived_at timestamptz,
  archived_by uuid references public.profiles(user_id) on delete restrict,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint companies_legal_name_length check (char_length(btrim(legal_name)) between 2 and 160),
  constraint companies_cnpj_format check (cnpj_normalized ~ '^[0-9]{14}$'),
  constraint companies_email_normalized check (contact_email::text = lower(btrim(contact_email::text))),
  constraint companies_archive_state check (
    (status = 'active' and archived_at is null and archived_by is null)
    or (status = 'archived' and archived_at is not null)
  )
);

create table public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  user_id uuid not null unique references public.profiles(user_id) on delete restrict,
  role public.membership_role not null,
  status public.membership_status not null default 'active',
  created_by uuid references public.profiles(user_id) on delete restrict,
  suspended_at timestamptz,
  suspended_by uuid references public.profiles(user_id) on delete restrict,
  suspension_reason text,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_id, id),
  unique (company_id, user_id),
  constraint memberships_suspension_state check (
    (status = 'active' and suspended_at is null and suspended_by is null and suspension_reason is null)
    or (
      status = 'suspended'
      and suspended_at is not null
      and char_length(btrim(suspension_reason)) between 3 and 500
    )
  )
);

create table public.member_modules (
  company_id uuid not null,
  membership_id uuid not null,
  module public.module_key not null,
  granted_by uuid references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (membership_id, module),
  foreign key (company_id, membership_id)
    references public.company_memberships(company_id, id)
    on delete cascade
);

create index companies_status_idx on public.companies(status);
create index memberships_company_status_idx
  on public.company_memberships(company_id, status, role);
create index memberships_user_status_idx
  on public.company_memberships(user_id, status);
create index member_modules_company_module_idx
  on public.member_modules(company_id, module, membership_id);

create function private.touch_version() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger profiles_touch_version before update on public.profiles
for each row execute function private.touch_version();
create trigger companies_touch_version before update on public.companies
for each row execute function private.touch_version();
create trigger memberships_touch_version before update on public.company_memberships
for each row execute function private.touch_version();

create function private.enforce_identity_exclusivity() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.user_id <> new.user_id then
    if old.user_id::text < new.user_id::text then
      perform pg_advisory_xact_lock(hashtextextended(old.user_id::text, 1672));
      perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 1672));
    else
      perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 1672));
      perform pg_advisory_xact_lock(hashtextextended(old.user_id::text, 1672));
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 1672));
  end if;
  if tg_table_name = 'platform_roles' and exists (
    select 1 from public.company_memberships where user_id = new.user_id
  ) then
    raise exception using errcode = '23514', message = 'identity_scope_conflict';
  end if;
  if tg_table_name = 'company_memberships' and exists (
    select 1 from public.platform_roles where user_id = new.user_id
  ) then
    raise exception using errcode = '23514', message = 'identity_scope_conflict';
  end if;
  return new;
end;
$$;

create trigger platform_role_identity_exclusivity
before insert or update of user_id on public.platform_roles
for each row execute function private.enforce_identity_exclusivity();
create trigger membership_identity_exclusivity
before insert or update of user_id on public.company_memberships
for each row execute function private.enforce_identity_exclusivity();

create function private.protect_last_company_admin() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_leaves_active_admin_set boolean;
begin
  if tg_op = 'DELETE' then
    v_leaves_active_admin_set := true;
  else
    v_leaves_active_admin_set :=
      new.company_id is distinct from old.company_id
      or new.role is distinct from 'company_admin'::public.membership_role
      or new.status is distinct from 'active'::public.membership_status;
  end if;

  if old.role = 'company_admin'
     and old.status = 'active'
     and v_leaves_active_admin_set then
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
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger protect_last_company_admin
before update of company_id, role, status or delete on public.company_memberships
for each row execute function private.protect_last_company_admin();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.platform_roles enable row level security;
alter table public.platform_roles force row level security;
alter table public.companies enable row level security;
alter table public.companies force row level security;
alter table public.company_memberships enable row level security;
alter table public.company_memberships force row level security;
alter table public.member_modules enable row level security;
alter table public.member_modules force row level security;

revoke all on public.profiles, public.platform_roles, public.companies,
  public.company_memberships, public.member_modules from anon, authenticated, service_role, axsys_bff;
revoke all on all functions in schema private from public, anon, authenticated, service_role, axsys_bff;
```

Task 4's checked-in `roles.sql` and local provisioner establish the global default ACL for the `postgres` migration owner before this migration runs. The leading catalog assertion above is mandatory: a schema-local `ALTER DEFAULT PRIVILEGES ... IN SCHEMA private REVOKE` cannot cancel a global grant, so the migration fails before creating application objects unless the global function default exists and PUBLIC/anon/authenticated/service_role/axsys_bff have no global table/sequence/function grant. Every later migration must use that same owner and still issue explicit per-routine REVOKE/GRANT. Add a pgTAP catalog scan over `aclexplode(coalesce(proacl,acldefault('f',proowner)))` that fails for any unexpected PUBLIC/anon/authenticated/service_role/axsys_bff EXECUTE in schema private; a second assertion proves service_role has no schema USAGE. Repeat this scan after all plans in the final gate.

Including `company_id` in the last-admin trigger protects the old company during the Task 5 window but does not by itself make membership identity immutable. Plan 02 still installs the explicit `guard_membership_identity` prohibition and replaces DELETE with the suspension-only workflow; that later hardening complements rather than removes this company-scoped advisory lock.

Create `tests/integration/db/identity-concurrency.test.ts` with Postgres.js and without installing or calling `dblink`. It rejects every non-loopback `DATABASE_URL`, opens exactly two independent connections (`max:1`, distinct fixed `application_name`), and commits otherwise-valid prerequisite fixtures through worker A before starting either race. For the identity insert race, worker A takes the exact session-level advisory key `hashtextextended(user_id::text,1672)`, inserts `platform_roles` inside an explicit transaction, and holds that transaction open; worker B concurrently starts its transaction and attempts the matching `company_memberships` insert. Worker A polls `pg_stat_activity` until worker B reports `wait_event_type='Lock'` and `wait_event='advisory'`, then commits and releases the session gate. Exactly one transaction commits, the other rejects with SQLSTATE `23514` and message `identity_scope_conflict`, and a postcondition proves the user exists in exactly one identity scope. For opposite `user_id` updates, release both transactions from one in-process barrier with fixed `lock_timeout`/`statement_timeout`; both must settle with `identity_scope_conflict`, never `40P01`, proving the sorted old/new lock order.

Add a second deterministic race for `protect_last_company_admin`: commit a company with exactly two active admins, let worker A hold the company key `hashtextextended(company_id::text,2102)` and its first suspension transaction open, start worker B's suspension, observe B blocked, then commit A and release the gate. Exactly one commits, the other returns `23514/last_active_company_admin`, and exactly one active admin remains. Every test uses unique allowlisted fixture UUIDs and `finally` releases session locks, cleans committed fixtures, and closes both workers. Because the last-admin invariant intentionally prevents ordinary deletion of the final admin, its local-only cleanup runs as the validated loopback migration owner in one transaction: acquire `ACCESS EXCLUSIVE` on `company_memberships`, disable only `protect_last_company_admin`, delete only the exact fixture UUIDs in FK order, re-enable that trigger, verify it is enabled plus all fixture rows are absent, and commit. Any cleanup error rolls back the transactional trigger change and fails the test. Never truncate shared tables, install an extension, or accept a remote database.

Now tighten `tests/integration/db/bff-role.test.ts`: through its real `BFF_DATABASE_URL` login, direct SELECT against each of the five new base tables must reject with SQLSTATE `42501`. `does not exist` is no longer an accepted alternative after this migration. This is the executable `axsys_bff` denial; do not emulate that login with `SET ROLE` in pgTAP.

- [ ] **Step 5: Resetar do zero e confirmar GREEN**

Run:

```bash
npm run db:reset
npm run db:env
npm run db:test -- supabase/tests/database/01_foundation_identity.test.sql
npm run test:integration -- tests/integration/db/bff-role.test.ts
npm run test:integration -- tests/integration/db/identity-concurrency.test.ts
npm run db:lint
```

Expected: migration aplicada; todas as assertions nomeadas pelo `no_plan()` passam; as três corridas determinísticas passam sem deadlock nem resíduos; lint retorna `No schema errors found`.

- [ ] **Step 6: Confirmar constraints comportamentais com novo RED/GREEN**

Append before `finish()` in `01_foundation_identity.test.sql`; it already uses `no_plan()` so every new named grant/identity assertion is counted safely:

```sql
select test_helpers.create_auth_user('10000000-0000-4000-8000-000000000001', 'platform@example.test');
insert into public.profiles (user_id, email, display_name)
values ('10000000-0000-4000-8000-000000000001', 'platform@example.test', 'Platform Admin');
insert into public.platform_roles (user_id)
values ('10000000-0000-4000-8000-000000000001');
insert into public.companies (id, legal_name, cnpj_normalized, contact_email)
values (
  '30000000-0000-4000-8000-000000000001',
  'Empresa Válida',
  '10000000000001',
  'empresa.valida@example.test'
);

select throws_ok(
  $$insert into public.company_memberships (company_id, user_id, role)
    values ('30000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001', 'company_admin')$$,
  '23514',
  'identity_scope_conflict',
  'membership de identidade platform falha no BEFORE trigger'
);

select test_helpers.create_auth_user(
  '10000000-0000-4000-8000-000000000002',
  'member-without-company@example.test'
);
insert into public.profiles (user_id, email, display_name)
values (
  '10000000-0000-4000-8000-000000000002',
  'member-without-company@example.test',
  'Member Without Company'
);
select throws_ok(
  $$insert into public.company_memberships (company_id, user_id, role)
    values ('30000000-0000-4000-8000-000000000099',
            '10000000-0000-4000-8000-000000000002', 'member')$$,
  '23503',
  null,
  'membership não-platform com empresa ausente isola o FK de company_id'
);
select throws_ok(
  $$insert into public.companies (legal_name, cnpj_normalized, contact_email)
    values ('Inválida', '123', 'invalida@example.test')$$,
  '23514',
  null,
  'CNPJ normalizado exige 14 dígitos'
);
select throws_ok(
  $$insert into public.profiles (user_id, email, display_name)
    values ('10000000-0000-4000-8000-000000000004',
            'missing-auth@example.test', 'Missing Auth User')$$,
  '23503',
  null,
  'profile normalizado sem auth.user isola o FK de user_id'
);

select test_helpers.create_auth_user(
  '10000000-0000-4000-8000-000000000003',
  'normalized@example.test'
);
select throws_ok(
  $$insert into public.profiles (user_id, email, display_name)
    values ('10000000-0000-4000-8000-000000000003',
            'UPPER@example.test', 'Email Inválido')$$,
  '23514',
  null,
  'auth.user existente isola profiles_email_normalized'
);
```

Run the pgTAP file again. Expected: every named assertion discovered by `no_plan()` passes. These fixtures deliberately ensure that each BEFORE trigger, FK, and CHECK test has only one eligible failure boundary; later RLS tests cover authorized row visibility.

- [ ] **Step 7: Gerar types e commit**

Run:

```bash
npm run db:types
npm run typecheck
```

Expected: `src/lib/supabase/database.types.ts` generated and TypeScript clean.

```bash
git add supabase/migrations/*_foundation_identity.sql supabase/tests/database/helpers/fixtures.inc supabase/tests/database/01_foundation_identity.test.sql tests/integration/db/bff-role.test.ts tests/integration/db/identity-concurrency.test.ts src/lib/supabase/database.types.ts
git commit -m "feat: add tenant identity schema"
```

### Task 6: Auditoria, segurança, idempotência, rate limit e sessões

**Files:**
- Create via CLI: `supabase/migrations/<CLI_TIMESTAMP>_foundation_security_control.sql`
- Create: `supabase/tests/database/02_security_control.test.sql`
- Modify: `supabase/tests/database/01_foundation_identity.test.sql`
- Modify: `supabase/tests/database/helpers/fixtures.inc`
- Modify: `src/lib/db/bff.ts`
- Modify: `tests/unit/db/bff.test.ts`
- Extend, never replace: `tests/integration/db/bff-role.test.ts`
- Create: `tests/integration/db/security-control-concurrency.test.ts`
- Extend, never replace: `tests/integration/db/bff-default-acl.test.ts`
- Modify generated: `src/lib/supabase/database.types.ts`

#### Contrato vinculante de execução da Task 6

The SQL and TypeScript blocks already present in this task are historical, illustrative scaffolding. They are not copy-paste implementations and do not override this subsection. If an illustrative block, assertion count, function body, grant, filename, or later task conflicts with this subsection, this subsection is authoritative. Implement RED → observe the intended failure → minimal GREEN → refactor, and create the migration only with `npx supabase migration new foundation_security_control`; never invent or reuse a timestamp. The final pgTAP file uses `no_plan()` because the complete catalog/ACL/behavior contract is intentionally larger than the original 11/15 smoke assertions.

**Frozen rate-limit policy.** Create owner-only `private.rate_limit_policies(bucket text primary key, attempt_limit integer, window_seconds integer, block_seconds integer, clear_on_success boolean)` containing exactly these six rows, and make `private.rate_limit_buckets.bucket` reference it. No application role receives table DML or SELECT:

| bucket | limit | window | block | clear |
|---|---:|---:|---:|---|
| `login-ip-volume` | 30 | 900 | 1800 | no |
| `login-account-failure` | 5 | 900 | 900 | yes |
| `reauth-ip-volume` | 20 | 900 | 1800 | no |
| `reauth-account-failure` | 5 | 900 | 900 | yes |
| `forgot-ip-volume` | 10 | 900 | 60 | no |
| `forgot-account-volume` | 3 | 3600 | 60 | no |

`private.consume_rate_limit(text,text,integer,integer,integer)` keeps its five-argument signature but rejects NULLs, any key other than lowercase 64-hex, unknown buckets, and any numeric tuple that differs from the frozen row. It must not calculate against a timestamp captured before waiting for a lock. Use a row-lock/retry loop: lock the existing `(bucket,key_hash)` row, capture `clock_timestamp()` only after the lock is acquired, calculate the transition, and retry the insert path after a unique race. Exactly N attempts are allowed and N+1 is blocked; an unexpired block is not cleared merely because the counting window elapsed. Add an `updated_at` cleanup index. `private.clear_rate_limit` validates the same hash grammar and permits only `login-account-failure` and `reauth-account-failure`; IP-volume and forgot-password buckets can never be cleared through the BFF.

**Authoritative session lifecycle and cutoff.** `private.auth_session_controls` uses an explicit `pending → active → revoked` lifecycle. Registration creates only `pending`; pending rows never satisfy `assert_auth_session`, an RLS helper, a guard, or a business writer. The `auth.sessions` row identified by `(id,user_id,created_at)` is authoritative. Use `session_id` as an FK to `auth.sessions(id) on delete cascade` on the pinned Supabase/PostgreSQL schema; the local and linked migration gates must fail rather than silently omit that FK if the expected Auth catalog is absent. Registration takes the per-user transaction advisory lock, locks and validates that Auth row, derives the 8-hour/30-day absolute expiry, and inserts once. Replay may return the original expiry only for the same immutable user, remember-me policy, cutoff, and pending row; it never changes owner/policy/expiry, revives a revoked row, or extends an absolute lifetime.

Create `private.auth_user_session_cutoffs(user_id uuid primary key references auth.users(id) on delete cascade, revoked_before timestamptz not null, updated_at timestamptz not null)` as an owner-only table. Compare `revoked_before` to authoritative `auth.sessions.created_at`; registration rejects an Auth session created at or before the cutoff. `auth_session_controls` has `state private.auth_session_state not null`, `activated_at timestamptz`, and `revoked_at timestamptz`, with a CHECK admitting only: pending with both timestamps NULL; active with activated non-NULL/revoked NULL; or revoked with revoked non-NULL and activated either NULL or ordered no later than revocation. Logout advances the cutoff and revokes all current app-session rows in the same database transaction, so a pre-logout Auth session cannot register late. Every operation that combines identity scope and sessions acquires the Task 5 global identity advisory lock first and the per-user session lock second; no function may reverse that order. In this Task 6 migration, recreate `platform_roles_serialize_identity_invariants` so its statement trigger covers DELETE as well as INSERT/UPDATE, matching the already-serialized membership side and making audit-scope derivation linearizable.

`private.write_authenticated_audit_event` accepts `auth.login` only while the exact actor/session row is pending. It locks and revalidates the Auth session, cutoff, active profile and exactly one authoritative platform-or-active-company identity; sets transaction-local `app.actor_id` only after that proof; inserts the login audit; and changes the same control row to active in one transaction. Any audit/validation failure therefore leaves a non-authorizing pending row, so correctness never depends on a compensating call succeeding. `private.assert_auth_session` and all Task 7 RLS helpers accept active, non-revoked, unexpired, post-cutoff rows only. `private.fail_closed_login_session` revokes only the exact owned pending/active session and is cleanup, not the security boundary that makes pending safe.

Reauthentication requires an unused, different `auth.sessions` ID for the same actor, preserves the old row's remember-me policy, and has one row-lock winner. It creates the new control as active, revokes only the replaced old control, sets `app.actor_id`, and writes `auth.reauthenticated` atomically; other devices remain active. Logout verifies the exact active actor/session, then cutoff + all app-session revocations + `auth.logout` audit are one transaction. Races register/logout, rotate/logout, rotate/rotate, replay/register, and cutoff/register must have one legal winner and no resurrected session.

**Exactly five externally granted audit/session boundaries.** All five are `SECURITY DEFINER`, owned by `postgres`, live in `private`, and have `SET search_path = ''`:

```text
private.write_authenticated_audit_event(uuid,uuid,text,text,uuid,public.audit_outcome,text,uuid,text,text,jsonb)
private.write_security_event(text,uuid,text,text,public.audit_outcome,text,uuid,jsonb)
private.revoke_sessions_and_write_logout(uuid,uuid,uuid,text,text)
private.fail_closed_login_session(uuid,uuid,text,uuid)
private.rotate_app_session_after_reauthentication(uuid,uuid,uuid,uuid)
```

Each exact signature above returns `void`.

Revoke EXECUTE on each exact signature from `PUBLIC`, `anon`, `authenticated`, `service_role`, and `axsys_bff`, then grant only that signature to `axsys_bff`. Apply the same explicit revoke-first rule to `consume_rate_limit`, `clear_rate_limit`, `register_auth_session`, and `assert_auth_session` before their BFF grant. `private.revoke_auth_sessions(uuid,uuid)` and every policy/cutoff/trigger helper remain owner-only with no BFF grant. Its compatibility parameter `p_except_session_id` remains in the signature but v1 rejects every non-NULL value; bulk revocation always advances the cutoff and has no ambiguous survivor semantics. Rotation revokes its one exact old row directly inside its purpose-specific transaction. There is no `bffDb.revokeAuthSessions`, generic SQL caller, dynamic routine name, transaction callback, or raw executor.

After this task, the exact `bffDb` method names are `consumeRateLimit`, `clearRateLimit`, `registerAuthSession`, `assertAuthSession`, `writeAuthenticatedAuditEvent`, `writeSecurityEvent`, `revokeSessionsAndWriteLogout`, `failClosedLoginSession`, and `rotateAppSessionAfterReauthentication`. `consumeRateLimit` returns `Promise<RateLimitDecision>`, `clearRateLimit` returns `Promise<void>` and accepts only the two clearable bucket literals, `registerAuthSession` returns the original absolute expiry as an ISO string, and `assertAuthSession` returns `Promise<boolean>` for active state only. The five writer methods return `Promise<void>`. The SQL compatibility signature of `write_security_event` retains `p_user_id uuid`, but v1 requires it to be NULL and the facade always binds a fixed SQL NULL; the TypeScript method exposes no `userId` input, so pre-auth telemetry cannot attribute an arbitrary profile. Every method maps named fields explicitly and returns no inserted database row or SQL capability.

**Frozen audit/security vocabulary.** The generic authenticated writer accepts only `action='auth.login'`, `resource_type='session'`, NULL `resource_id`, `outcome='success'`, NULL `reason_code`, and metadata `{}` or exactly `{rememberMe:boolean}`. The dedicated boundaries write only `auth.logout` and `auth.reauthenticated`, also against `session`, with NULL resource ID/reason, success outcome, and empty metadata. `fail_closed_login_session` accepts exactly `AUTH_CONTEXT_RESOLUTION_FAILED`, `AUTH_AUDIT_ACTIVATION_FAILED`, or `TEMPORARY_PASSWORD_EXPIRED`.

The pre-auth writer accepts only these event/outcome/reason combinations:

- `auth.login.failed`: `denied/AUTH_INVALID_CREDENTIALS` or `failure/AUTH_PROVIDER_FAILURE`;
- `auth.login.rate_limited`: `denied/IP_RATE_LIMITED` or `denied/ACCOUNT_RATE_LIMITED`;
- `auth.reauthentication.failed`: `denied/AUTH_INVALID_CREDENTIALS` or `failure/AUTH_PROVIDER_FAILURE`;
- `auth.reauthentication.rate_limited`: `denied/IP_RATE_LIMITED` or `denied/ACCOUNT_RATE_LIMITED`;
- `auth.password_recovery.requested`: `success` with NULL reason;
- `auth.password_recovery.failed`: `failure/AUTH_PROVIDER_FAILURE`;
- `auth.password_recovery.rate_limited`: `denied/IP_RATE_LIMITED` or `denied/ACCOUNT_RATE_LIMITED`.

For those events metadata is empty or contains only integer `attempts` and/or `retryAfterSeconds`; both are nonnegative, `attempts <= 1000000`, and `retryAfterSeconds <= 86400`. Reject unknown keys, nesting, arrays, strings, non-integers, and payloads whose canonical UTF-8 JSON exceeds 16 KiB. Rebuild the accepted JSON from the allowlist in SQL rather than persisting the caller object. Audit metadata has the same 16 KiB SQL cap. Hash columns remain lowercase 64-hex and no event accepts plaintext email, IP, user agent, token, session ID, Auth error, request body, or arbitrary identifier in metadata.

**Tables, constraints, indexes, RLS, and ACLs.** Keep the three public enums from the illustrative schema and add the private session lifecycle/cutoff objects required above. Replace the zero-UUID idempotency sentinel with `UNIQUE NULLS NOT DISTINCT (actor_user_id,company_id,operation,key_hash)`. A processing idempotency row has NULL response status/body/completed time. A terminal transition is one-way and single-write; immutable identity/request/expiry fields never change, `completed_at >= created_at`, and serialized response JSON is capped at 64 KiB. An owner-only trigger rejects terminal rewrites, terminal→processing, and changes to actor/company/operation/key/request/created/expiry.

`audit_events` and `security_events` are append-only for application/database routines: reject UPDATE, DELETE, and TRUNCATE with the stable append-only error. This does not claim protection from a malicious PostgreSQL superuser, who can disable/drop triggers; production retention must use a separately approved owner maintenance path. Enable and FORCE RLS on `audit_events`, `security_events`, and `idempotency_keys`, create zero policies in Task 6, and revoke every table privilege from `PUBLIC`, `anon`, `authenticated`, `service_role`, and `axsys_bff`. Do the same for the private tables. ACL assertions must expand effective ACLs and cover SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, and PostgreSQL 17 `MAINTAIN`, not merely inspect `information_schema.role_table_grants`.

Create FK-supporting full indexes for `audit_events.actor_user_id`, `audit_events.company_id`, `security_events.user_id`, `idempotency_keys.company_id`, and `auth_session_controls.user_id`. Keyset indexes are exactly tenant audit `(company_id,occurred_at desc,id desc) where scope='tenant'`, platform audit `(occurred_at desc,id desc) where scope='platform'`, and security event `(event_type,occurred_at desc,id desc)`. Retain idempotency expiry, active-session, pending-session/cutoff, rate `updated_at`, and correlation lookup indexes. The migration starts with the same owner/default-ACL/private-schema precondition used by Task 5; catalog tests require every new table/type/function/trigger owner to be `postgres`, every private function to have an empty fixed search path, and postgres global/public/private defaults to remain fail-closed.

**Required RED/GREEN evidence.** `02_security_control.test.sql` uses `no_plan()` and freezes exact enums, columns, constraints, owners, RLS flags, zero policies, signatures, function security/search-path, trigger events, indexes, and expanded ACLs. Behavioral assertions cover every frozen tuple, N/N+1, stale counting window under an active block, invalid/mismatched tuple, both allowed clears and every forbidden clear; 8h/30d, Auth-row mismatch, cutoff, strict retry, no resurrection, pending nonauthorization, activation+audit, wrong actor/session, platform/tenant scope derivation, suspended/inactive/archive rejection, metadata/reason/action rejection, rotation/logout/fail-closed isolation, idempotency transitions, and UPDATE/DELETE/TRUNCATE append-only behavior. Every rejected call compares before/after rows and audit/security counts so partial residue fails.

Extend `helpers/fixtures.inc` with `test_helpers.create_auth_session(p_session_id uuid,p_user_id uuid,p_created_at timestamptz default clock_timestamp())`, which inserts the matching authoritative `auth.sessions` fixture and no application control row. Update `01_foundation_identity.test.sql` to expect DELETE on `platform_roles_serialize_identity_invariants`; never edit the already-applied Task 5 migration. The complete database suite after Task 6 must therefore validate the strengthened trigger rather than freeze its superseded pre-Task-6 definition.

`security-control-concurrency.test.ts` runs real independent PostgreSQL 17 connections and proves N/N+1 serialization, clock capture after a waited row lock, insert race, register/logout, rotate/rotate, rotate/logout, cutoff/register, and exactly-one audit/activation with bounded timeouts and no deadlock. `bff-role.test.ts` is extended in place: preserve all current role flags, memberships, owner/default-ACL probes, and five Task 5 table denials, then add direct SQLSTATE `42501` denial for every new public and private table—including rate policy, bucket, session-control, and cutoff tables—plus positive calls to every and only allowlisted function. `bff-default-acl.test.ts` is also extended in place; preserve its current probes, cover PUBLIC/API/BFF table/function/sequence/MAINTAIN drift under both `postgres` and `supabase_admin`, run the real hardener, and leave zero objects/grants even on failure. `tests/unit/db/bff.test.ts` freezes the nine methods and exact static routine names and continues to reject raw/dynamic SQL capability.

Task 7 must consume only active session rows in authorization helpers, and Task 11 must activate the pending row only through the atomic `auth.login` writer before treating login as successful. Plan 06 may add invalidation triggers/contexts but must preserve global-identity-before-user-session lock order, cutoff semantics, the five exact grants, and transaction-local verified `app.actor_id`; it may not add a service-role exception.

- [ ] **Step 1: Escrever o pgTAP RED dos controles**

Start `supabase/tests/database/02_security_control.test.sql` with this illustrative RED excerpt, then add every structural/ACL/behavior assertion from the binding contract before implementation:

```sql
begin;
\ir helpers/fixtures.inc
select no_plan();
select has_type('public', 'audit_scope');
select has_type('public', 'audit_outcome');
select has_type('public', 'idempotency_state');
select has_table('public', 'audit_events');
select has_table('public', 'security_events');
select has_table('public', 'idempotency_keys');
select has_table('private', 'rate_limit_buckets');
select has_table('private', 'auth_session_controls');
select has_function('private', 'consume_rate_limit', array['text','text','integer','integer','integer']);
select has_function('private', 'register_auth_session', array['uuid','uuid','boolean']);
select has_function('private', 'revoke_auth_sessions', array['uuid','uuid']);
select * from finish();
rollback;
```

Run: `npm run db:test -- supabase/tests/database/02_security_control.test.sql`

Expected: FAIL for the missing security-control types/tables/functions and the binding assertions; the RED is not complete if only the historical smoke assertions fail.

- [ ] **Step 2: Gerar a migration sem fabricar timestamp**

Run: `npx supabase migration new foundation_security_control`

Expected: CLI imprime o caminho `supabase/migrations/<timestamp>_foundation_security_control.sql`; edite esse arquivo.

- [ ] **Step 3: Implementar tabelas e índices de controle**

The following historical schema excerpt is illustrative only. Implement the stricter columns, lifecycle, constraints, indexes, RLS, ACL, owner, and cutoff contract above in the generated migration; do not copy this excerpt unchanged:

```sql
create type public.audit_scope as enum ('platform', 'tenant');
create type public.audit_outcome as enum ('success', 'denied', 'failure');
create type public.idempotency_state as enum ('processing', 'completed', 'failed');

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  scope public.audit_scope not null,
  company_id uuid references public.companies(id) on delete restrict,
  actor_user_id uuid references public.profiles(user_id) on delete restrict,
  action text not null check (action ~ '^[a-z0-9_.-]{3,120}$'),
  resource_type text not null check (resource_type ~ '^[a-z0-9_.-]{2,80}$'),
  resource_id uuid,
  outcome public.audit_outcome not null,
  reason_code text check (reason_code is null or reason_code ~ '^[A-Z0-9_]{3,80}$'),
  correlation_id uuid not null,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$'),
  user_agent_hash text check (user_agent_hash is null or user_agent_hash ~ '^[a-f0-9]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default clock_timestamp(),
  constraint audit_scope_company check (
    (scope = 'platform' and company_id is null)
    or (scope = 'tenant' and company_id is not null)
  )
);

create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type ~ '^[a-z0-9_.-]{3,120}$'),
  user_id uuid references public.profiles(user_id) on delete restrict,
  email_hash text check (email_hash is null or email_hash ~ '^[a-f0-9]{64}$'),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$'),
  outcome public.audit_outcome not null,
  reason_code text check (reason_code is null or reason_code ~ '^[A-Z0-9_]{3,80}$'),
  correlation_id uuid not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default clock_timestamp()
);

create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  actor_user_id uuid not null references public.profiles(user_id) on delete restrict,
  operation text not null check (operation ~ '^[a-z0-9_.-]{3,120}$'),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  state public.idempotency_state not null default 'processing',
  response_status integer check (response_status between 100 and 599),
  response_body jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  expires_at timestamptz not null,
  constraint idempotency_completion check (
    (state = 'processing' and completed_at is null and response_status is null)
    or (state in ('completed', 'failed') and completed_at is not null and response_status is not null)
  ),
  constraint idempotency_expiry check (expires_at > created_at)
);

create unique index idempotency_actor_operation_key_uidx
  on public.idempotency_keys (
    actor_user_id,
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    operation,
    key_hash
  );
create index audit_tenant_time_idx on public.audit_events(company_id, occurred_at desc)
  where scope = 'tenant';
create index audit_platform_time_idx on public.audit_events(occurred_at desc)
  where scope = 'platform';
create index security_type_time_idx on public.security_events(event_type, occurred_at desc);
create index idempotency_expiry_idx on public.idempotency_keys(expires_at);

create table private.rate_limit_buckets (
  bucket text not null,
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (bucket, key_hash)
);

create table private.auth_session_controls (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  remember_me boolean not null,
  absolute_expires_at timestamptz not null,
  last_seen_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint session_expiry_after_creation check (absolute_expires_at > created_at)
);
create index auth_session_user_active_idx
  on private.auth_session_controls(user_id, absolute_expires_at)
  where revoked_at is null;

alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
alter table public.security_events enable row level security;
alter table public.security_events force row level security;
alter table public.idempotency_keys enable row level security;
alter table public.idempotency_keys force row level security;

revoke all on public.audit_events, public.security_events, public.idempotency_keys
  from anon, authenticated, service_role, axsys_bff;
revoke all on private.rate_limit_buckets, private.auth_session_controls
  from public, anon, authenticated, service_role, axsys_bff;
```

- [ ] **Step 4: Implementar funções atômicas privadas e grants allowlisted**

The following function bodies are historical algorithm sketches only. Implement the lock-after-wait rate algorithm, frozen policy tuples, pending activation, cutoff, exact grants, and five boundaries from the binding contract instead of copying them unchanged:

```sql
create function private.consume_rate_limit(
  p_bucket text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_block_seconds integer
) returns table (allowed boolean, attempts integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.rate_limit_buckets%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_limit < 1 or p_window_seconds < 1 or p_block_seconds < 1
     or p_key_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_parameters';
  end if;

  insert into private.rate_limit_buckets as current (
    bucket, key_hash, window_started_at, attempt_count, blocked_until, updated_at
  ) values (p_bucket, p_key_hash, v_now, 1, null, v_now)
  on conflict (bucket, key_hash) do update set
    window_started_at = case
      when current.blocked_until > v_now then current.window_started_at
      when current.window_started_at + make_interval(secs => p_window_seconds) <= v_now
        or current.blocked_until is not null
      then v_now else current.window_started_at end,
    attempt_count = case
      when current.blocked_until > v_now then current.attempt_count
      when current.window_started_at + make_interval(secs => p_window_seconds) <= v_now
        or current.blocked_until is not null
      then 1
      else current.attempt_count + 1 end,
    blocked_until = case
      when current.blocked_until > v_now then current.blocked_until
      when current.window_started_at + make_interval(secs => p_window_seconds) <= v_now
        or current.blocked_until is not null
      then null
      when current.attempt_count + 1 > p_limit
      then v_now + make_interval(secs => p_block_seconds)
      else null end,
    updated_at = v_now
  returning * into v_row;

  return query select
    v_row.blocked_until is null,
    v_row.attempt_count,
    case when v_row.blocked_until > v_now
      then greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer)
      else 0
    end;
end;
$$;

create function private.clear_rate_limit(p_bucket text, p_key_hash text) returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.rate_limit_buckets
  where bucket = p_bucket and key_hash = p_key_hash;
$$;

create function private.register_auth_session(
  p_session_id uuid,
  p_user_id uuid,
  p_remember_me boolean
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires_at timestamptz := clock_timestamp()
    + case when p_remember_me then interval '30 days' else interval '8 hours' end;
begin
  insert into private.auth_session_controls (
    session_id, user_id, remember_me, absolute_expires_at
  ) values (p_session_id, p_user_id, p_remember_me, v_expires_at)
  on conflict (session_id) do update set
    user_id = excluded.user_id,
    remember_me = excluded.remember_me,
    absolute_expires_at = excluded.absolute_expires_at,
    last_seen_at = clock_timestamp(),
    revoked_at = null;
  return v_expires_at;
end;
$$;

create function private.assert_auth_session(p_session_id uuid, p_user_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
begin
  update private.auth_session_controls set last_seen_at = clock_timestamp()
  where session_id = p_session_id
    and user_id = p_user_id
    and revoked_at is null
    and absolute_expires_at > clock_timestamp()
  returning true into v_active;
  return coalesce(v_active, false);
end;
$$;

create function private.revoke_auth_sessions(
  p_user_id uuid,
  p_except_session_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update private.auth_session_controls set revoked_at = clock_timestamp()
  where user_id = p_user_id
    and revoked_at is null
    and (p_except_session_id is null or session_id <> p_except_session_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function private.reject_append_only_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'append_only_table';
end;
$$;
create trigger audit_events_append_only before update or delete on public.audit_events
for each row execute function private.reject_append_only_mutation();
create trigger security_events_append_only before update or delete on public.security_events
for each row execute function private.reject_append_only_mutation();

revoke all on function private.consume_rate_limit(text,text,integer,integer,integer) from public;
revoke all on function private.clear_rate_limit(text,text) from public;
revoke all on function private.register_auth_session(uuid,uuid,boolean) from public;
revoke all on function private.assert_auth_session(uuid,uuid) from public;
revoke all on function private.revoke_auth_sessions(uuid,uuid) from public;
grant execute on function private.consume_rate_limit(text,text,integer,integer,integer) to axsys_bff;
grant execute on function private.clear_rate_limit(text,text) to axsys_bff;
grant execute on function private.register_auth_session(uuid,uuid,boolean) to axsys_bff;
grant execute on function private.assert_auth_session(uuid,uuid) to axsys_bff;
```

`private.revoke_auth_sessions` is an owner-only core: revoke it explicitly from anon, authenticated, service_role, and axsys_bff, and do not expose a generic `bffDb.revokeAuthSessions(userId,...)`. Only purpose-specific self/admin functions that first validate actor, active session, role and target may call it, set transaction-local `app.actor_id`, and audit in the same transaction. Routine-grant and source tests fail if the generic capability returns.

In this same migration, add five fixed-empty-search-path SECURITY DEFINER boundaries; table DML remains ungranted to service_role and axsys_bff:

- `private.write_authenticated_audit_event(actor,session,action,resource_type,resource_id,outcome,reason_code,correlation_id,ip_hash,user_agent_hash,metadata)` calls `assert_auth_session`, requires actor=session owner, derives platform-vs-company scope/company from authoritative role/membership rows, accepts only a frozen auth action/metadata allowlist, sets transaction-local `app.actor_id`, redacts/limits metadata again in SQL, and inserts one audit row. It never accepts scope/company as authority.
- `private.write_security_event(event_type,user_id,email_hash,ip_hash,outcome,reason_code,correlation_id,metadata)` is the only anonymous/pre-auth writer. It is callable only by axsys_bff, validates a frozen login/rate-limit event allowlist plus hashes/metadata/size, and inserts no plaintext or arbitrary JSON.
- `private.revoke_sessions_and_write_logout(actor,session,correlation_id,ip_hash,user_agent_hash)` verifies the still-active own session, derives audit scope, sets `app.actor_id`, revokes the user's app sessions and inserts the logout audit in one transaction. `private.fail_closed_login_session(actor,session,reason_code,correlation_id)` similarly revokes only the just-registered own session with an allowlisted reason when post-auth context/audit work fails.
- `private.rotate_app_session_after_reauthentication(actor,old_session,new_session,correlation_id)` verifies the active old session, requires a different new session ID for the same actor (the BFF has just verified fresh signed claims), preserves remember-me policy, registers the new control, sets `app.actor_id`, revokes only the replaced old session, and audits reauthentication atomically. Other devices remain signed in.

Revoke EXECUTE on all five from public, anon, authenticated, service_role and grant only to axsys_bff; expose exact typed methods on `bffDb`. pgTAP and `information_schema` assertions prove service_role/clients have no audit/security table INSERT and only these function grants exist. This keeps login/logout/reauthentication compatible with the Plan 06 audit/session invalidation triggers without any service-role exception.

- [ ] **Step 5: Resetar, reprovisionar a senha do papel e confirmar GREEN**

Run:

```bash
npm run db:reset
npm run db:env
npm run db:test -- supabase/tests/database/02_security_control.test.sql
npm run db:lint
```

Expected: every assertion discovered by `no_plan()` passes and lint reports no warnings.

- [ ] **Step 6: Fortalecer o teste do papel restrito**

Extend the existing `tests/integration/db/bff-role.test.ts`; never replace or delete its Task 1–5 role flags, membership, owner/default-ACL, hardener, schema, and base-table assertions. The following is only an illustrative fragment for the new positive/negative cases:

```ts
import postgres from "postgres"
import { afterAll, describe, expect, it } from "vitest"

const sql = postgres(process.env.BFF_DATABASE_URL!, { max: 1, prepare: false })
afterAll(() => sql.end())

describe("axsys_bff", () => {
  it("não possui BYPASSRLS nem CRUD de tabela", async () => {
    const [role] = await sql<{ rolbypassrls: boolean }[]>`
      select rolbypassrls from pg_roles where rolname = current_user
    `
    expect(role.rolbypassrls).toBe(false)
    await expect(sql`select * from public.companies`).rejects.toThrow(/permission denied/u)
    await expect(sql`select * from private.rate_limit_buckets`).rejects.toThrow(/permission denied/u)
  })

  it("executa apenas a função privada concedida", async () => {
    const [result] = await sql<{ allowed: boolean; attempts: number }[]>`
      select * from private.consume_rate_limit(
        'test',
        ${"a".repeat(64)},
        3,
        60,
        60
      )
    `
    expect(result).toMatchObject({ allowed: true, attempts: 1 })
  })
})
```

Run: `npm run test:integration -- tests/integration/db/bff-role.test.ts`

Expected: the complete pre-existing suite plus direct denial of every new public/private table and the exact allowlisted-function cases pass.

- [ ] **Step 7: Testar expiração 8h/30d e append-only no pgTAP**

Keep `no_plan()` and add these time-bound session checks as a small subset of the full lifecycle/cutoff/activation assertions required above before `finish()`:

```sql
select test_helpers.create_auth_user('20000000-0000-4000-8000-000000000001', 'session@example.test');
select test_helpers.create_auth_session(
  '90000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001'
);
select test_helpers.create_auth_session(
  '90000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001'
);
select ok(
  private.register_auth_session(
    '90000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    false
  ) between clock_timestamp() + interval '7 hours 59 minutes'
      and clock_timestamp() + interval '8 hours 1 minute',
  'sessão comum dura oito horas'
);
select ok(
  private.register_auth_session(
    '90000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    true
  ) between clock_timestamp() + interval '29 days 23 hours'
      and clock_timestamp() + interval '30 days 1 hour',
  'lembrar-me dura trinta dias'
);
select is(
  private.revoke_auth_sessions('20000000-0000-4000-8000-000000000001', null),
  2,
  'revoga todas as sessões registradas'
);
select is(
  private.assert_auth_session(
    '90000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001'
  ),
  false,
  'sessão revogada é rejeitada'
);
```

Run the file again. Expected: every assertion discovered by `no_plan()` passes, including append-only UPDATE/DELETE/TRUNCATE and zero-residue failures.

- [ ] **Step 8: Gerar types, advisors e commit**

Run:

```bash
npm run db:types
npm run db:advisors
npm run typecheck
```

Expected: types atualizados; advisors sem findings de segurança não resolvidos. Se o advisor sinalizar `security_definer`, confirme `search_path = ''`, schema `private`, revogação de `PUBLIC` e grant nominal antes de aceitar.

```bash
git add supabase/migrations/*_foundation_security_control.sql supabase/tests/database/01_foundation_identity.test.sql supabase/tests/database/02_security_control.test.sql supabase/tests/database/helpers/fixtures.inc src/lib/db/bff.ts tests/unit/db/bff.test.ts tests/integration/db/bff-role.test.ts tests/integration/db/security-control-concurrency.test.ts tests/integration/db/bff-default-acl.test.ts src/lib/supabase/database.types.ts
git commit -m "feat: add audit security and session controls"
```

### Task 7: Helpers RLS, grants mínimos e matriz cross-tenant

**Files:**
- Create via CLI: `supabase/migrations/<CLI_TIMESTAMP>_foundation_rls.sql`
- Create: `supabase/tests/database/03_foundation_rls.test.sql`

- [ ] **Step 1: Escrever a matriz pgTAP RED com dois tenants e Super Admin**

Create `supabase/tests/database/03_foundation_rls.test.sql`:

```sql
begin;
\ir helpers/fixtures.inc
select no_plan();

select test_helpers.create_auth_user('10000000-0000-4000-8000-000000000001', 'platform@example.test');
insert into public.profiles (user_id, email, display_name)
values ('10000000-0000-4000-8000-000000000001', 'platform@example.test', 'Platform Admin');
insert into public.platform_roles (user_id)
values ('10000000-0000-4000-8000-000000000001');

select test_helpers.create_company_user(
  '20000000-0000-4000-8000-000000000001', 'admin-a@example.test',
  '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  'company_admin', array['administrative','financial']::public.module_key[]
);
select test_helpers.create_company_user(
  '20000000-0000-4000-8000-000000000011', 'member-a@example.test',
  '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000011',
  'member', array['certificates']::public.module_key[]
);
select test_helpers.create_company_user(
  '20000000-0000-4000-8000-000000000002', 'admin-b@example.test',
  '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002',
  'company_admin', array['administrative','financial','certificates']::public.module_key[]
);

do $$
begin
  perform private.register_auth_session(
    '90000000-0000-4000-8000-000000000100',
    '10000000-0000-4000-8000-000000000001', false
  );
  perform private.register_auth_session(
    '90000000-0000-4000-8000-000000000101',
    '20000000-0000-4000-8000-000000000001', false
  );
  perform private.register_auth_session(
    '90000000-0000-4000-8000-000000000111',
    '20000000-0000-4000-8000-000000000011', false
  );
  perform private.register_auth_session(
    '90000000-0000-4000-8000-000000000102',
    '20000000-0000-4000-8000-000000000002', false
  );
end
$$;

insert into public.audit_events (
  scope, company_id, actor_user_id, action, resource_type, outcome, correlation_id
) values
  ('platform', null, '10000000-0000-4000-8000-000000000001',
   'platform.login', 'session', 'success', '80000000-0000-4000-8000-000000000001'),
  ('tenant', '30000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001', 'company.update', 'company', 'success',
   '80000000-0000-4000-8000-000000000002'),
  ('tenant', '30000000-0000-4000-8000-000000000002',
   '20000000-0000-4000-8000-000000000002', 'company.update', 'company', 'success',
   '80000000-0000-4000-8000-000000000003');

select throws_ok(
  $$insert into public.member_modules (company_id, membership_id, module)
    values ('30000000-0000-4000-8000-000000000002',
            '40000000-0000-4000-8000-000000000001', 'certificates')$$,
  '23503', null, 'FK composta bloqueia referência entre tenants'
);

select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000101'
);
set local role authenticated;

select results_eq(
  $$select id from public.companies order by id$$,
  $$values ('30000000-0000-4000-8000-000000000001'::uuid)$$,
  'admin A vê somente empresa A'
);
select results_eq(
  $$select user_id from public.profiles order by user_id$$,
  $$values ('20000000-0000-4000-8000-000000000001'::uuid)$$,
  'admin A vê somente o próprio profile'
);
select results_eq(
  $$select user_id from public.company_memberships order by user_id$$,
  $$values
    ('20000000-0000-4000-8000-000000000001'::uuid),
    ('20000000-0000-4000-8000-000000000011'::uuid)$$,
  'admin A vê memberships da empresa A'
);
select throws_ok(
  $$select * from public.audit_events$$,
  '42501', null, 'admin não lê audit bruto; v1 não expõe tenant audit'
);
select is(private.has_platform_role(), false, 'admin A não é platform');
select is(private.is_active_company_member('30000000-0000-4000-8000-000000000001'), true, 'membership A deriva do JWT');
select is(private.is_active_company_member('30000000-0000-4000-8000-000000000002'), false, 'company B não atravessa tenant');
select is(private.has_module('30000000-0000-4000-8000-000000000001', 'financial'), true, 'módulo concedido é reconhecido');
select is(private.has_module('30000000-0000-4000-8000-000000000001', 'certificates'), false, 'admin não ganha módulo implicitamente');
select throws_ok(
  $$update public.companies set legal_name = 'Ataque' where id = '30000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'sem grant UPDATE não há IDOR de escrita'
);
select throws_ok(
  $$insert into public.company_memberships (company_id, user_id, role)
    values ('30000000-0000-4000-8000-000000000002', gen_random_uuid(), 'member')$$,
  '42501', null, 'sem grant INSERT não há vínculo forjado'
);
select throws_ok(
  $$select * from public.security_events$$,
  '42501', null, 'authenticated não lê eventos de segurança'
);
select throws_ok(
  $$select * from public.idempotency_keys$$,
  '42501', null, 'authenticated não lê idempotência interna'
);

reset role;
do $$ begin
  perform private.revoke_auth_sessions('20000000-0000-4000-8000-000000000001', null);
end $$;
set local role authenticated;
select is_empty($$select id from public.companies$$, 'sessão revogada perde empresas diretamente no RLS');
select is_empty($$select id from public.company_memberships$$, 'sessão revogada perde memberships diretamente no RLS');
select is(private.has_module('30000000-0000-4000-8000-000000000001', 'financial'), false, 'sessão revogada perde módulos');

reset role;
update public.profiles
set must_change_password = true,
    temporary_password_expires_at = clock_timestamp() + interval '24 hours'
where user_id = '20000000-0000-4000-8000-000000000011';
select test_helpers.clear_jwt();
select test_helpers.set_jwt(
  '20000000-0000-4000-8000-000000000011',
  '90000000-0000-4000-8000-000000000111'
);
set local role authenticated;
select is(private.has_active_app_session(), false, 'troca obrigatória bloqueia acesso operacional no RLS');

reset role;
select test_helpers.clear_jwt();
select test_helpers.set_jwt(
  '10000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000100'
);
set local role authenticated;

select is(private.has_platform_role(), true, 'papel platform ativo é reconhecido');
select results_eq(
  $$select id from public.companies order by id$$,
  $$values
    ('30000000-0000-4000-8000-000000000001'::uuid),
    ('30000000-0000-4000-8000-000000000002'::uuid)$$,
  'platform consulta cadastro das empresas'
);
select is_empty($$select * from public.company_memberships$$, 'platform não recebe memberships');
select throws_ok(
  $$select * from public.audit_events$$,
  '42501', null, 'platform usa somente reader BFF sanitizado do Plan 02'
);
select is_empty($$select * from public.member_modules$$, 'platform não recebe módulos empresariais');

select * from finish();
rollback;
```

Run: `npm run db:test -- supabase/tests/database/03_foundation_rls.test.sql`

Expected: FAIL por funções, policies e grants ausentes; `permission denied` no primeiro SELECT autenticado é o RED correto.

- [ ] **Step 2: Gerar a migration pelo comando obrigatório**

Run: `npx supabase migration new foundation_rls`

Expected: o CLI cria `supabase/migrations/<timestamp>_foundation_rls.sql`; edite somente o caminho emitido.

- [ ] **Step 3: Criar helpers pequenos com `search_path` fixo**

Put this SQL in the generated migration:

```sql
create function private.has_registered_app_session() returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and nullif((select auth.jwt() ->> 'session_id'), '') is not null
    and exists (
      select 1
      from private.auth_session_controls s
      join public.profiles p on p.user_id = s.user_id
      where s.session_id = ((select auth.jwt() ->> 'session_id'))::uuid
        and s.user_id = (select auth.uid())
        and s.revoked_at is null
        and s.absolute_expires_at > now()
        and p.is_active
    );
$$;

create function private.has_active_app_session() returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_registered_app_session() and exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid()) and not p.must_change_password
  );
$$;

create function private.has_platform_role() returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_active_app_session() and exists (
    select 1
    from public.platform_roles pr
    join public.profiles p on p.user_id = pr.user_id
    where pr.user_id = (select auth.uid())
      and pr.role = 'super_admin' and pr.is_active and p.is_active and not p.must_change_password
  );
$$;

create function private.is_active_company_member(p_company_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_active_app_session() and exists (
    select 1
    from public.company_memberships cm
    join public.companies c on c.id = cm.company_id
    join public.profiles p on p.user_id = cm.user_id
    where cm.user_id = (select auth.uid())
      and cm.company_id = p_company_id
      and cm.status = 'active' and c.status = 'active' and p.is_active and not p.must_change_password
  );
$$;

create function private.has_company_role(p_company_id uuid, p_role public.membership_role)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_active_company_member(p_company_id) and exists (
    select 1 from public.company_memberships cm
    where cm.user_id = (select auth.uid())
      and cm.company_id = p_company_id
      and cm.role = p_role and cm.status = 'active'
  );
$$;

create function private.has_module(p_company_id uuid, p_module public.module_key)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_active_company_member(p_company_id) and exists (
    select 1
    from public.company_memberships cm
    join public.member_modules mm
      on mm.company_id = cm.company_id and mm.membership_id = cm.id
    where cm.user_id = (select auth.uid())
      and cm.company_id = p_company_id and cm.status = 'active'
      and mm.module = p_module
  );
$$;

revoke all on function private.has_registered_app_session() from public;
revoke all on function private.has_active_app_session() from public;
revoke all on function private.has_platform_role() from public;
revoke all on function private.is_active_company_member(uuid) from public;
revoke all on function private.has_company_role(uuid,public.membership_role) from public;
revoke all on function private.has_module(uuid,public.module_key) from public;
grant usage on schema private to authenticated;
grant execute on function private.has_registered_app_session() to authenticated;
grant execute on function private.has_active_app_session() to authenticated;
grant execute on function private.has_platform_role() to authenticated;
grant execute on function private.is_active_company_member(uuid) to authenticated;
grant execute on function private.has_company_role(uuid,public.membership_role) to authenticated;
grant execute on function private.has_module(uuid,public.module_key) to authenticated;
```

- [ ] **Step 4: Criar policies por intenção e grants por coluna**

Append:

```sql
create policy profiles_select_self on public.profiles
for select to authenticated using (
  user_id = (select auth.uid()) and (select private.has_registered_app_session())
);
create policy profiles_update_self on public.profiles
for update to authenticated
using (user_id = (select auth.uid()) and (select private.has_active_app_session()))
with check (user_id = (select auth.uid()) and (select private.has_active_app_session()));

create policy platform_roles_select_self on public.platform_roles
for select to authenticated
using (user_id = (select auth.uid()) and (select private.has_active_app_session()));

create policy companies_select_authorized on public.companies
for select to authenticated
using ((select private.has_platform_role()) or (select private.is_active_company_member(id)));

create policy memberships_select_company_admin_or_self on public.company_memberships
for select to authenticated
using (
  (user_id = (select auth.uid()) and (select private.has_active_app_session()))
  or (select private.has_company_role(company_id, 'company_admin'))
);

create policy member_modules_select_company_admin_or_self on public.member_modules
for select to authenticated
using (
  ((select private.has_active_app_session()) and exists (
    select 1 from public.company_memberships own
    where own.id = membership_id
      and own.company_id = member_modules.company_id
      and own.user_id = (select auth.uid()) and own.status = 'active'
  ))
  or (select private.has_company_role(company_id, 'company_admin'))
);

grant select on public.profiles, public.platform_roles, public.companies,
  public.company_memberships, public.member_modules to authenticated;
grant update (preferred_theme) on public.profiles to authenticated;
```

A ausência de policies e grants INSERT/DELETE é o default-deny. `profiles` permanece selecionável somente pelo próprio usuário nesta etapa; Plan 02 cria um reader BFF de diretório com colunas exatas, nunca uma policy de leitura de profiles alheios. `audit_events` não recebe SELECT direto: readers purpose-specific de plataforma consultam/recortam metadata através de axsys_bff, e v1 não possui tela de tenant audit. Não crie policy `ALL`, `USING (true)` ou bypass de Super Admin em tabelas operacionais futuras.

Extend pgTAP to prove a revoked or absolutely expired app session reads zero profile rows and cannot update through direct PostgREST even while its JWT remains valid. A registered session in forced-password-change state may SELECT only its own minimal profile row so `getAccessContext` can route to the change screen, but cannot UPDATE profile/theme or read any other operational table. Completing the password flow/new active session restores only the intended self columns.

- [ ] **Step 5: Resetar e confirmar toda a matriz GREEN**

Run:

```bash
npm run db:reset
npm run db:env
npm run db:test -- supabase/tests/database/03_foundation_rls.test.sql
npm run db:lint
npm run db:advisors
```

Expected: todas as asserções pgTAP PASS sob `no_plan()`; sem `rls_disabled_in_public`, view security-definer ou função pública irrestrita.

- [ ] **Step 6: Inspecionar policies e privilégios como gate**

Run:

```bash
npx supabase db query --local "select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' order by tablename, cmd, policyname"
npx supabase db query --local "select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated','axsys_bff') order by grantee, table_name, privilege_type"
```

Expected: `anon` sem grants; `axsys_bff` sem CRUD; `authenticated` somente SELECT listado e UPDATE column-level em `profiles`; nenhuma policy `ALL`.

- [ ] **Step 7: Atualizar types e commit**

```bash
npm run db:types
git add supabase/migrations/*_foundation_rls.sql supabase/tests/database/03_foundation_rls.test.sql src/lib/supabase/database.types.ts
git commit -m "feat: enforce default-deny tenant RLS"
```

### Task 8: Primitivas HTTP, clientes Supabase SSR e CSP no Proxy

**Files:**
- Create: `src/lib/http/api-error.ts`
- Create: `src/lib/http/correlation-id.ts`
- Create: `src/lib/http/error-response.ts`
- Create: `src/lib/security/no-store.ts`
- Create: `src/lib/security/csp.ts`
- Create: `src/lib/security/redact.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/admin.ts`
- Create: `src/lib/supabase/browser.ts`
- Create: `src/lib/supabase/proxy.ts`
- Create: `src/proxy.ts`
- Test: `tests/unit/http/error-response.test.ts`
- Test: `tests/unit/security/csp.test.ts`
- Test: `tests/unit/supabase/admin-client.test.ts`

- [ ] **Step 1: Escrever testes RED para envelope, no-store, CSP e lazy init**

Create `tests/unit/http/error-response.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/http/api-error"
import { toErrorResponse } from "@/lib/http/error-response"

describe("toErrorResponse", () => {
  it("retorna envelope estável, correlation ID e headers sem cache", async () => {
    const response = toErrorResponse(
      new ApiError("FORBIDDEN", 403, "Acesso negado"),
      "80000000-0000-4000-8000-000000000001",
    )
    expect(response.status).toBe(403)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(response.headers.get("vary")).toContain("Cookie")
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Acesso negado",
        correlationId: "80000000-0000-4000-8000-000000000001",
      },
    })
  })
})
```

Create `tests/unit/security/csp.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildContentSecurityPolicy } from "@/lib/security/csp"

describe("buildContentSecurityPolicy", () => {
  it("nega objetos, base e frames e limita connect-src", () => {
    const value = buildContentSecurityPolicy({
      nonce: "nonce-value",
      supabaseUrl: "http://127.0.0.1:54321",
      development: false,
    })
    expect(value).toContain("object-src 'none'")
    expect(value).toContain("base-uri 'none'")
    expect(value).toContain("frame-ancestors 'none'")
    expect(value).toContain("script-src 'self' 'nonce-nonce-value' 'strict-dynamic'")
    expect(value).not.toContain("connect-src *")
  })
})
```

Create `tests/unit/supabase/admin-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"

describe("admin Supabase client", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it("não avalia segredo no import e falha somente ao inicializar", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "")
    const module = await import("@/lib/supabase/admin")
    expect(() => module.getAdminSupabase()).toThrow("Invalid server environment")
  })
})
```

Run:

```bash
npm run test:unit -- tests/unit/http/error-response.test.ts tests/unit/security/csp.test.ts tests/unit/supabase/admin-client.test.ts
```

Expected: FAIL por módulos ausentes.

- [ ] **Step 2: Implementar correlação, erro consistente e no-store**

Create `src/lib/http/api-error.ts`:

```ts
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message)
    this.name = "ApiError"
  }
}
```

Create `src/lib/http/correlation-id.ts`:

```ts
import { randomUUID } from "node:crypto"
import { z } from "zod"

const uuid = z.uuid()

export function getCorrelationId(request: Request) {
  const provided = request.headers.get("x-correlation-id")
  return uuid.safeParse(provided).success ? provided! : randomUUID()
}
```

Create `src/lib/security/no-store.ts`:

```ts
export const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie, Authorization",
} as const

export function withNoStore(response: Response) {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    response.headers.set(name, value)
  }
  return response
}
```

Create `src/lib/http/error-response.ts`:

```ts
import { ZodError } from "zod"
import { ApiError } from "@/lib/http/api-error"
import { withNoStore } from "@/lib/security/no-store"

export function toErrorResponse(error: unknown, correlationId: string) {
  const normalized =
    error instanceof ApiError
      ? error
      : error instanceof ZodError
        ? new ApiError(
            "VALIDATION_FAILED",
            422,
            "Revise os campos informados.",
            error.flatten().fieldErrors as Record<string, string[]>,
          )
        : new ApiError("INTERNAL_ERROR", 500, "Não foi possível concluir a operação.")

  return withNoStore(
    Response.json(
      {
        error: {
          code: normalized.code,
          message: normalized.message,
          correlationId,
          ...(normalized.fieldErrors ? { fieldErrors: normalized.fieldErrors } : {}),
        },
      },
      { status: normalized.status },
    ),
  )
}
```

- [ ] **Step 3: Implementar CSP e hashing/redaction sem dados brutos**

Create `src/lib/security/csp.ts`:

```ts
type CspInput = { nonce: string; supabaseUrl: string; development: boolean }

export function buildContentSecurityPolicy({ nonce, supabaseUrl, development }: CspInput) {
  const httpOrigin = new URL(supabaseUrl).origin
  const wsOrigin = httpOrigin.replace(/^http/u, "ws")
  const script = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]
  if (development) script.push("'unsafe-eval'")

  return [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${httpOrigin}`,
    "font-src 'self' data:",
    `connect-src 'self' ${httpOrigin} ${wsOrigin}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ")
}
```

Create `src/lib/security/redact.ts`:

```ts
import "server-only"
import { createHmac } from "node:crypto"
import { getServerEnv } from "@/lib/env/server"

const sensitiveKey = /password|secret|token|authorization|cookie|cpf|account|branch|document|jwt|key|bytes|model.?output/iu
const sensitiveValue = /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|t_[A-Za-z0-9_-]{43}|(?:postgres(?:ql)?|https?):\/\/[^\s]+(?:token|signature|key|password)[^\s]*)/iu
const MAX_DEPTH = 6
const MAX_KEYS = 50
const MAX_ARRAY = 25
const MAX_STRING = 512
const MAX_NODES = 500
const MAX_OUTPUT_BYTES = 16_384

export function hashSensitive(value: string) {
  return createHmac("sha256", getServerEnv().SECURITY_HASH_PEPPER)
    .update(value.trim().toLowerCase())
    .digest("hex")
}

type RedactionBudget = { nodesLeft: number }

function redactValue(value: unknown, depth: number, seen: WeakSet<object>, budget: RedactionBudget): unknown {
  if (depth > MAX_DEPTH || budget.nodesLeft-- <= 0) return "[TRUNCATED]"
  if (typeof value === "string") {
    if (sensitiveValue.test(value)) return "[REDACTED]"
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value
  if (typeof value !== "object") return "[UNSUPPORTED]"
  if (seen.has(value)) return "[CYCLE]"
  seen.add(value)
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => redactValue(item, depth + 1, seen, budget))
  }
  return Object.fromEntries(Object.entries(value).slice(0, MAX_KEYS).map(([key, item]) => [
    key,
    sensitiveKey.test(key) ? "[REDACTED]" : redactValue(item, depth + 1, seen, budget),
  ]))
}

export function redactRecord(input: Record<string, unknown>) {
  const result = redactValue(input, 0, new WeakSet(), { nodesLeft: MAX_NODES }) as Record<string, unknown>
  return Buffer.byteLength(JSON.stringify(result), "utf8") <= MAX_OUTPUT_BYTES
    ? result
    : { _redacted: "[TRUNCATED]" }
}
```

Audit/security writers do not accept arbitrary metadata merely because it survives this redactor: freeze a scalar-key allowlist per action/event type, reject unknown/nested fields unless that action explicitly defines a bounded object, then run this one shared redactor as defense in depth. Tests cover nested/case-varied keys, arrays, cycles, a 50-way/depth-six tree, exhausted global node budget, oversized depth/count/string, JWT/service keys, branch/account, file bytes, model output, signed URLs, public certificate token/path, and assert UTF-8 serialized output never exceeds 16 KiB. Plan 06 imports this implementation instead of creating a second posture.

- [ ] **Step 4: Criar clientes server/admin lazy com tipos gerados**

Create `src/lib/supabase/server.ts`:

```ts
import "server-only"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { getPublicEnv } from "@/lib/env/public"
import type { Database } from "@/lib/supabase/database.types"

const secureCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
}

export async function createServerSupabase() {
  const cookieStore = await cookies()
  const env = getPublicEnv()
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: secureCookieOptions,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (values) => {
          try {
            values.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, ...secureCookieOptions }),
            )
          } catch {
            // Server Components cannot write; src/proxy.ts performs refresh writes.
          }
        },
      },
    },
  )
}
```

Create `src/lib/supabase/admin.ts`:

```ts
import "server-only"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { getPublicEnv } from "@/lib/env/public"
import { getServerEnv } from "@/lib/env/server"
import type { Database } from "@/lib/supabase/database.types"

let adminClient: SupabaseClient<Database> | undefined

export function getAdminSupabase() {
  if (!adminClient) {
    const publicEnv = getPublicEnv()
    const serverEnv = getServerEnv()
    adminClient = createClient<Database>(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv.SUPABASE_SECRET_KEY,
      {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
      },
    )
  }
  return adminClient
}
```

- [ ] **Step 5: Criar cliente browser incapaz de persistir sessão**

Create `src/lib/supabase/browser.ts`:

```ts
"use client"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { getPublicEnv } from "@/lib/env/public"
import type { Database } from "@/lib/supabase/database.types"

let realtimeClient: SupabaseClient<Database> | undefined

async function getRealtimeAccessToken() {
  const response = await fetch("/api/auth/realtime-token", {
    credentials: "same-origin",
    cache: "no-store",
  })
  if (!response.ok) throw new Error("Realtime authorization failed")
  const body = (await response.json()) as { accessToken: string }
  return body.accessToken
}

export function getBrowserRealtime() {
  if (!realtimeClient) {
    const env = getPublicEnv()
    realtimeClient = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        accessToken: getRealtimeAccessToken,
      },
    )
  }
  return {
    channel: realtimeClient.channel.bind(realtimeClient),
    removeChannel: realtimeClient.removeChannel.bind(realtimeClient),
  }
}
```

Do not export the underlying client; callers receive only channel lifecycle methods and cannot introduce browser `.from()` calls.

- [ ] **Step 6: Implementar refresh SSR em `src/lib/supabase/proxy.ts`**

```ts
import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { getPublicEnv } from "@/lib/env/public"
import type { Database } from "@/lib/supabase/database.types"

const secureCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
}

export async function updateSupabaseSession(request: NextRequest, requestHeaders: Headers) {
  let response = NextResponse.next({ request: { headers: requestHeaders } })
  const env = getPublicEnv()
  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: secureCookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) => {
          values.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request: { headers: requestHeaders } })
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, { ...options, ...secureCookieOptions }),
          )
        },
      },
    },
  )
  await supabase.auth.getClaims()
  return response
}
```

- [ ] **Step 7: Compor nonce, CSP e security headers no Proxy Next 16**

Create `src/proxy.ts`:

```ts
import { type NextRequest } from "next/server"
import { getPublicEnv } from "@/lib/env/public"
import { buildContentSecurityPolicy } from "@/lib/security/csp"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { updateSupabaseSession } from "@/lib/supabase/proxy"

export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "")
  const csp = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: getPublicEnv().NEXT_PUBLIC_SUPABASE_URL,
    development: process.env.NODE_ENV === "development",
  })
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("Content-Security-Policy", csp)

  const response = await updateSupabaseSession(request, requestHeaders)
  response.headers.set("Content-Security-Policy", csp)
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  response.headers.set("X-Content-Type-Options", "nosniff")
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

  if (/^\/(app|platform|api\/auth|api\/profile)(\/|$)/u.test(request.nextUrl.pathname)) {
    Object.entries(NO_STORE_HEADERS).forEach(([name, value]) => response.headers.set(name, value))
  }
  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
```

Next.js extracts the framework/script nonce from the CSP carried on the **request**, so both `x-nonce` and the identical CSP must be present before `updateSupabaseSession`; response-only CSP is invalid. The async root layout calls `connection()` so every nonce-bearing HTML route—including login, forgot/reset/change-password and callback destinations—is dynamically rendered. Integration/E2E under `next start` asserts every framework script nonce matches the request CSP, login/theme/dialog hydration works, and the browser records zero CSP violations. Redirect/callback responses remain no-store with `Vary: Cookie`.

Proxy is refresh and defense-in-depth only. Layouts, handlers, RLS and private SQL functions revalidate authorization independently.

- [ ] **Step 8: Confirmar GREEN, imports server-only e headers**

Run:

```bash
npm run test:unit -- tests/unit/http/error-response.test.ts tests/unit/security/csp.test.ts tests/unit/supabase/admin-client.test.ts
npm run lint
npm run typecheck
npm run build
```

Expected: PASS; build não inicializa conexão DB/Admin no import; CSP contém nonce e nenhum `*` em connect-src.

- [ ] **Step 9: Commit da fronteira HTTP/SSR**

```bash
git add src/lib/http src/lib/security/no-store.ts src/lib/security/csp.ts src/lib/security/redact.ts src/lib/supabase src/proxy.ts tests/unit/http tests/unit/security/csp.test.ts tests/unit/supabase
git commit -m "feat: add secure Supabase SSR boundary"
```

### Task 9: Origin, CSRF, fingerprint e rate limit progressivo

**Files:**
- Create: `src/lib/security/origin.ts`
- Create: `src/lib/security/csrf.ts`
- Create: `src/lib/security/rate-limit.ts`
- Create: `src/app/api/auth/csrf/route.ts`
- Test: `tests/unit/security/csrf.test.ts`
- Test: `tests/integration/security/rate-limit.test.ts`

- [ ] **Step 1: Escrever RED para Origin/CSRF e limite atômico**

Create `tests/unit/security/csrf.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createCsrfToken, verifyCsrfToken } from "@/lib/security/csrf"
import { assertMutationOrigin } from "@/lib/security/origin"

describe("mutation security", () => {
  it("aceita somente token assinado e Origin exata", () => {
    const token = createCsrfToken("s".repeat(32))
    expect(verifyCsrfToken(token, token, "s".repeat(32))).toBe(true)
    expect(verifyCsrfToken(`${token}x`, token, "s".repeat(32))).toBe(false)
    expect(() => assertMutationOrigin("https://evil.test", "https://axsys.test")).toThrow("ORIGIN_INVALID")
  })
})
```

Create `tests/integration/security/rate-limit.test.ts`:

```ts
import postgres from "postgres"
import { afterAll, describe, expect, it } from "vitest"
import { consumeRateLimit } from "@/lib/security/rate-limit"
import { hashSensitive } from "@/lib/security/redact"

const ownerSql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })
afterAll(() => ownerSql.end())

describe("consumeRateLimit", () => {
  it("permite três tentativas e bloqueia atomicamente a quarta", async () => {
    const rawKey = `integration-${crypto.randomUUID()}`
    const keyHash = hashSensitive(rawKey)
    try {
      expect((await consumeRateLimit("forgot-account-volume", rawKey, 3, 3600, 60)).allowed).toBe(true)
      expect((await consumeRateLimit("forgot-account-volume", rawKey, 3, 3600, 60)).allowed).toBe(true)
      expect((await consumeRateLimit("forgot-account-volume", rawKey, 3, 3600, 60)).allowed).toBe(true)
      const blocked = await consumeRateLimit("forgot-account-volume", rawKey, 3, 3600, 60)
      expect(blocked.allowed).toBe(false)
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
    } finally {
      await ownerSql`
        delete from private.rate_limit_buckets
        where bucket = 'forgot-account-volume' and key_hash = ${keyHash}
      `
      const [residue] = await ownerSql<[{ count: number }]>`
        select count(*)::integer as count
        from private.rate_limit_buckets
        where bucket = 'forgot-account-volume' and key_hash = ${keyHash}
      `
      expect(residue.count).toBe(0)
    }
  })
})
```

Run both files. Expected: FAIL por imports ausentes.

- [ ] **Step 2: Implementar Origin exata e double-submit assinado**

Create `src/lib/security/origin.ts`:

```ts
import { ApiError } from "@/lib/http/api-error"

export function assertMutationOrigin(origin: string | null, expectedOrigin: string) {
  if (!origin || origin !== new URL(expectedOrigin).origin) {
    throw new ApiError("ORIGIN_INVALID", 403, "Origem da requisição recusada.")
  }
}
```

Do not add permissive CORS headers or wildcard `OPTIONS` handlers. The BFF is same-origin; an unsupported cross-origin preflight receives no `Access-Control-Allow-Origin`. If a later integration needs CORS, allowlist its exact origin and never combine credentials with `*`.

Create `src/lib/security/csrf.ts`:

```ts
import "server-only"
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { ApiError } from "@/lib/http/api-error"

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url")
}

export function createCsrfToken(secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const nonce = randomBytes(32).toString("base64url")
  const payload = `${nowSeconds}.${nonce}`
  return `${payload}.${sign(payload, secret)}`
}

export function verifyCsrfToken(
  header: string | null,
  cookie: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!header || !cookie || header !== cookie) return false
  const [issuedText, nonce, signature, extra] = header.split(".")
  const issuedAt = Number(issuedText)
  if (!Number.isSafeInteger(issuedAt) || !nonce || !signature || extra
      || issuedAt > nowSeconds + 30 || nowSeconds - issuedAt > 8 * 60 * 60) return false
  const expected = Buffer.from(sign(`${issuedText}.${nonce}`, secret))
  const received = Buffer.from(signature)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export function assertCsrf(header: string | null, cookie: string | null, secret: string) {
  if (!verifyCsrfToken(header, cookie, secret)) {
    throw new ApiError("CSRF_INVALID", 403, "Token de segurança inválido.")
  }
}
```

- [ ] **Step 3: Implementar rate limit via função privada, nunca tabela direta**

Create `src/lib/security/rate-limit.ts`:

```ts
import "server-only"
import { bffDb } from "@/lib/db/bff"
import { hashSensitive } from "@/lib/security/redact"

export type RateLimitDecision = { allowed: boolean; attempts: number; retryAfterSeconds: number }

export async function consumeRateLimit(
  bucket: string,
  rawKey: string,
  limit: number,
  windowSeconds: number,
  blockSeconds: number,
): Promise<RateLimitDecision> {
  return bffDb.consumeRateLimit({
    bucket,
    keyHash: hashSensitive(rawKey),
    limit,
    windowSeconds,
    blockSeconds,
  })
}

export function getClientIp(request: Request) {
  if (process.env.VERCEL === "1") return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  if (process.env.TRUST_PROXY === "true") return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  return "local-or-untrusted-proxy"
}

export function progressiveDelayMs(attempts: number) {
  return Math.min(250 * 2 ** Math.max(0, attempts - 1), 4_000)
}
```

- [ ] **Step 4: Expor token CSRF somente em resposta no-store e cookie HttpOnly**

Create `src/app/api/auth/csrf/route.ts`:

```ts
import { cookies } from "next/headers"
import { createCsrfToken, verifyCsrfToken } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { getServerEnv } from "@/lib/env/server"

export async function GET() {
  const store = await cookies()
  const secret = getServerEnv().CSRF_SECRET
  const existing = store.get("__Host-axsys-csrf")?.value ?? null
  const token = verifyCsrfToken(existing, existing, secret)
    ? existing!
    : createCsrfToken(secret)
  if (token !== existing) {
    store.set("__Host-axsys-csrf", token, {
      httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 8 * 60 * 60,
    })
  }
  return withNoStore(Response.json({ token }))
}
```

The endpoint reuses a still-valid signed cookie rather than overwriting it on every GET, so two tabs receive the same current double-submit token. Login keeps the valid token, logout deletes it, and expiry rotates on the next GET. No token is persisted in Web Storage. E2E opens two tabs, fetches in both, and interleaves mutations after each tab's fetch without either causing a 403; tampered/expired/future tokens still fail.

- [ ] **Step 5: Confirmar GREEN e commit**

```bash
npm run test:unit -- tests/unit/security/csrf.test.ts
npm run test:integration -- tests/integration/security/rate-limit.test.ts
npm run lint
npm run typecheck
git add src/lib/security/origin.ts src/lib/security/csrf.ts src/lib/security/rate-limit.ts src/app/api/auth/csrf tests/unit/security/csrf.test.ts tests/integration/security/rate-limit.test.ts
git commit -m "feat: enforce csrf origin and rate limits"
```

Expected: testes PASS; a chave crua nunca aparece em `rate_limit_buckets` ou logs.

### Task 10: Política de senha, schemas Auth e contexto efetivo

**Files:**
- Create: `src/modules/auth/domain/compromised-password-hashes.ts`
- Create: `src/modules/auth/server/password-policy.ts`
- Create: `src/modules/auth/schemas/auth-schemas.ts`
- Create: `src/modules/auth/server/get-access-context.ts`
- Create: `src/modules/auth/server/guards.ts`
- Test: `tests/unit/auth/password-policy.test.ts`
- Test: `tests/integration/auth/access-context.test.ts`

- [ ] **Step 1: Escrever testes RED de senha e contexto**

Create `tests/unit/auth/password-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { validatePassword } from "@/modules/auth/server/password-policy"

describe("validatePassword", () => {
  it("aceita frase com espaços dentro de 12 pontos de código e 72 bytes", async () => {
    await expect(validatePassword("uma frase longa e memorável")).resolves.toBeUndefined()
  })
  it("rejeita senha curta e comprometida localmente", async () => {
    await expect(validatePassword("curta")).rejects.toMatchObject({ code: "PASSWORD_WEAK" })
    await expect(validatePassword("senha12345678")).rejects.toMatchObject({ code: "PASSWORD_COMPROMISED" })
  })
})
```

Create `tests/integration/auth/access-context.test.ts` with a local authenticated fixture and assert: platform resolves `kind: "platform"`; company A resolves its DB-derived `companyId`; a supplied query/body `companyId` is never an input to `getAccessContext`; revoked `private.auth_session_controls` returns `AUTH_REQUIRED`. Use `auth.admin.createUser` in setup with passwords from `.env.test.local`, delete users in `afterAll`, and invoke the real `getAccessContext` with an injected server Supabase client/cookie jar.

Run both files. Expected: FAIL por implementação ausente.

- [ ] **Step 2: Implementar lista local por SHA-256 e política completa**

Create `src/modules/auth/domain/compromised-password-hashes.ts`:

```ts
export const COMPROMISED_PASSWORD_SHA256 = new Set([
  "2a33349e7e606a8ad2e30e3c84521f9377450cf09083e162e0a9b1480ce0f972",
  "b861f333a274deac7562646c9437a128a9c923d9ab07c2b79569e404de3ad504",
  "8bf4dec545e105bb54dafcfe6436b67ab8bf0c01d7b575d865810661b858d86f",
  "1eb1afa20dc454d6ef3b6dc6abcbd7dca7e519b698fdf073f4625ded09d74807",
  "6a5859a092236f950374f6df5722bbaacfb4cd3e1af829eacbf51bd6786a9bce",
])
```

Create `src/modules/auth/server/password-policy.ts`:

```ts
import "server-only"
import { createHash } from "node:crypto"
import { ApiError } from "@/lib/http/api-error"
import { COMPROMISED_PASSWORD_SHA256 } from "@/modules/auth/domain/compromised-password-hashes"

export async function validatePassword(password: string) {
  const codePoints = Array.from(password).length
  const utf8Bytes = Buffer.byteLength(password, "utf8")
  if (codePoints < 12 || utf8Bytes > 72 || !/\S/u.test(password)) {
    throw new ApiError(
      "PASSWORD_WEAK",
      422,
      "Use ao menos 12 caracteres não vazios e no máximo 72 bytes UTF-8.",
    )
  }
  const hash = createHash("sha256").update(password).digest("hex")
  if (COMPROMISED_PASSWORD_SHA256.has(hash)) {
    throw new ApiError("PASSWORD_COMPROMISED", 422, "Escolha uma senha diferente.")
  }
}
```

Count Unicode code points rather than UTF-16 units, preserve the exact password (no trim/normalization), require at least one non-whitespace code point, and enforce bcrypt/Supabase Auth's 72-byte UTF-8 ceiling before calling Auth. Tests cover all-spaces rejection, 11/12 code points, 72/73 ASCII bytes, and multibyte Unicode at the byte boundary. Every create, temporary-password, change, recovery and reauthentication flow uses this same policy; there is no prehash variant.

- [ ] **Step 3: Definir schemas strict que rejeitam campos protegidos**

Create `src/modules/auth/schemas/auth-schemas.ts`:

```ts
import { z } from "zod"

const email = z.string().trim().toLowerCase().email().max(254)
const password = z.string().min(1).max(128)

export const loginSchema = z.object({ email, password, rememberMe: z.boolean().default(false) }).strict()
export const changePasswordSchema = z.object({ password, confirmation: password }).strict()
  .refine((value) => value.password === value.confirmation, {
    message: "As senhas não coincidem.", path: ["confirmation"],
  })
export const forgotPasswordSchema = z.object({ email }).strict()
export const temporaryPasswordSchema = z.object({ targetUserId: z.uuid(), password }).strict()
export const themeSchema = z.object({ theme: z.enum(["dark", "light"]), version: z.int().positive() }).strict()
```

- [ ] **Step 4: Implementar resolução usando `getClaims()` + controle de sessão**

Create `src/modules/auth/server/get-access-context.ts` with these exported contracts and algorithm:

```ts
import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { bffDb } from "@/lib/db/bff"
import { createServerSupabase } from "@/lib/supabase/server"
import type { Database } from "@/lib/supabase/database.types"
import type { AccessContext, ModuleKey } from "@/modules/auth/domain/access-context"

export type AccessResolution =
  | { status: "anonymous" }
  | { status: "password_change"; userId: string; expired: boolean }
  | { status: "authenticated"; context: AccessContext }

export async function getAccessContext(
  providedClient?: SupabaseClient<Database>,
): Promise<AccessResolution> {
  const client = providedClient ?? await createServerSupabase()
  const { data, error } = await client.auth.getClaims()
  const claims = data?.claims
  if (error || !claims?.sub || !claims.session_id || claims.is_anonymous) return { status: "anonymous" }

  if (!(await bffDb.assertAuthSession(claims.session_id, claims.sub))) {
    return { status: "anonymous" }
  }

  const { data: profile } = await client.from("profiles")
    .select("email,display_name,preferred_theme,must_change_password,temporary_password_expires_at,is_active,version")
    .eq("user_id", claims.sub).maybeSingle()
  if (!profile?.is_active) return { status: "anonymous" }
  if (profile.must_change_password) {
    return {
      status: "password_change",
      userId: claims.sub,
      expired: !profile.temporary_password_expires_at
        || new Date(profile.temporary_password_expires_at).getTime() <= Date.now(),
    }
  }

  const authenticatedAt = Math.max(0, ...(claims.amr ?? []).map((entry) => entry.timestamp ?? 0))
  const profileSummary = {
    displayName: profile.display_name,
    email: profile.email,
    preferredTheme: profile.preferred_theme,
    version: profile.version,
  }
  const { data: platform } = await client.from("platform_roles")
    .select("role,is_active").eq("user_id", claims.sub).maybeSingle()
  if (platform?.role === "super_admin" && platform.is_active) {
    return { status: "authenticated", context: {
      kind: "platform", userId: claims.sub, sessionId: claims.session_id,
      authenticatedAt, profile: profileSummary,
    } }
  }

  const { data: membership } = await client.from("company_memberships")
    .select("id,company_id,role,status")
    .eq("user_id", claims.sub).maybeSingle()
  if (!membership || membership.status !== "active") {
    return { status: "anonymous" }
  }
  const { data: company } = await client.from("companies")
    .select("status").eq("id", membership.company_id).maybeSingle()
  if (company?.status !== "active") {
    return { status: "anonymous" }
  }
  const { data: moduleRows } = await client.from("member_modules")
    .select("module").eq("membership_id", membership.id)
  return { status: "authenticated", context: {
    kind: "company", userId: claims.sub, sessionId: claims.session_id,
    authenticatedAt, companyId: membership.company_id, membershipId: membership.id,
    role: membership.role, modules: (moduleRows ?? []).map((row) => row.module as ModuleKey),
    profile: profileSummary,
  } }
}
```

- [ ] **Step 5: Implementar guards de página/API sem confiar no Proxy**

Create `src/modules/auth/server/guards.ts`:

```ts
import "server-only"
import { redirect } from "next/navigation"
import { ApiError } from "@/lib/http/api-error"
import type { AccessContext, ModuleKey } from "@/modules/auth/domain/access-context"
import { getAccessContext } from "@/modules/auth/server/get-access-context"

export async function requireAccessContext(): Promise<AccessContext> {
  const resolution = await getAccessContext()
  if (resolution.status === "anonymous") redirect("/login")
  if (resolution.status === "password_change") redirect("/change-password")
  return resolution.context
}

export async function requirePlatformContext() {
  const context = await requireAccessContext()
  if (context.kind === "company") redirect("/app/dashboard")
  return context
}

export async function requireCompanyContext(requiredModule?: ModuleKey) {
  const context = await requireAccessContext()
  if (context.kind === "platform") redirect("/platform")
  if (requiredModule && !context.modules.includes(requiredModule)) {
    throw new ApiError("MODULE_FORBIDDEN", 403, "Módulo não autorizado.")
  }
  return context
}

export function requireRecentAuthentication(
  context: AccessContext,
  maxAgeSeconds = 600,
) {
  if (Math.floor(Date.now() / 1000) - context.authenticatedAt > maxAgeSeconds) {
    throw new ApiError(
      "REAUTHENTICATION_REQUIRED",
      403,
      "Confirme sua senha novamente para continuar.",
    )
  }
}
```

Never accept `companyId`, role or modules as guard arguments.

- [ ] **Step 6: Confirmar RED/GREEN, revogação e commit**

```bash
npm run test:unit -- tests/unit/auth/password-policy.test.ts
npm run test:integration -- tests/integration/auth/access-context.test.ts
npm run lint
npm run typecheck
git add src/modules/auth tests/unit/auth tests/integration/auth/access-context.test.ts
git commit -m "feat: derive authenticated access context"
```

Expected: frases com espaços passam; senha comprometida falha; tenant vem somente do banco; sessão revogada resulta anonymous.

### Task 11: Auditoria server-only, login, logout, `me` e token Realtime

**Files:**
- Create: `src/modules/audit/server/write-audit-event.ts`
- Create: `src/modules/audit/server/write-security-event.ts`
- Create: `src/modules/auth/server/login.ts`
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/app/api/auth/me/route.ts`
- Create: `src/app/api/auth/realtime-token/route.ts`
- Create: `src/modules/auth/server/reauthenticate.ts`
- Create: `src/modules/auth/ui/reauthentication-dialog.tsx`
- Create: `src/app/api/auth/reauthenticate/route.ts`
- Test: `tests/integration/auth/login-route.test.ts`
- Test: `tests/integration/auth/logout-route.test.ts`
- Test: `tests/integration/auth/realtime-token.test.ts`
- Test: `tests/integration/auth/reauthenticate.test.ts`
- Test: `tests/e2e/auth/reauthenticate.spec.ts`

- [ ] **Step 1: Escrever testes RED dos contratos observáveis**

In `login-route.test.ts`, start Supabase local, provision one platform user and one company user from untracked env, issue a real CSRF cookie/header pair, and assert: correct role yields `/platform` or `/app/dashboard`; body with extra `companyId`, `role` or `redirectTo` returns 422; wrong password and unknown email both return status 401, code `AUTH_INVALID_CREDENTIALS` and the same message; sixth failed attempt returns 429; every response is no-store. In `logout-route.test.ts`, assert missing CSRF and evil Origin return 403, valid logout revokes `auth_session_controls` and clears cookies. In `realtime-token.test.ts`, assert anonymous is 401, authenticated response is no-store, and the token never appears in localStorage.

Run the three files. Expected: FAIL porque handlers e serviços ainda não existem.

- [ ] **Step 2: Implementar writers allowlisted pelo BFF sem table CRUD**

Create `src/modules/audit/server/write-audit-event.ts` using the frozen `AuthenticatedAuditEventInput` contract. Map each camelCase field explicitly, run `redactRecord(input.metadata ?? {})`, and call only `bffDb.writeAuthenticatedAuditEvent` with the verified actor/session. Scope/company are not inputs. Export `writeAuditEvent(input): Promise<void>` and reject any action/metadata outside the shared allowlist. In Plan 01 the sole generic action is `auth.login`, and that database call is also the pending→active transition; returning from this writer is the activation acknowledgment.

Create `write-security-event.ts` with input `{eventType,emailHash?,ipHash?,outcome,reasonCode?,correlationId,metadata?}` and the same explicit mapping/redaction through only `bffDb.writeSecurityEvent`. The TypeScript boundary has no `userId`; the compatibility SQL argument is always bound to NULL and SQL rejects any non-NULL value. Neither function imports the Supabase admin client, logs input, returns inserted data, or has a generic table/function escape hatch. A source test rejects `.from('audit_events')`, `.from('security_events')`, service-role imports, or a `userId` field.

- [ ] **Step 3: Implementar login sem enumeração e registrar sessão 8h/30d**

`src/modules/auth/server/login.ts` must:

1. parse only `loginSchema` output and derive IP with `getClientIp`;
2. atomically consume `login-ip-volume` (30 attempts/15 minutes, then 30-minute block) on every attempt and `login-account-failure` (5 attempts/15 minutes, then 15-minute block) before Auth; the Task 6 row-lock/retry loop serializes concurrent attempts, captures time after lock acquisition, and each frozen limit allows exactly N attempts, blocking N+1;
3. call the request-bound `createServerSupabase().auth.signInWithPassword({email,password})`;
4. on any Auth error, write only hashes to `security_events`, wait `progressiveDelayMs(attempts)` through an injected `sleep` dependency, and throw the same `AUTH_INVALID_CREDENTIALS` error;
5. on successful Auth, clear only the account-failure bucket, never the IP-volume bucket, then call `getClaims()`, reject missing `sub/session_id`, and call `bffDb.registerAuthSession(session_id,sub,rememberMe)`; this insert is pending and authorizes no RLS/BFF operation;
6. immediately call `writeAuditEvent` for the frozen `auth.login` event. Its SQL boundary revalidates Auth session, cutoff and authoritative identity, rejects an expired temporary password, and commits the audit plus pending→active transition atomically. On rejection, the row remains pending/non-authorizing; call `failClosedLoginSession` only for cleanup, sign out/clear cookies, and return the stable context/expiry failure;
7. only after that activation acknowledgment resolve `getAccessContext`; forced change returns `/change-password`, platform returns `/platform`, and company returns `/app/dashboard`. No route acknowledges login before activation, and no correctness claim depends on compensating revocation of a pending row.

The function returns `{ redirectTo: '/platform' | '/app/dashboard' | '/change-password' }`; no client-supplied navigation value reaches it.

Rate-limit tests use concurrent connections to prove six simultaneous failures cannot lose an increment and the sixth is blocked when the account limit is five. Many sequential successful logins do not accumulate toward a per-account lockout, but success never resets the IP-volume defense; an attacker interleaving a valid login with sprayed accounts still hits the IP limit. A fixed-clock case proves a 60-second block is not released merely because its 10-second counting window elapsed. Unknown and known accounts retain identical status/body/timing buckets.

- [ ] **Step 4: Criar handler login com a ordem Origin → CSRF → parse → serviço**

Create `src/app/api/auth/login/route.ts`:

```ts
import { cookies } from "next/headers"
import { getServerEnv } from "@/lib/env/server"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { assertCsrf } from "@/lib/security/csrf"
import { withNoStore } from "@/lib/security/no-store"
import { assertMutationOrigin } from "@/lib/security/origin"
import { loginSchema } from "@/modules/auth/schemas/auth-schemas"
import { login } from "@/modules/auth/server/login"

export async function POST(request: Request) {
  const correlationId = getCorrelationId(request)
  try {
    const env = getServerEnv()
    assertMutationOrigin(request.headers.get("origin"), env.APP_ORIGIN)
    const store = await cookies()
    assertCsrf(
      request.headers.get("x-csrf-token"),
      store.get("__Host-axsys-csrf")?.value ?? null,
      env.CSRF_SECRET,
    )
    const input = loginSchema.parse(await request.json())
    return withNoStore(Response.json(await login(input, request, correlationId)))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
```

- [ ] **Step 5: Implementar logout, identidade e token Realtime**

`POST /api/auth/logout` checks verified claims first. An already anonymous retry returns 204 no-store without requiring the now-deleted CSRF cookie. An authenticated request must then pass exact Origin/CSRF, calls the single `bffDb.revokeSessionsAndWriteLogout` transaction (revocation plus audit with verified `app.actor_id`), calls `auth.signOut({scope:'global'})`, deletes auth/CSRF cookies even if upstream sign-out is unavailable, and returns 204 no-store. Tests retry logout after cookie deletion, inject database/Auth failures, and prove there is no acknowledged state with a still-authorized app session.

`GET /api/auth/me` calls `getAccessContext()` directly, maps anonymous to `ApiError('AUTH_REQUIRED',401,...)` and forced change to `ApiError('PASSWORD_CHANGE_REQUIRED',403,...)`, then returns only `{kind,userId,companyId?,role?,modules,profile}` under no-store.

`GET /api/auth/realtime-token` first calls `getClaims()` and `getAccessContext()`; only after both succeed it calls `auth.getSession()` solely to extract `session.access_token`, returns `{accessToken}` no-store, and never logs or caches it. This is the only production use of `getSession()`.

- [ ] **Step 6: Implementar reautenticação real e rotação de sessão**

`ReauthenticationDialog` is the single accessible modal used when a sensitive action returns `REAUTHENTICATION_REQUIRED`; it asks only for the current password and retries the original action only after an explicit successful confirmation. POST `/api/auth/reauthenticate` validates Origin, CSRF, strict `{password}` schema, current claims/context, then consumes `reauth-ip-volume` (20 attempts/15 minutes, 30-minute block) and `reauth-account-failure` (5 attempts/15 minutes, 15-minute block). It derives email from the verified profile—not the body—then calls request-bound `signInWithPassword`. Afterward it calls `getClaims()` again, requires the same `sub`, a different fresh `session_id`, and a current password AMR timestamp. It invokes only `bffDb.rotateAppSessionAfterReauthentication`; if database rotation fails, global signout leaves the new Auth cookie unusable by app RLS. It returns the freshly resolved safe AccessContext JSON under no-store and creates no parallel cookie. The dialog applies it through `router.refresh()` before explicitly retrying the original action.

Wrong password and unknown/internal Auth failures share one stable error and record only hashes. Success clears only `reauth-account-failure`; it never clears the IP-volume bucket, so a valid account cannot reset spray protection. The rotated cookie is shared naturally by tabs in the same browser profile; the user-targeted session invalidation plus `/api/auth/me` watchdog makes every tab refresh context. Tests advance beyond 600 seconds, cover N/N+1, Retry-After, interleaved success plus IP spraying, wrong password, changed/different `sub`, same-session fixation, database failure, two tabs, and a stolen old JWT: the old `auth_session_controls` row is revoked and direct PostgREST reads return zero immediately.

- [ ] **Step 7: Confirmar GREEN, busca de APIs proibidas e commit**

```bash
npm run test:integration -- tests/integration/auth/login-route.test.ts tests/integration/auth/logout-route.test.ts tests/integration/auth/realtime-token.test.ts tests/integration/auth/reauthenticate.test.ts
npm run test:e2e -- tests/e2e/auth/reauthenticate.spec.ts --project=chromium-desktop
rg 'getSession\(' src --glob '*.ts' --glob '*.tsx'
rg 'localStorage.*(token|session)|persistSession:\s*true' src
npm run lint
npm run typecheck
```

Expected: testes PASS; primeiro `rg` encontra somente `api/auth/realtime-token/route.ts`; segundo termina sem matches.

```bash
git add src/modules/audit src/modules/auth/server src/modules/auth/ui/reauthentication-dialog.tsx src/app/api/auth/login src/app/api/auth/logout src/app/api/auth/me src/app/api/auth/realtime-token src/app/api/auth/reauthenticate tests/integration/auth tests/e2e/auth/reauthenticate.spec.ts
git commit -m "feat: add audited login and logout BFF"
```

### Task 12: Senha provisória administrativa e troca obrigatória

**Files:**
- Create: `src/modules/auth/server/set-temporary-password.ts`
- Create: `src/modules/auth/server/change-temporary-password.ts`
- Create: `src/app/api/auth/temporary-password/route.ts`
- Create: `src/app/api/auth/change-password/route.ts`
- Create via CLI: migration with suffix `_temporary_password_saga.sql`
- Modify: `src/lib/db/bff.ts`
- Create: `supabase/tests/database/04_temporary_password_saga.test.sql`
- Test: `tests/integration/auth/temporary-password.test.ts`
- Test: `tests/e2e/auth/forced-password-change.spec.ts`

- [ ] **Step 1: Escrever RED cobrindo autorização, expiração e revogação**

The pgTAP test proves operation-table privacy, function grants, authorization, lock/state invariants, session revocation, and direct RLS denial after reservation. The integration test provisions A admin, A member and B member. Assert: A admin can reset A member; the durable reservation sets the flag before Auth, expiry is within 24h, and all old `auth_session_controls` are revoked; the old JWT immediately reads zero operational rows through direct PostgREST/RLS; A admin targeting B gets the same 404 as a random UUID; ordinary user gets 403; stale admin authentication gets `REAUTHENTICATION_REQUIRED`; no response, log, audit, operation row, or exception contains the password. Inject failure (a) before Auth, (b) during Auth, and (c) after Auth but before completion: in every case `must_change_password` remains true, RLS stays closed, the durable operation is reserved/failed for reconciliation, and a safe retry can set a new temporary password. The E2E test logs in with a valid temporary password, is sent only to `/change-password`, cannot open `/app/dashboard`, changes it, is signed out, then logs in with the new password and reaches its portal.

Run both. Expected: FAIL before services/routes.

- [ ] **Step 2: Implementar reset fail-closed com allowlist**

Generate the migration with `npx supabase migration new temporary_password_saga`. It creates private.auth_password_operations with id, actor_user_id, target_user_id, scope/company metadata, kind, status reserved/auth_updated/completed/failed, correlation_id, safe reason_code, expiry, and timestamps; it has no password, email, token, request body, or arbitrary metadata column. Create fixed-empty-search_path SECURITY DEFINER functions `private.begin_temporary_password_reset`, `private.complete_temporary_password_reset`, `private.fail_temporary_password_reset`, and `private.complete_temporary_password_change`. Revoke EXECUTE from public, anon, authenticated, and service_role; grant only to axsys_bff; add matching typed methods to bffDb.

`begin_temporary_password_reset` verifies actor/session from private session controls, rechecks the platform/company-admin target rule from database rows, locks the target profile, sets must_change_password=true plus expiry before any Auth call, revokes every target app session, inserts the durable reservation, and audits the reservation in one transaction. Unknown/cross-tenant targets use the same not-found result. `complete` marks the operation complete and audits success but leaves the forced-change flag true. `fail` records only an allowlisted reason code and deliberately leaves the target blocked. `complete_temporary_password_change` atomically verifies the target flag/expiry, clears it, sets password_changed_at, revokes all app sessions, completes the operation, and audits.

`setTemporaryPassword({actor,targetUserId,password,correlationId})` executes: `requireRecentAuthentication(actor)`; validatePassword; call `bffDb.beginTemporaryPasswordReset`; call only `auth.admin.updateUserById(targetUserId,{password})`; then call `bffDb.completeTemporaryPasswordReset`. If Auth or completion fails, best-effort call the failure marker, never clear the forced flag, return a stable retry-required error, and surface the durable operation in the admin UI. A retry creates a new reservation and new password. The service-role client performs only the Auth password change; it never updates the profile table directly.

- [ ] **Step 3: Implementar troca obrigatória e logout global**

`changeTemporaryPassword(input,correlationId)` validates `getClaims()`, fetches the caller profile, requires an unexpired `must_change_password`, validates password, calls request-bound `auth.updateUser({password})`, then calls only `bffDb.completeTemporaryPasswordChange` so flag clearing, session revocation, operation completion, and audit are atomic. Finally call global signout and return `{redirectTo:'/login'}`. If the database operation or signout fails after Auth, RLS still sees either the true flag or the revoked session and remains fail-closed; the handler reports failure without exposing whether Auth already changed.

- [ ] **Step 4: Criar os dois handlers protegidos**

Both POST handlers apply Origin, CSRF, strict Zod parse, stable errors and no-store. `/api/auth/temporary-password` resolves `getAccessContext()` and converts non-authenticated states to JSON 401/403 before calling the administrative service. `/api/auth/change-password` accepts only `{password,confirmation}` and is the single mutation available while `getAccessContext().status === 'password_change'`.

- [ ] **Step 5: Confirmar GREEN e commit**

```bash
npm run db:reset
npm run db:test -- supabase/tests/database/04_temporary_password_saga.test.sql
npm run db:advisors
npm run db:types
npm run test:integration -- tests/integration/auth/temporary-password.test.ts
npm run test:e2e -- tests/e2e/auth/forced-password-change.spec.ts --project=chromium-desktop
npm run lint
npm run typecheck
TEMP_PASSWORD_MIGRATION="$(find supabase/migrations -type f -name '*_temporary_password_saga.sql' | sort | tail -1)"
test -n "$TEMP_PASSWORD_MIGRATION"
git add "$TEMP_PASSWORD_MIGRATION" supabase/tests/database/04_temporary_password_saga.test.sql src/lib/supabase/database.types.ts src/lib/db/bff.ts src/modules/auth/server/set-temporary-password.ts src/modules/auth/server/change-temporary-password.ts src/app/api/auth/temporary-password src/app/api/auth/change-password tests/integration/auth/temporary-password.test.ts tests/e2e/auth/forced-password-change.spec.ts
git commit -m "feat: enforce temporary password rotation"
```

### Task 13: Recuperação real por e-mail e reset

**Files:**
- Create via CLI: migration with suffix `_password_recovery_saga.sql`
- Create: `supabase/tests/database/05_password_recovery_saga.test.sql`
- Modify: `src/lib/db/bff.ts`
- Modify: `src/lib/supabase/database.types.ts`
- Create: `src/app/api/auth/forgot-password/route.ts`
- Create: `src/app/auth/callback/route.ts`
- Create: `src/app/api/auth/reset-password/route.ts`
- Test: `tests/integration/auth/password-recovery.test.ts`
- Test: `tests/e2e/auth/password-recovery.spec.ts`

- [ ] **Step 1: Escrever RED usando Mailpit local**

Test a known and unknown normalized email: both forgot responses have identical 202 body and no-store; forged Origin/CSRF fail; rate-limited known/unknown remain indistinguishable; Mailpit receives one recovery message only for the known user; callback rejects missing/invalid code and any external `next`; one recovery code works once; successful reset revokes prior sessions and forces a fresh login.

Run: `npm run test:integration -- tests/integration/auth/password-recovery.test.ts`. Expected: FAIL before handlers.

- [ ] **Step 2: Implementar forgot neutro e rate-limited**

`POST /api/auth/forgot-password` validates Origin/CSRF and `forgotPasswordSchema`, consumes `forgot-ip-volume` (10 attempts/15 minutes, 60-minute block) and `forgot-account-volume` (3 attempts/60 minutes, 60-minute block) using hashes, calls `resetPasswordForEmail(email,{redirectTo: APP_ORIGIN + '/auth/callback?next=/reset-password'})`, records a redacted security event, discards whether Auth found the account, and always returns status 202 with `{message:'Se o e-mail estiver cadastrado, enviaremos as instruções.'}` while allowed. A 429 includes an integer `Retry-After` capped at 3600 and has the same message/body length class for known/unknown addresses. Success clears neither volume bucket. Tests freeze N/N+1, parallel atomicity, known/unknown timing/body/bucket equivalence, rotating accounts against the IP cap, and expiry/unblock.

- [ ] **Step 3: Implementar callback PKCE com allowlist exata**

`GET /auth/callback` in this plan reads `code` and accepts only the exact recovery destination `/reset-password`. It calls the server client's `exchangeCodeForSession(code)`, verifies the returned claims/flow are recovery, and rejects every other flow/replay to `/login?recovery=invalid`. It contains no import/stub for future email change. Plan 02 explicitly modifies this file when its sync RPC exists. Never reflect host/protocol from forwarded headers and never accept an absolute or protocol-relative destination. Every redirect has `Cache-Control: private,no-store`, `Pragma:no-cache` and `Vary: Cookie`.

- [ ] **Step 4: Implementar saga fail-closed que exige recovery recente**

Generate `password_recovery_saga` through the CLI. Add private one-time recovery grants containing only grant_hash, user_id, Auth session_id, expires_at, consumed_at and timestamps, with UNIQUE `(session_id)` as well as UNIQUE grant hash. Expose one narrowly named public SECURITY DEFINER `issue_password_recovery_grant(grant_hash)` to authenticated only: it derives user/session from `auth.uid()/auth.jwt()`, parses the recovery AMR timestamp, requires `clock_timestamp() < amr_at + interval '10 minutes'`, sets the single deadline exactly to `amr_at + interval '10 minutes'`, returns that deadline, and performs insert-once for the Auth recovery session without rotate/reissue—even with a different hash. Revoke every other grant-table/function capability. After verified PKCE exchange, the callback generates 32 random bytes, invokes that RPC through the request-bound recovery client with only SHA-256, and stores the raw value in `__Host-axsys-recovery-grant` with HttpOnly, Secure, SameSite=Strict, `Path=/`, no Domain, and integer Max-Age `floor(expiresAt-now)` clamped to 1–600 seconds; then it redirects no-store. The database and cookie therefore share one deadline. pgTAP/fake-clock tests cover just-before/at/after AMR+10m, two issue calls/different hashes, concurrent issue, first completion plus global signout, cookie attributes/Max-Age, and all subsequent issue/begin attempts for that recovery session.

Extend the durable private password-operation model with `begin_password_recovery(grant_hash,correlation_id)`, `complete_password_recovery`, and `fail_password_recovery`, fixed-empty-search-path, EXECUTE only for axsys_bff, plus typed `bffDb` methods. `begin` derives actor/session/time only from the locked unexpired private grant, atomically consumes it, locks the profile, reserves a one-use operation, sets `must_change_password=true` with short expiry and revokes all app sessions before Auth changes. It accepts no actor/session/AMR timestamp from the route. `complete` clears flags, sets password_changed_at, marks the operation complete and audits atomically; `fail` records only an allowlisted reason and deliberately leaves RLS closed. pgTAP proves forged actor/session/timestamp/hash, stale grant and replay fail.

`POST /api/auth/reset-password` validates Origin/CSRF, requires the recovery grant cookie, runs the shared password policy, calls begin with its SHA-256, then request-bound `auth.updateUser({password})`, then complete, and finally global signout plus recovery/auth/CSRF cookie clearing. Auth or completion failures best-effort mark fail and remain blocked; a second use has no valid grant/session/operation and returns 401. Tests inject failures before Auth, during Auth and after Auth, stale AMR/grant, refresh/replay, and prove no intermediate state has operational RLS access.

- [ ] **Step 5: Confirmar Mailpit/E2E e commit**

```bash
npm run test:integration -- tests/integration/auth/password-recovery.test.ts
npm run db:test -- supabase/tests/database/05_password_recovery_saga.test.sql
npm run db:types
npm run test:e2e -- tests/e2e/auth/password-recovery.spec.ts --project=chromium-desktop
npm run lint
npm run typecheck
PASSWORD_RECOVERY_MIGRATION="$(find supabase/migrations -type f -name '*_password_recovery_saga.sql' | sort | tail -1)"
test -n "$PASSWORD_RECOVERY_MIGRATION"
git add "$PASSWORD_RECOVERY_MIGRATION" supabase/tests/database/05_password_recovery_saga.test.sql src/lib/db/bff.ts src/lib/supabase/database.types.ts src/app/api/auth/forgot-password src/app/auth/callback src/app/api/auth/reset-password tests/integration/auth/password-recovery.test.ts tests/e2e/auth/password-recovery.spec.ts
git commit -m "feat: add neutral email password recovery"
```

### Task 14: Telas públicas de Auth e troca obrigatória

**Files:**
- Create: `src/modules/auth/ui/auth-shell.tsx`
- Create: `src/modules/auth/ui/use-secure-mutation.ts`
- Create: `src/modules/auth/ui/login-form.tsx`
- Create: `src/modules/auth/ui/forgot-password-form.tsx`
- Create: `src/modules/auth/ui/password-form.tsx`
- Create: `src/app/(public)/login/page.tsx`
- Create: `src/app/(public)/forgot-password/page.tsx`
- Create: `src/app/(public)/reset-password/page.tsx`
- Create: `src/app/(public)/change-password/page.tsx`
- Test: `tests/unit/auth/auth-forms.test.tsx`
- Test: `tests/e2e/auth/login.spec.ts`

- [ ] **Step 1: Escrever RED de acessibilidade, estados e payload estrito**

Assert with Testing Library: labels are associated; first invalid field receives focus; error uses `role="alert"`; submit has a textual loading state and is disabled once; Enter submits; password accepts spaces and has no `trim()`; login sends exactly `email,password,rememberMe`; forgot always shows neutral success; password forms send exactly `password,confirmation`. E2E covers keyboard-only login at mobile and desktop widths plus generic invalid credentials.

Run tests. Expected: FAIL before components/pages.

- [ ] **Step 2: Implementar shell de marca fiel e hook CSRF em memória**

`AuthShell` renders the image-based `<AxsysLogo variant="horizontal" />`, one `Card` capped at `max-w-md`, heading/description slots and no decorative animation. `useSecureMutation<T>` fetches `/api/auth/csrf` with `cache:'no-store'`, keeps the returned token only in React state, sends `x-csrf-token` and JSON to the configured endpoint, parses `ApiErrorBody`, exposes `{submit,pending,error,fieldErrors}`, and never writes token/form/session to storage.

- [ ] **Step 3: Implementar formulários com shadcn/RHF/Zod**

`LoginForm` uses `react-hook-form`, `zodResolver(loginSchema)`, `Label/Input/Checkbox/Button/Alert`, navigates only to the server-returned allowlisted `redirectTo`, and renders links to `/forgot-password`. `ForgotPasswordForm` always replaces the form with the neutral server message on 202. `PasswordForm` receives `mode: 'temporary' | 'recovery'`, posts respectively to `/api/auth/change-password` or `/api/auth/reset-password`, and after success uses `router.replace('/login')`. Every input has `aria-invalid`, `aria-describedby`, autocomplete (`email`, `current-password`, `new-password`) and 44px minimum action height.

- [ ] **Step 4: Criar pages server-first e bloquear atalhos**

`/login` redirects an already authenticated platform/company context to its canonical portal and forced-password context to `/change-password`. `/forgot-password` is public. `/reset-password` renders only when `getClaims()` includes recovery AMR; otherwise redirects `/forgot-password`. `/change-password` renders only for `AccessResolution.status === 'password_change'`; expired temporary password shows a non-enumerating alert and link to recovery, with no form.

- [ ] **Step 5: Confirmar responsividade/teclado e commit**

```bash
npm run test:unit -- tests/unit/auth/auth-forms.test.tsx
npm run test:e2e -- tests/e2e/auth/login.spec.ts
npm run lint
npm run typecheck
git add src/modules/auth/ui src/app/'(public)' tests/unit/auth/auth-forms.test.tsx tests/e2e/auth/login.spec.ts
git commit -m "feat: build accessible Axsys auth screens"
```

### Task 15: Shells `/platform` e `/app`, redirects e tema persistido

**Files:**
- Create: `src/components/layout/platform-shell.tsx`
- Create: `src/components/layout/company-shell.tsx`
- Create: `src/components/layout/responsive-navigation.tsx`
- Create: `src/components/theme/theme-toggle.tsx`
- Create: `src/components/providers/scoped-providers.tsx`
- Create: `src/app/(protected)/platform/layout.tsx`
- Create: `src/app/(protected)/platform/page.tsx`
- Create: `src/app/(protected)/platform/loading.tsx`
- Create: `src/app/(protected)/platform/error.tsx`
- Create: `src/app/(protected)/app/layout.tsx`
- Create: `src/app/(protected)/app/page.tsx`
- Create: `src/app/(protected)/app/dashboard/page.tsx`
- Create: `src/app/(protected)/app/loading.tsx`
- Create: `src/app/(protected)/app/error.tsx`
- Create: `src/app/api/profile/theme/route.ts`
- Create: `scripts/bootstrap-local.ts`
- Test: `tests/integration/routing/portal-guards.test.ts`
- Test: `tests/e2e/routing/portal-isolation.spec.ts`
- Test: `tests/e2e/theme/theme.spec.ts`

- [ ] **Step 1: Escrever RED da matriz de redirects e tema**

Assert: visitor `/platform` and `/app` → `/login`; platform `/app` → `/platform`; company `/platform` → `/app/dashboard`; forced password from either portal → `/change-password`; direct URLs behave like menu clicks; dark is initial; saving light updates `profiles`, survives a new tab, and another user remains dark; stale profile version returns 409 and current record.

- [ ] **Step 2: Implementar shells responsivos sem dados simulados**

`ResponsiveNavigation` uses permanent sidebar at `lg`, collapsible rail from `sm` to `lg`, and shadcn `Sheet` below `sm`; overlay closes on Escape and returns focus; targets are at least 44px. `PlatformShell` lists only Visão geral, Empresas, Administradores, Auditoria e Saúde. `CompanyShell` always lists Dashboard, Usuários, Perfil e Empresa for admins, and conditionally lists Administrativo/Financeiro/Certidões from `context.modules`; it never uses a client-provided role. Foundation pages contain a truthful heading and empty-state explanation, not fabricated metrics.

Each portal gets a `loading.tsx` built from shadcn `Skeleton` and a client `error.tsx` with `role="alert"`, correlation-friendly generic copy and retry button. Access denied is rendered by the segment error boundary without leaking whether a foreign resource exists.

- [ ] **Step 3: Proteger layouts dinamicamente e reinicializar providers por identidade**

Both layouts export `const dynamic = 'force-dynamic'`. Platform layout awaits `requirePlatformContext`; app layout awaits `requireCompanyContext`. Each wraps children in `<ScopedProviders key={`${userId}:${companyId ?? 'platform'}`} ...>` so switching identity unmounts query/theme state. `/app` redirects `/app/dashboard`; the root `/` remains `/login`.

- [ ] **Step 4: Persistir tema via BFF/RLS com conflito 409**

`PATCH /api/profile/theme` validates Origin/CSRF and `themeSchema`, gets the authenticated context, performs the user-scoped update `.update({preferred_theme:theme}).eq('user_id',userId).eq('version',version).select('preferred_theme,version').maybeSingle()`. Empty result triggers a fresh self SELECT and returns status 409 with `{error:{code:'VERSION_CONFLICT',message:'Os dados mudaram em outra sessão.',correlationId},current:{preferredTheme,version}}`. Success returns the persisted row no-store. `ThemeToggle` waits for this response before calling `setTheme`; it rolls back visual selection on error and publishes profile invalidation.

- [ ] **Step 5: Criar bootstrap que exige credencial local e compensa falhas**

`scripts/bootstrap-local.ts` reads `AXSYS_BOOTSTRAP_SUPER_ADMIN_EMAIL/PASSWORD`, exits with a clear missing-env error, validates/normalizes email and `validatePassword`, creates Auth user server-side with confirmed email, inserts explicit profile and platform role, deletes the Auth user if either insert fails, and prints only the created user UUID. It never embeds or prints the password.

- [ ] **Step 6: Confirmar isolamento, tema e commit**

```bash
npm run test:integration -- tests/integration/routing/portal-guards.test.ts
npm run test:e2e -- tests/e2e/routing/portal-isolation.spec.ts tests/e2e/theme/theme.spec.ts
npm run lint
npm run typecheck
git add src/components/layout src/components/theme src/components/providers/scoped-providers.tsx src/app/'(protected)' src/app/api/profile/theme scripts/bootstrap-local.ts tests/integration/routing tests/e2e/routing tests/e2e/theme
git commit -m "feat: separate platform and company portals"
```

### Task 16: Query scope, BroadcastChannel e Realtime como sinal

**Files:**
- Create: `src/lib/query/query-client.ts`
- Create: `src/lib/query/query-keys.ts`
- Create: `src/lib/query/query-provider.tsx`
- Create: `src/lib/query/mutation-sync.tsx`
- Create: `src/lib/realtime/invalidation-channel.ts`
- Modify: `src/components/providers/scoped-providers.tsx`
- Create via CLI: `supabase/migrations/<CLI_TIMESTAMP>_foundation_realtime_signals.sql`
- Test: `tests/unit/query/query-keys.test.ts`
- Test: `tests/unit/query/mutation-sync.test.tsx`
- Test: `tests/integration/realtime/cross-tenant-signal.test.ts`

- [ ] **Step 1: Escrever RED de separação de cache e sinal sem payload**

Assert: A/B/platform query keys differ; changing user clears the old `QueryClient`; same-scope BroadcastChannel invalidates list/detail/count/dashboard resources; other-scope message is ignored; Realtime callback calls `invalidateQueries` and never `setQueryData`; tenant A receives no event caused only in B; focus/reconnect refetch enabled.

- [ ] **Step 2: Implementar query client sem persister**

Create `query-client.ts` with a browser-only lazy `QueryClient` configured `staleTime:0`, `gcTime:5*60_000`, `refetchOnWindowFocus:true`, `refetchOnReconnect:true`, query retry 1 and mutation retry 0. Create `query-keys.ts`:

```ts
export type QueryScope = { userId: string; companyId: string | null }
export const queryKeys = {
  root: (scope: QueryScope) => ["axsys", scope.userId, scope.companyId ?? "platform"] as const,
  resource: (scope: QueryScope, resource: string, ...parts: readonly unknown[]) =>
    [...queryKeys.root(scope), resource, ...parts] as const,
}
```

`QueryProvider` owns one client per React mount and calls `client.clear()` on unmount. Do not import any TanStack persistence package.

- [ ] **Step 3: Implementar mensagens de invalidação sem registros de negócio**

Create `invalidation-channel.ts`:

```ts
export type ClientInvalidation = {
  type: "invalidate" | "session-ended"
  scope: { userId: string; companyId: string | null }
  resources: readonly string[]
  senderId: string
}

export const INVALIDATION_CHANNEL = "axsys:invalidation:v1"
export function openInvalidationChannel() {
  return new BroadcastChannel(INVALIDATION_CHANNEL)
}
```

`mutation-sync.tsx` exports `publishInvalidation(event)` and `useMutationSync(scope,queryClient)`. Receiving matching `invalidate` calls `invalidateQueries` for each `queryKeys.resource(scope,resource)`; matching `session-ended` clears and `location.replace('/login')`; mismatched scope is ignored. Messages contain resource names only, never rows, totals, permissions or tokens.

- [ ] **Step 4: Habilitar somente tabelas-base necessárias no Realtime**

Run `npx supabase migration new foundation_realtime_signals`, then put this SQL in the CLI-generated file:

```sql
alter publication supabase_realtime add table
  public.profiles,
  public.companies,
  public.company_memberships,
  public.member_modules;
```

`ScopedProviders` subscribes through `getBrowserRealtime()` using the authenticated token. It filters by `company_id=eq.<context.companyId>` where available; profile uses `user_id=eq.<userId>`. The callback discards the payload and publishes/invokes invalidation only. Cleanup removes every channel.

- [ ] **Step 5: Confirmar RLS Realtime, duas abas e commit**

```bash
npm run db:reset
npm run db:env
npm run test:unit -- tests/unit/query/query-keys.test.ts tests/unit/query/mutation-sync.test.tsx
npm run test:integration -- tests/integration/realtime/cross-tenant-signal.test.ts
npm run test:e2e -- tests/e2e/theme/theme.spec.ts
npm run lint
npm run typecheck
git add src/lib/query src/lib/realtime/invalidation-channel.ts src/components/providers/scoped-providers.tsx supabase/migrations/*_foundation_realtime_signals.sql tests/unit/query tests/integration/realtime
git commit -m "feat: synchronize authorized query invalidation"
```

Expected: mutação aparece na segunda aba sem reload; B não acorda cache de A; nenhum payload Realtime vira dado de tela.

### Task 17: Testes adversariais IDOR/cache, documentação local e gate final

**Files:**
- Create: `tests/integration/security/idor-matrix.test.ts`
- Create: `tests/integration/security/cache-headers.test.ts`
- Create: `tests/e2e/security/session-storage.spec.ts`
- Create: `tests/e2e/security/cross-tenant.spec.ts`
- Create: `tests/e2e/cache/two-tabs.spec.ts`
- Create: `docs/local-development.md`

- [ ] **Step 1: Criar a matriz IDOR RED contra handlers reais**

In `idor-matrix.test.ts`, authenticate each actor and issue these requests with valid Origin/CSRF unless the row explicitly attacks them:

| Ator | Ataque | Resultado obrigatório |
|---|---|---|
| A admin | reset temporário de B user por UUID | 404 genérico; B inalterado |
| A member | reset temporário de A user | 403 |
| A admin | body login/theme com `companyId` B | 422 por objeto strict |
| A user | query `?companyId=<B>` em `/api/auth/me` | resposta continua A |
| Platform | `/api/auth/me` | sem membership/módulos empresariais |
| Visitor | GET/POST protegido com UUID válido | 401, sem confirmar existência |
| Qualquer | mutation sem CSRF | 403 `CSRF_INVALID` |
| Qualquer | mutation com Origin externa | 403 `ORIGIN_INVALID` |
| Login | conta conhecida vs desconhecida | mesmo status/código/mensagem |

Run the file before final adjustments. Any unexpected success, differentiated existence response or tenant B mutation is RED and blocks completion.

- [ ] **Step 2: Testar headers contra cache compartilhado**

`cache-headers.test.ts` requests login error/success, CSRF, me, theme, logout, password change, forgot and reset; each must include the exact no-store directives and `Vary: Cookie, Authorization`. Assert no authenticated handler exports `revalidate`, `dynamic='force-static'`, `'use cache'`, `unstable_cache` or `cache:'force-cache'`.

- [ ] **Step 3: Testar browser storage, cookies e troca A → B**

`session-storage.spec.ts` logs in and asserts: no localStorage/sessionStorage key or value matches `/supabase|jwt|access.?token|refresh.?token|session/i`; theme is the only allowed `axsys-theme:<userId>` key; Supabase cookies are Secure+HttpOnly+SameSite=Lax; CSRF is Secure+HttpOnly+SameSite=Strict; logout removes Auth/CSRF cookies and clears query state.

`cross-tenant.spec.ts` performs direct URL attempts between A/B and portal role attempts, then confirms no B name/ID appears in A DOM, network JSON or console. After A logout, log in as B in the same page and assert no A content remains.

`two-tabs.spec.ts` opens two pages in one context, changes theme/profile in tab 1 and observes tab 2 update through invalidation/refetch without `page.reload()`. Revoke the membership with the admin fixture and assert both tabs leave protected routes; no optimistic permission display remains.

- [ ] **Step 4: Corrigir somente por RED–GREEN e executar a matriz completa**

For every failing case, add the smallest reproducing assertion first, observe it fail for the expected authorization/cache reason, then adjust the relevant handler/guard/policy and rerun the focused test. Do not weaken an assertion, add a Super Admin operational policy or return tenant-specific denial detail.

Run:

```bash
npm run db:reset
npm run db:env
npm run test:rls
npm run test:integration -- tests/integration/security/idor-matrix.test.ts tests/integration/security/cache-headers.test.ts
npm run test:e2e -- tests/e2e/security/session-storage.spec.ts tests/e2e/security/cross-tenant.spec.ts tests/e2e/cache/two-tabs.spec.ts
```

Expected: all PASS; zero cross-tenant record/event/cache leakage; no manual reload.

- [ ] **Step 5: Documentar o ambiente reproduzível e gates de produção**

Create `docs/local-development.md` with these exact sections and commands:

```markdown
# Desenvolvimento local do Axsys

## Pré-requisitos
Node 24.13.0, npm 11.6.2, Docker com pelo menos 7 GiB disponíveis.

## Primeira execução
`npm ci`
`npm run db:start`
`npm run db:env`
Preencha somente as variáveis `AXSYS_BOOTSTRAP_*` em `.env.local`.
`npm run bootstrap:local`
`npm run dev`

App: http://127.0.0.1:3000
Studio: http://127.0.0.1:54323
Mailpit: http://127.0.0.1:54324

## Reset e tipos
`npm run db:reset && npm run db:env`
`npm run db:types`

## Testes
`npm run test:unit`
`npm run test:integration`
`npm run test:rls`
`npm run test:e2e`
`npm run test:all`

## Regras de migration
Crie arquivos somente com `npx supabase migration new <nome>` e valide com reset, pgTAP, lint e advisors.

## Gate antes de hospedagem pública
Bloqueado até MFA obrigatório para Super Admin, TLS, SMTP real, política de privacidade/retenção/descarte, backup/restauração, rotação de segredos, SAST/DAST, secret scanning, auditoria de dependências e pentest independente.
```

- [ ] **Step 6: Executar scans mecânicos de segredo, cache e browser Data API**

Run:

```bash
rg 'SUPABASE_SECRET_KEY|BFF_DATABASE_URL|DATABASE_URL|CSRF_SECRET|SECURITY_HASH_PEPPER' src --glob '!lib/env/server.ts'
rg '\.(from|rpc)\(' src --glob '*.tsx' --glob '*browser*.ts'
rg "use cache|unstable_cache|force-cache|persistQueryClient|createSyncStoragePersister|serviceWorker" src
rg 'dangerouslySetInnerHTML|document\.write' src
npm audit --audit-level=high
npm run db:lint
npm run db:advisors
npx supabase migration list --local
```

Expected: first scan finds no secret references outside the validated server env and server-only adapters; browser Data API, persistent cache, unsafe HTML and Service Worker scans return no matches; npm has no unresolved high/critical advisory; migrations are internally consistent.

- [ ] **Step 7: Executar verificação integral limpa**

Run:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:rls
npm run test:e2e
npm run build
git diff --check
git status --short
```

Expected: todos os comandos exit 0, nenhum warning, nenhuma alteração gerada não revisada, e o status mostra somente arquivos deliberados desta entrega.

- [ ] **Step 8: Commit final da fundação**

```bash
git add tests/integration/security tests/e2e/security tests/e2e/cache docs/local-development.md
git commit -m "test: verify foundation security boundaries"
```

## Critérios de conclusão desta entrega

- [ ] `next@16.2.10`, React 19.2.7, npm e todas as dependências compartilhadas estão pinadas no lockfile.
- [ ] Marca compacta/horizontal/monocromática deriva de `/Users/gabrielmachado/Downloads/axsys.png` via imagegen, sem geometria inventada; Geist e Phosphor são usados conforme contrato.
- [ ] Supabase CLI 2.109.1 sobe Auth/Postgres/Realtime/Mailpit e reconstrói o banco somente pelas migrations do CLI.
- [ ] `axsys_bff` é LOGIN sem BYPASSRLS/CRUD e executa apenas funções `private.*` explicitamente concedidas.
- [ ] Perfis, papéis, empresas, memberships, módulos, auditoria, segurança e idempotência possuem constraints, índices, grants mínimos e RLS default-deny.
- [ ] `getClaims()` protege identidade; cookies são Secure/HttpOnly/SameSite; nenhuma sessão/token fica no localStorage.
- [ ] Login é neutro, rate-limited e redireciona pelo papel do banco; senha provisória expira em 24h e bloqueia todos os portais até troca.
- [ ] Recovery por e-mail passa pelo Mailpit local, é de uso único e revoga sessões anteriores.
- [ ] Toda mutation exige Origin e CSRF; toda resposta sensível é no-store; nenhuma mudança de negócio ocorre por GET.
- [ ] `/platform` e `/app` são separados no menu, rota, BFF e RLS; Super Admin não lê memberships/módulos operacionais.
- [ ] Query keys incluem user/tenant; mutação invalida leituras afetadas; BroadcastChannel e Realtime carregam somente sinais.
- [ ] Matriz pgTAP/API/UI prova isolamento A/B, IDOR, CSRF, rate limit, revogação, troca A→B e ausência de cache compartilhado.
