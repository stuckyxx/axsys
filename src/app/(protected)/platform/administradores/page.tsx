import Link from "next/link"
import { z } from "@/lib/validation/zod"
import { requirePlatformContext } from "@/modules/auth/server/guards"
import { listPlatformAdmins } from "@/modules/platform/server/platform-repository"

export const dynamic = "force-dynamic"

const querySchema = z.object({
  search: z.string().trim().min(2).max(100).optional(),
  cursor: z.string().max(512).optional(),
}).strict()

export default async function PlatformAdministratorsPage({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>
}>) {
  const context = await requirePlatformContext()
  const query = await searchParams
  const filters = querySchema.parse({
    search: typeof query.search === "string" && query.search.trim() ? query.search : undefined,
    cursor: typeof query.cursor === "string" && query.cursor ? query.cursor : undefined,
  })
  const result = await listPlatformAdmins(
    { userId: context.userId, sessionId: context.sessionId },
    { ...filters, limit: 50 },
  )
  const next = new URLSearchParams()
  if (filters.search) next.set("search", filters.search)
  if (result.nextCursor) next.set("cursor", result.nextCursor)

  return <section className="space-y-6" aria-labelledby="platform-admins-title"><header className="grid gap-5 border-b border-border/70 pb-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><div><p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Acessos</p><h1 className="mt-2 text-3xl font-semibold tracking-tight" id="platform-admins-title">Administradores</h1><p className="mt-2 text-sm text-muted-foreground">Diretório global paginado, sem enumerar empresas individualmente.</p></div><form action="/platform/administradores" className="flex gap-2" method="get"><label className="sr-only" htmlFor="admin-search">Buscar administrador</label><input className="min-h-11 min-w-0 rounded-xl border border-input bg-background px-3 text-sm" defaultValue={filters.search} id="admin-search" maxLength={100} name="search" placeholder="Nome, e-mail ou empresa" /><button className="min-h-11 rounded-xl border border-border px-4 text-sm font-medium active:translate-y-px" type="submit">Buscar</button></form></header>{result.items.length === 0 ? <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed text-sm text-muted-foreground">Nenhum administrador encontrado.</div> : <div className="divide-y divide-border/70 overflow-hidden rounded-2xl border bg-card">{result.items.map((admin) => <Link className="grid gap-2 p-5 transition-colors hover:bg-muted/40 active:bg-muted/60 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.7fr)_auto] sm:items-center" href={`/platform/empresas/${admin.companyId}`} key={admin.membershipId} prefetch={false}><div><p className="font-medium">{admin.displayName}</p><p className="mt-1 text-sm text-muted-foreground">{admin.email}</p></div><p className="text-sm text-muted-foreground">{admin.companyLegalName}</p><span className="w-fit rounded-full border px-2.5 py-1 text-xs">{admin.accessState === "active" ? "Ativo" : "Atenção"}</span></Link>)}</div>}{result.nextCursor ? <div className="flex justify-end"><Link className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-medium active:translate-y-px" href={`/platform/administradores?${next.toString()}`} prefetch={false}>Próxima página</Link></div> : null}</section>
}
