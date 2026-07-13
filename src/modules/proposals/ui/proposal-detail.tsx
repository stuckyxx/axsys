"use client"

import { ArrowLeftIcon, CalendarBlankIcon, PencilSimpleIcon, UserIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import type { ProposalDocumentSummary } from "@/modules/documents/server/generated-document-repository"
import type { ProposalDetailDTO } from "@/modules/proposals/server/proposal-repository"
import { ProposalDocumentHistory } from "@/modules/proposals/ui/proposal-document-history"
import { ProposalForm } from "@/modules/proposals/ui/proposal-form"
import { PROPOSAL_STATUS } from "@/modules/proposals/ui/proposal-card"
import { ProposalStatusActions } from "@/modules/proposals/ui/proposal-status-actions"

type Props = Readonly<{
  companyId: string
  initialDetail: ProposalDetailDTO
  initialDocuments: readonly ProposalDocumentSummary[]
  userId: string
}>

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

export function ProposalDetail({ companyId, initialDetail, initialDocuments, userId }: Props) {
  const [detail, setDetail] = useState(initialDetail)
  const [documents, setDocuments] = useState(initialDocuments)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const router = useRouter()
  const status = PROPOSAL_STATUS[detail.proposal.status]

  async function refresh(message: string) {
    if (message === "Proposta excluída.") {
      router.replace("/app/administrativo/propostas")
      router.refresh()
      return
    }
    const [proposalResponse, documentsResponse] = await Promise.all([
      fetch(`/api/administrative/proposals/${detail.proposal.id}`, { cache: "no-store", credentials: "same-origin" }),
      fetch(`/api/administrative/proposals/${detail.proposal.id}/documents`, { cache: "no-store", credentials: "same-origin" }),
    ])
    if (!proposalResponse.ok || !documentsResponse.ok) throw new Error("A alteração foi salva, mas a tela não pôde ser atualizada.")
    setDetail((await proposalResponse.json()) as ProposalDetailDTO)
    setDocuments((await documentsResponse.json()) as readonly ProposalDocumentSummary[])
    setNotice(message)
    router.refresh()
  }

  if (editing) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Proposta #{detail.proposal.number}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Editar proposta</h1>
        </div>
        <ProposalForm companyId={companyId} initial={detail} onCancel={() => setEditing(false)} onSaved={(saved) => { setDetail(saved); setEditing(false); setNotice("Proposta atualizada.") }} userId={userId} />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-10">
      <header className="border-b border-border pb-6">
        <Button className="-ml-3 min-h-11 gap-2" onClick={() => router.push("/app/administrativo/propostas")} type="button" variant="ghost">
          <ArrowLeftIcon size={18} /> Voltar para propostas
        </Button>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Proposta #{detail.proposal.number}</p>
              <span className="inline-flex min-h-7 items-center rounded-full border border-border px-2.5 text-xs font-medium"><status.icon className="mr-1.5" size={15} />{status.label}</span>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{detail.proposal.clientName}</h1>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2"><UserIcon size={17} /> {detail.proposal.segment}</span>
              <span className="inline-flex items-center gap-2"><CalendarBlankIcon size={17} /> {new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(`${detail.proposal.issuedOn}T12:00:00`))}</span>
            </div>
          </div>
          {detail.proposal.status === "draft" ? <Button className="min-h-11 gap-2" onClick={() => setEditing(true)} type="button" variant="outline"><PencilSimpleIcon size={18} /> Editar proposta</Button> : null}
        </div>
      </header>

      <p aria-live="polite" className="min-h-5 text-sm text-primary" role="status">{notice}</p>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="proposal-items-title" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="text-xl font-semibold" id="proposal-items-title">Itens da proposta</h2>
          <ol className="mt-4 divide-y divide-border">
            {detail.items.map((item) => (
              <li className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_auto]" key={item.id}>
                <div>
                  <p className="font-medium">{item.description}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.itemKind === "service" ? `${item.months} ${item.months === 1 ? "mês" : "meses"} × ${currency.format(Number(item.monthlyAmount))}` : `${item.quantity} × ${currency.format(Number(item.unitAmount))}`}
                  </p>
                </div>
                <p className="font-semibold tabular-nums sm:text-right">{currency.format(Number(item.lineTotal))}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex items-end justify-between border-t border-border pt-5">
            <div><p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Total confirmado pelo banco</p><p className="mt-1 text-xs text-muted-foreground">Valores recalculados no servidor.</p></div>
            <p className="text-2xl font-semibold tabular-nums">{currency.format(Number(detail.proposal.total))}</p>
          </div>
        </section>

        <aside className="h-fit rounded-2xl border border-border bg-card p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Ciclo legal</p>
          <h2 className="mt-2 text-xl font-semibold">Ações da proposta</h2>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">Somente as transições válidas para o estado atual estão disponíveis.</p>
          <ProposalStatusActions hasDocuments={documents.length > 0} onChanged={refresh} proposal={detail.proposal} />
        </aside>
      </div>

      <ProposalDocumentHistory documents={documents} onDocumentsChange={(next) => { setDocuments(next); setNotice("Histórico de documentos atualizado.") }} proposalId={detail.proposal.id} />
    </div>
  )
}
