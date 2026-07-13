import {
  ArrowLeftIcon,
  FileTextIcon,
  HandshakeIcon,
  MapPinIcon,
} from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import type { ClientDetailDTO } from "@/modules/administrative/server/client-repository"

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

function money(value: string): string {
  return brl.format(Number(value))
}

export function ClientDetail({ detail }: Readonly<{ detail: ClientDetailDTO }>) {
  const { client, aggregates } = detail
  return (
    <div className="space-y-8">
      <div>
        <Button asChild className="min-h-11" variant="ghost">
          <Link href="/app/administrativo/clientes">
            <ArrowLeftIcon aria-hidden />
            Voltar para clientes
          </Link>
        </Button>
      </div>
      <header className="grid gap-6 border-b border-border pb-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{client.segment}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{client.legalName}</h1>
          {client.tradeName ? <p className="mt-2 text-base text-muted-foreground">{client.tradeName}</p> : null}
          <p className="mt-4 flex items-center gap-2 text-sm"><MapPinIcon aria-hidden className="text-muted-foreground" />{client.address.municipality}/{client.address.state}</p>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border">
          <div className="bg-card px-5 py-4"><p className="text-xs text-muted-foreground">CNPJ</p><p className="mt-1 font-mono text-sm">{client.cnpj}</p></div>
          <div className="bg-card px-5 py-4"><p className="text-xs text-muted-foreground">Situação</p><p className="mt-1 text-sm font-medium">{client.archivedAt ? "Arquivado" : "Ativo"}</p></div>
        </div>
      </header>

      <section aria-labelledby="client-aggregates-title">
        <h2 className="text-xl font-semibold tracking-tight" id="client-aggregates-title">Resumo de vínculos</h2>
        <div className="mt-4 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
          <Aggregate icon={<FileTextIcon aria-hidden />} label="Propostas" count={aggregates.proposalCount} total={aggregates.proposalTotal} />
          <Aggregate icon={<HandshakeIcon aria-hidden />} label="Contratos" count={aggregates.contractCount} total={aggregates.contractTotal} />
        </div>
      </section>

      <div className="grid gap-8 xl:grid-cols-2">
        <RecentList
          empty="Nenhuma proposta vinculada."
          items={detail.recentProposals.map((proposal) => ({
            id: proposal.id,
            label: `Proposta ${proposal.number}`,
            meta: `${proposal.issuedOn} · ${money(proposal.total)}`,
          }))}
          title="Propostas recentes"
        />
        <RecentList
          empty="Nenhum contrato vinculado."
          items={detail.recentContracts.map((contract) => ({
            id: contract.id,
            label: contract.number,
            meta: `${contract.endsOn} · ${money(contract.amount)}`,
          }))}
          title="Contratos recentes"
        />
      </div>
    </div>
  )
}

function Aggregate({ count, icon, label, total }: Readonly<{ count: number; icon: React.ReactNode; label: string; total: string }>) {
  return (
    <div className="bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</div>
      <p className="mt-4 text-2xl font-semibold tracking-tight">{money(total)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{count} {count === 1 ? "registro" : "registros"}</p>
    </div>
  )
}

function RecentList({ empty, items, title }: Readonly<{
  empty: string
  items: readonly Readonly<{ id: string; label: string; meta: string }>[]
  title: string
}>) {
  return (
    <section aria-labelledby={`${title.replaceAll(" ", "-")}-title`}>
      <h2 className="text-xl font-semibold tracking-tight" id={`${title.replaceAll(" ", "-")}-title`}>{title}</h2>
      {items.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">{empty}</p> : (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-card">
          {items.map((item) => <li className="px-5 py-4" key={item.id}><p className="font-medium">{item.label}</p><p className="mt-1 text-xs text-muted-foreground">{item.meta}</p></li>)}
        </ul>
      )}
    </section>
  )
}
