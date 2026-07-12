import { EnvelopeSimpleIcon, ShieldCheckIcon, UserIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"
import { redirect } from "next/navigation"

import { bffDb } from "@/lib/db/bff"
import { requireCompanyContext } from "@/modules/auth/server/guards"

export const dynamic = "force-dynamic"

const ROLE_LABEL = {
  company_admin: "Administrador",
  member: "Membro",
} as const

const MODULE_LABEL = {
  administrative: "Administrativo",
  financial: "Financeiro",
  certificates: "Certidões",
} as const

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export default async function CompanyUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[]; q?: string | string[] }>
}) {
  const context = await requireCompanyContext()
  if (context.role !== "company_admin") redirect("/app/dashboard")

  const rawSearch = await searchParams
  const rawQuery = typeof rawSearch.q === "string" ? rawSearch.q.trim() : ""
  const query = rawQuery.length > 0 && rawQuery.length <= 100 ? rawQuery : null
  const rawCursor = typeof rawSearch.cursor === "string" ? rawSearch.cursor : null
  const cursor = rawCursor !== null && UUID.test(rawCursor) ? rawCursor : null

  const users = await bffDb.listCompanyUserDirectory({
    actorUserId: context.userId,
    sessionId: context.sessionId,
    cursor,
    limit: 21,
    searchQuery: query,
  })
  const visibleUsers = users.slice(0, 20)
  const nextCursor = users.length > 20 ? visibleUsers.at(-1)?.userId ?? null : null
  const nextHref = (() => {
    if (nextCursor === null) return null
    const params = new URLSearchParams({ cursor: nextCursor })
    if (query !== null) params.set("q", query)
    return `/app/usuarios?${params.toString()}`
  })()

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-8">
      <header className="grid gap-5 border-b border-border/80 pb-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="space-y-3">
          <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-primary">
            Controle de acesso
          </p>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Usuários da empresa
            </h1>
            <p className="mt-2 max-w-[62ch] text-sm leading-6 text-muted-foreground">
              Visualize perfis, papéis e módulos concedidos. Alterações sensíveis exigem uma operação administrativa auditada.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheckIcon size={18} weight="duotone" aria-hidden="true" />
          <span>{visibleUsers.length} {visibleUsers.length === 1 ? "acesso nesta página" : "acessos nesta página"}</span>
        </div>
      </header>

      <form className="grid gap-3 sm:grid-cols-[minmax(0,26rem)_auto] sm:items-end" action="/app/usuarios" method="get">
        <div className="space-y-2">
          <label htmlFor="company-user-search" className="text-sm font-medium">
            Buscar no diretório
          </label>
          <input
            id="company-user-search"
            name="q"
            type="search"
            defaultValue={query ?? ""}
            maxLength={100}
            placeholder="Nome ou e-mail"
            className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition-transform duration-300 active:scale-[0.98]"
        >
          Buscar
        </button>
      </form>

      {visibleUsers.length === 0 ? (
        <section className="border-l-2 border-primary/70 py-3 pl-5">
          <h2 className="font-medium">Nenhum acesso encontrado</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Novos acessos aparecerão aqui após o provisionamento seguro.
          </p>
        </section>
      ) : (
        <section aria-label="Diretório de usuários" className="divide-y divide-border/75 border-y border-border/80">
          {visibleUsers.map((user) => (
            <article
              key={user.userId}
              className="grid gap-4 py-5 transition-colors duration-300 hover:bg-muted/20 md:grid-cols-[minmax(13rem,1.1fr)_minmax(10rem,.65fr)_minmax(14rem,1fr)] md:items-center md:px-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card text-muted-foreground">
                  <UserIcon size={19} weight="duotone" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{user.displayName}</h2>
                  <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <EnvelopeSimpleIcon size={14} aria-hidden="true" />
                    <span className="truncate">{user.email}</span>
                  </p>
                </div>
              </div>

              <div>
                <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium">
                  {ROLE_LABEL[user.role]}
                </span>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {user.status === "active" ? "Acesso ativo" : "Acesso suspenso"}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {user.modules.length > 0 ? (
                  user.modules.map((module) => (
                    <span
                      key={module}
                      className="rounded-lg bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                    >
                      {MODULE_LABEL[module]}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">Sem módulos operacionais</span>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      <nav aria-label="Paginação do diretório" className="flex items-center justify-between gap-4">
        {cursor !== null ? (
          <Link href={query ? `/app/usuarios?q=${encodeURIComponent(query)}` : "/app/usuarios"} className="text-sm text-muted-foreground hover:text-foreground">
            Voltar ao início
          </Link>
        ) : <span />}
        {nextHref !== null ? (
          <Link href={nextHref} className="text-sm font-medium text-primary hover:underline">
            Próxima página
          </Link>
        ) : null}
      </nav>
    </div>
  )
}
