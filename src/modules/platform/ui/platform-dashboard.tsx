import { BuildingsIcon, CheckCircleIcon, ArchiveIcon, UsersThreeIcon, BankIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import type { PlatformDashboardSnapshot } from "@/lib/db/bff"

type PlatformDashboardProps = Readonly<{
  dashboard: PlatformDashboardSnapshot
}>

const METRICS = [
  ["Empresas ativas", "activeCompanies", CheckCircleIcon],
  ["Empresas arquivadas", "archivedCompanies", ArchiveIcon],
  ["Administradores ativos", "activeAdmins", UsersThreeIcon],
  ["Usuários ativos", "activeUsers", UsersThreeIcon],
  ["Contas bancárias ativas", "activeBankAccounts", BankIcon],
] as const

export function PlatformDashboard(props: PlatformDashboardProps) {
  const { dashboard } = props
  return (
    <div className="space-y-9">
      <header className="grid gap-6 border-b border-border/70 pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.42fr)] lg:items-end">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-primary">Portal restrito</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">Visão da plataforma</h1>
          <p className="mt-3 max-w-[62ch] text-sm leading-6 text-muted-foreground sm:text-base">Acompanhe o ciclo das empresas e os acessos administrativos sem misturar dados operacionais dos fornecedores.</p>
        </div>
        <div className="flex items-center gap-3 border-l-2 border-primary/70 pl-4 text-sm text-muted-foreground">
          <BuildingsIcon aria-hidden className="size-6 shrink-0 text-primary" weight="duotone" />
          Dados consultados diretamente na origem nesta requisição.
        </div>
      </header>

      <section aria-label="Resumo da plataforma" className="grid gap-px overflow-hidden rounded-2xl border border-border/80 bg-border/80 sm:grid-cols-2 lg:grid-cols-5">
        {METRICS.map(([label, key, Icon]) => (
          <div className="bg-card p-5 sm:p-6" key={key}>
            <Icon aria-hidden className="size-5 text-primary" weight="duotone" />
            <p className="mt-7 font-mono text-3xl font-semibold tracking-tight text-foreground">{dashboard[key]}</p>
            <p className="mt-1 text-sm text-muted-foreground">{label}</p>
          </div>
        ))}
      </section>
      <section className="grid gap-4 border-t border-border pt-6 sm:grid-cols-2" aria-label="Atenções operacionais"><div className="flex items-start gap-3"><WarningCircleIcon aria-hidden className="mt-0.5 size-5 text-amber-500" weight="duotone" /><div><p className="font-mono text-xl font-semibold">{dashboard.pendingCompensations}</p><p className="text-sm text-muted-foreground">compensações pendentes</p></div></div><div><p className="font-mono text-xs text-muted-foreground">Atualizado {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(dashboard.checkedAt))}</p><p className="mt-2 text-sm text-muted-foreground">{dashboard.archivedBankAccounts} contas bancárias e {dashboard.archivedCompanies} empresas arquivadas.</p></div></section>
    </div>
  )
}
