"use client"

import { ArrowClockwiseIcon, DownloadSimpleIcon, FilePdfIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import type { ProposalDocumentSummary } from "@/modules/documents/server/generated-document-repository"

type Props = Readonly<{
  documents: readonly ProposalDocumentSummary[]
  onDocumentsChange: (documents: readonly ProposalDocumentSummary[]) => void
  proposalId: string
}>

type ErrorEnvelope = Readonly<{ error?: Readonly<{ message?: string }> }>

async function csrfToken(): Promise<string> {
  const response = await fetch("/api/auth/csrf", {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  })
  if (!response.ok) throw new Error("csrf")
  const body = (await response.json()) as { token?: unknown }
  if (typeof body.token !== "string") throw new Error("csrf")
  return body.token
}

export function ProposalDocumentHistory({ documents, onDocumentsChange, proposalId }: Props) {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function generate() {
    if (pending) return
    setPending(true)
    setMessage(null)
    try {
      const token = await csrfToken()
      const response = await fetch(`/api/administrative/proposals/${proposalId}/documents`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-csrf-token": token },
      })
      const body = (await response.json()) as ErrorEnvelope
      if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível gerar o PDF.")
      const refreshed = await fetch(`/api/administrative/proposals/${proposalId}/documents`, {
        cache: "no-store",
        credentials: "same-origin",
      })
      if (!refreshed.ok) throw new Error("O PDF foi gerado, mas o histórico não pôde ser atualizado.")
      onDocumentsChange((await refreshed.json()) as readonly ProposalDocumentSummary[])
      setMessage("PDF gerado e armazenado com sucesso.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível gerar o PDF. Tente novamente.")
    } finally {
      setPending(false)
    }
  }

  return (
    <section aria-labelledby="proposal-documents-title" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Documentos imutáveis</p>
          <h2 className="mt-2 text-xl font-semibold" id="proposal-documents-title">Histórico de PDFs</h2>
          <p className="mt-1 text-sm text-muted-foreground">Cada geração preserva uma versão auditável da proposta.</p>
        </div>
        <Button className="min-h-11 gap-2" disabled={pending} onClick={generate} type="button">
          {pending ? <ArrowClockwiseIcon className="animate-spin" size={18} /> : <FilePdfIcon size={18} />}
          {pending ? "Gerando…" : "Gerar PDF"}
        </Button>
      </div>

      <p aria-live="polite" className="mt-4 min-h-5 text-sm text-muted-foreground" role="status">{message}</p>

      {documents.length === 0 ? (
        <div className="mt-2 rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum PDF gerado. Gere a primeira versão antes de enviar a proposta.
        </div>
      ) : (
        <ol className="mt-2 divide-y divide-border" reversed>
          {documents.map((document) => (
            <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" key={document.documentId}>
              <div className="min-w-0">
                <p className="font-medium">Versão {document.version}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(document.createdAt))}
                  {" · SHA-256 "}<span className="font-mono">{document.checksumSha256.slice(0, 12)}…</span>
                </p>
              </div>
              <Button asChild className="min-h-11 shrink-0 gap-2" variant="outline">
                <a download href={`/api/administrative/proposals/${proposalId}/documents/${document.documentId}/download`}>
                  <DownloadSimpleIcon size={18} /> Baixar versão {document.version}
                </a>
              </Button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
