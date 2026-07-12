import { z } from "@/lib/validation/zod"
import { requirePlatformContext } from "@/modules/auth/server/guards"
import { listPlatformAuditEvents } from "@/modules/audit/server/list-platform-audit-events"
import { PlatformAuditTable } from "@/modules/audit/ui/platform-audit-table"

export const dynamic = "force-dynamic"

const filtersSchema = z.object({
  action: z.string().max(128).optional(),
  resourceType: z.string().max(64).optional(),
  outcome: z.enum(["success", "denied", "failure"]).optional(),
  cursor: z.string().max(512).optional(),
}).strict()

export default async function PlatformAuditPage({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>
}>) {
  const context = await requirePlatformContext()
  const query = await searchParams
  const filters = filtersSchema.parse({
    action: typeof query.action === "string" && query.action ? query.action : undefined,
    resourceType: typeof query.resourceType === "string" && query.resourceType ? query.resourceType : undefined,
    outcome: typeof query.outcome === "string" && query.outcome ? query.outcome : undefined,
    cursor: typeof query.cursor === "string" && query.cursor ? query.cursor : undefined,
  })
  const result = await listPlatformAuditEvents(
    { userId: context.userId, sessionId: context.sessionId },
    { ...filters, limit: 25 },
  )
  return (
    <section className="space-y-7" aria-labelledby="platform-audit-title">
      <header className="grid gap-5 border-b border-border/70 pb-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div><p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-primary">Rastreabilidade</p><h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl" id="platform-audit-title">Auditoria da plataforma</h1><p className="mt-3 max-w-[62ch] text-sm leading-6 text-muted-foreground">Ações administrativas registradas na origem, com filtros e paginação por cursor.</p></div>
      </header>
      <form action="/platform/auditoria" className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-4" method="get">
        <label className="grid gap-2 text-xs font-medium">Ação<input className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm" defaultValue={filters.action} maxLength={128} name="action" placeholder="company.updated" /></label>
        <label className="grid gap-2 text-xs font-medium">Recurso<input className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm" defaultValue={filters.resourceType} maxLength={64} name="resourceType" placeholder="company" /></label>
        <label className="grid gap-2 text-xs font-medium">Resultado<select className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm" defaultValue={filters.outcome ?? ""} name="outcome"><option value="">Todos</option><option value="success">Sucesso</option><option value="denied">Negado</option><option value="failure">Falha</option></select></label>
        <button className="min-h-11 self-end rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform active:translate-y-px" type="submit">Aplicar filtros</button>
      </form>
      <PlatformAuditTable events={result.items} filters={filters} nextCursor={result.nextCursor} />
    </section>
  )
}
