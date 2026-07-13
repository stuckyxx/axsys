import {
  CheckCircleIcon,
  ClockIcon,
  PaperPlaneTiltIcon,
  XCircleIcon,
} from "@phosphor-icons/react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import type { ProposalListItemDTO } from "@/modules/proposals/server/proposal-repository"

const currency = new Intl.NumberFormat("pt-BR", {
  currency: "BRL",
  style: "currency",
})

export const PROPOSAL_STATUS = {
  approved: { label: "Aprovada", icon: CheckCircleIcon },
  draft: { label: "Rascunho", icon: ClockIcon },
  rejected: { label: "Rejeitada", icon: XCircleIcon },
  sent: { label: "Enviada", icon: PaperPlaneTiltIcon },
} as const

export function ProposalCard({ proposal }: Readonly<{ proposal: ProposalListItemDTO }>) {
  const status = PROPOSAL_STATUS[proposal.status]
  const StatusIcon = status.icon
  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Proposta {proposal.number}</p>
          <h2 className="mt-2 font-semibold tracking-tight">{proposal.clientName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{proposal.segment}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium">
          <StatusIcon aria-hidden />{status.label}
        </span>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 border-t pt-4 text-sm">
        <div><dt className="text-xs text-muted-foreground">Emissão</dt><dd className="mt-1 font-mono text-xs">{proposal.issuedOn}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Total</dt><dd className="mt-1 font-semibold">{currency.format(Number(proposal.total))}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Itens</dt><dd className="mt-1">{proposal.itemCount}</dd></div>
      </dl>
      <Button asChild className="mt-5 min-h-11 w-full" variant="outline">
        <Link href={`/app/administrativo/propostas/${proposal.id}`}>Abrir proposta {proposal.number}</Link>
      </Button>
    </article>
  )
}
