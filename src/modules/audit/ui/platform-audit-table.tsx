import Link from "next/link"
import {
  CheckCircleIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react/dist/ssr"

import type { PlatformAuditEventSnapshot } from "@/lib/db/bff"

type Props = Readonly<{
  events: PlatformAuditEventSnapshot[]
  nextCursor: string | null
  filters?: Readonly<{
    action?: string
    resourceType?: string
    outcome?: string
  }>
}>

const OUTCOME = {
  success: { label: "Sucesso", icon: CheckCircleIcon, className: "text-emerald-600 dark:text-emerald-400" },
  denied: { label: "Negado", icon: WarningCircleIcon, className: "text-amber-600 dark:text-amber-400" },
  failure: { label: "Falha", icon: XCircleIcon, className: "text-destructive" },
} as const

function EventOutcome({ outcome }: Pick<PlatformAuditEventSnapshot, "outcome">) {
  const config = OUTCOME[outcome]
  const Icon = config.icon
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${config.className}`}>
      <Icon aria-hidden className="size-4" weight="fill" />
      {config.label}
    </span>
  )
}

function timestamp(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Fortaleza",
  }).format(new Date(value))
}

function Metadata({ value }: Readonly<{ value: Record<string, unknown> }>) {
  const entries = Object.entries(value)
  if (entries.length === 0) return <span className="text-muted-foreground">Sem metadados</span>
  return (
    <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {entries.map(([key, content]) => (
        <div className="inline-flex gap-1" key={key}>
          <dt>{key}:</dt>
          <dd className="font-mono text-foreground">{String(content)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function PlatformAuditTable({ events, nextCursor, filters = {} }: Props) {
  if (events.length === 0) {
    return (
      <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-border px-5 text-center">
        <div>
          <p className="font-medium text-foreground">Nenhum evento encontrado</p>
          <p className="mt-2 text-sm text-muted-foreground">Ajuste os filtros ou aguarde novas ações administrativas.</p>
        </div>
      </div>
    )
  }

  const next = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value) next.set(key, value)
  if (nextCursor) next.set("cursor", nextCursor)

  return (
    <div className="space-y-5">
      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-[0.12em] text-muted-foreground">
            <tr><th className="px-5 py-4 font-medium">Horário</th><th className="px-5 py-4 font-medium">Ação</th><th className="px-5 py-4 font-medium">Recurso</th><th className="px-5 py-4 font-medium">Resultado</th></tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {events.map((event) => (
              <tr key={event.id}>
                <td className="px-5 py-4 align-top font-mono text-xs text-muted-foreground">{timestamp(event.occurredAt)}</td>
                <td className="px-5 py-4 align-top"><p className="font-mono text-xs font-semibold text-foreground">{event.action}</p><Metadata value={event.metadata} /></td>
                <td className="px-5 py-4 align-top"><p>{event.resourceType}</p><p className="mt-1 max-w-40 truncate font-mono text-xs text-muted-foreground" title={event.resourceId ?? undefined}>{event.resourceId ?? "—"}</p></td>
                <td className="px-5 py-4 align-top"><EventOutcome outcome={event.outcome} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card md:hidden">
        {events.map((event) => (
          <article className="space-y-4 p-5" key={event.id}>
            <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-xs font-semibold">{event.action}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{timestamp(event.occurredAt)}</p></div><EventOutcome outcome={event.outcome} /></div>
            <div><p className="text-xs font-medium text-muted-foreground">{event.resourceType}</p><p className="mt-1 truncate font-mono text-xs">{event.resourceId ?? "Sem identificador"}</p></div>
            <Metadata value={event.metadata} />
          </article>
        ))}
      </div>

      {nextCursor ? <div className="flex justify-end"><Link className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-medium transition-colors hover:bg-muted active:translate-y-px" href={`/platform/auditoria?${next.toString()}`} prefetch={false}>Próxima página</Link></div> : null}
    </div>
  )
}
