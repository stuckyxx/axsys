import {
  CheckCircleIcon,
  DatabaseIcon,
  HardDrivesIcon,
  ShieldWarningIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr"

import type { PlatformHealth } from "@/modules/platform/server/platform-health"

const SERVICES = [
  ["database", "Banco de dados", DatabaseIcon],
  ["auth", "Autenticação", ShieldWarningIcon],
  ["storage", "Armazenamento", HardDrivesIcon],
] as const

function bytes(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(value / 1_048_576)
}

export function PlatformHealthPanel({ health }: Readonly<{ health: PlatformHealth }>) {
  return (
    <div className="space-y-8">
      <section aria-label="Dependências" className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
        {SERVICES.map(([key, label, Icon]) => {
          const healthy = health[key] === "healthy"
          return <div className="bg-card p-5" data-testid={`health-${key}`} key={key}><div className="flex items-center justify-between gap-3"><Icon aria-hidden className="size-5 text-muted-foreground" weight="duotone" />{healthy ? <CheckCircleIcon aria-hidden className="size-4 text-emerald-500" weight="fill" /> : <WarningCircleIcon aria-hidden className="size-4 text-amber-500" weight="fill" />}</div><p className="mt-6 text-sm font-medium">{label}</p><p className={`mt-1 text-xs ${healthy ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{healthy ? "Saudável" : "Degradado"}</p></div>
        })}
      </section>

      <section aria-labelledby="health-backlog-title">
        <div className="flex flex-col gap-2 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-semibold" id="health-backlog-title">Pendências operacionais</h2><p className="mt-1 text-sm text-muted-foreground">Indicadores agregados, sem expor dados dos fornecedores.</p></div><time className="font-mono text-xs text-muted-foreground" dateTime={health.checkedAt}>Atualizado {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(health.checkedAt))}</time></div>
        <div className="grid gap-x-8 sm:grid-cols-2">
          <p className="border-b border-border py-4 text-sm"><strong className="font-mono text-lg">{health.pendingCompensations}</strong><span className="ml-2 text-muted-foreground">compensações pendentes</span></p>
          <p className="border-b border-border py-4 text-sm"><strong className="font-mono text-lg">{health.pendingFileCleanup}</strong><span className="ml-2 text-muted-foreground">limpezas de arquivo</span></p>
          <p className="border-b border-border py-4 text-sm"><strong className="font-mono text-lg">{health.scanFailures}</strong><span className="ml-2 text-muted-foreground">falhas de verificação</span></p>
          <p className="border-b border-border py-4 text-sm"><strong className="font-mono text-lg">{health.quotaDriftAlerts}</strong><span className="ml-2 text-muted-foreground">alertas de divergência</span></p>
          <p className="border-b border-border py-4 text-sm"><strong className="font-mono text-lg">{health.companiesNearQuota}</strong><span className="ml-2 text-muted-foreground">empresas próximas da cota</span></p>
          <p className="border-b border-border py-4 text-sm"><strong className="font-mono text-lg">{bytes(health.storageBytes)}</strong><span className="ml-2 text-muted-foreground">usados + {bytes(health.reservedStorageBytes)} reservados</span></p>
        </div>
      </section>
    </div>
  )
}
