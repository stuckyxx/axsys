"use client"

import { CheckCircleIcon, PaperPlaneTiltIcon, TrashIcon, XCircleIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import type { ProposalDTO } from "@/modules/proposals/server/proposal-repository"

type Props = Readonly<{
  hasDocuments: boolean
  onChanged: (message: string) => Promise<void>
  proposal: ProposalDTO
}>

type ErrorEnvelope = Readonly<{ error?: Readonly<{ message?: string }> }>

async function csrfToken(): Promise<string> {
  const response = await fetch("/api/auth/csrf", { cache: "no-store", credentials: "same-origin", redirect: "error" })
  if (!response.ok) throw new Error("Não foi possível validar a operação.")
  const body = (await response.json()) as { token?: unknown }
  if (typeof body.token !== "string") throw new Error("Não foi possível validar a operação.")
  return body.token
}

export function ProposalStatusActions({ hasDocuments, onChanged, proposal }: Props) {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function transition(nextStatus: "sent" | "approved" | "rejected") {
    if (pending) return
    setPending(true)
    setMessage(null)
    try {
      const token = await csrfToken()
      const response = await fetch(`/api/administrative/proposals/${proposal.id}/status`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": token },
        body: JSON.stringify({ expectedVersion: proposal.version, nextStatus }),
      })
      const body = (await response.json()) as ErrorEnvelope
      if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível atualizar a proposta.")
      const success = nextStatus === "sent" ? "Proposta enviada." : nextStatus === "approved" ? "Proposta aprovada." : "Proposta rejeitada."
      await onChanged(success)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar a proposta.")
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    if (pending || !window.confirm("Excluir esta proposta em rascunho? Esta ação não pode ser desfeita.")) return
    setPending(true)
    setMessage(null)
    try {
      const token = await csrfToken()
      const response = await fetch(`/api/administrative/proposals/${proposal.id}`, {
        method: "DELETE",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-csrf-token": token },
        body: JSON.stringify({ version: proposal.version }),
      })
      const body = response.status === 204 ? {} : (await response.json()) as ErrorEnvelope
      if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível excluir a proposta.")
      await onChanged("Proposta excluída.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível excluir a proposta.")
      setPending(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {proposal.status === "draft" ? (
          <>
            <Button className="min-h-11 gap-2" disabled={pending || !hasDocuments} onClick={() => void transition("sent")} type="button">
              <PaperPlaneTiltIcon size={18} /> Enviar proposta
            </Button>
            <Button className="min-h-11 gap-2" disabled={pending || hasDocuments} onClick={() => void remove()} type="button" variant="destructive">
              <TrashIcon size={18} /> Excluir rascunho
            </Button>
          </>
        ) : null}
        {proposal.status === "sent" ? (
          <>
            <Button className="min-h-11 gap-2" disabled={pending} onClick={() => void transition("approved")} type="button">
              <CheckCircleIcon size={18} /> Aprovar proposta
            </Button>
            <Button className="min-h-11 gap-2" disabled={pending} onClick={() => void transition("rejected")} type="button" variant="outline">
              <XCircleIcon size={18} /> Rejeitar proposta
            </Button>
          </>
        ) : null}
      </div>
      {proposal.status === "draft" && !hasDocuments ? <p className="text-xs text-muted-foreground">Gere um PDF para habilitar o envio.</p> : null}
      {proposal.status === "draft" && hasDocuments ? <p className="text-xs text-muted-foreground">A exclusão fica bloqueada após a geração de documentos.</p> : null}
      <p aria-live="assertive" className="min-h-5 text-sm text-destructive" role="alert">{message}</p>
    </div>
  )
}
