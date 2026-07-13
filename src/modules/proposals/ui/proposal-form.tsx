"use client"

import { WarningCircleIcon } from "@phosphor-icons/react"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { FormProvider, useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  getMutationSenderId,
  publishInvalidation,
} from "@/lib/query/mutation-sync"
import { administrativeKeys, queryKeys } from "@/lib/query/query-keys"
import type { CatalogListItemDTO } from "@/modules/administrative/server/catalog-item-repository"
import type { ClientListItemDTO } from "@/modules/administrative/server/client-repository"
import type { ProposalDetailDTO } from "@/modules/proposals/server/proposal-repository"
import {
  ProposalItemsEditor,
  proposalPreviewTotal,
  type ProposalCatalogOption,
  type ProposalFormValues,
} from "@/modules/proposals/ui/proposal-items-editor"

type ProposalFormProps = Readonly<{
  companyId: string
  initial?: ProposalDetailDTO
  onCancel?: () => void
  onSaved?: (detail: ProposalDetailDTO) => void
  userId: string
}>

type ErrorEnvelope = Readonly<{
  error?: Readonly<{
    code?: string
    fieldErrors?: Readonly<Record<string, readonly string[]>>
    message?: string
  }>
}>

function initialValues(detail?: ProposalDetailDTO): ProposalFormValues {
  return {
    clientId: detail?.proposal.clientId ?? "",
    issuedOn: detail?.proposal.issuedOn ?? new Date().toISOString().slice(0, 10),
    segment: detail?.proposal.segment ?? "",
    items: detail?.items.map((item) => ({
      catalogItemId: item.catalogItemId,
      description: item.description,
      kind: item.itemKind,
      monthlyAmount: item.monthlyAmount ?? "",
      months: item.months?.toString() ?? "",
      quantity: item.quantity ?? "",
      unitAmount: item.unitAmount ?? "",
    })) ?? [],
  }
}

async function csrfToken(signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/auth/csrf", {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    signal,
  })
  if (!response.ok) throw new Error("csrf")
  const body = (await response.json()) as { token?: unknown }
  if (typeof body.token !== "string") throw new Error("csrf")
  return body.token
}

function requestLines(values: ProposalFormValues) {
  return values.items.map((item) =>
    item.kind === "service"
      ? {
          catalogItemId: item.catalogItemId,
          description: item.description,
          kind: "service" as const,
          months: Number(item.months),
          monthlyAmount: item.monthlyAmount,
        }
      : {
          catalogItemId: item.catalogItemId,
          description: item.description,
          kind: "product" as const,
          quantity: item.quantity,
          unitAmount: item.unitAmount,
        },
  )
}

export function ProposalForm({
  companyId,
  initial,
  onCancel,
  onSaved,
  userId,
}: ProposalFormProps) {
  const methods = useForm<ProposalFormValues>({ defaultValues: initialValues(initial) })
  const { handleSubmit, setError: setFormError, setValue, watch } = methods
  // React Hook Form intentionally exposes a subscription-based API that the
  // React compiler cannot memoize. These values must stay live for the editor.
  // eslint-disable-next-line react-hooks/incompatible-library
  const values = watch()
  const [segmentDraft, setSegmentDraft] = useState(values.segment)
  const [clients, setClients] = useState<readonly ClientListItemDTO[]>([])
  const [catalog, setCatalog] = useState<readonly ProposalCatalogOption[]>([])
  const [selectorsLoading, setSelectorsLoading] = useState(Boolean(initial))
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmedTotal, setConfirmedTotal] = useState<string | null>(initial?.proposal.total ?? null)
  const [conflict, setConflict] = useState<Readonly<{ current: ProposalDetailDTO; local: ProposalFormValues }> | null>(null)
  const conflictPanel = useRef<HTMLElement>(null)
  const queryClient = useQueryClient()
  const senderId = useMemo(getMutationSenderId, [])
  const scope = useMemo(() => ({ companyId, userId }), [companyId, userId])

  useEffect(() => {
    const segment = segmentDraft.trim()
    if (segment.length < 2) {
      setClients([])
      setCatalog([])
      setSelectorsLoading(false)
      return
    }
    const controller = new AbortController()
    setSelectorsLoading(true)
    const timeout = window.setTimeout(async () => {
      try {
        const encoded = encodeURIComponent(segment)
        const [clientResponse, catalogResponse] = await Promise.all([
          fetch(`/api/administrative/clients?archived=false&segment=${encoded}&limit=100`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          }),
          fetch(`/api/administrative/catalog-items?archived=false&segment=${encoded}&limit=100`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          }),
        ])
        if (!clientResponse.ok || !catalogResponse.ok) throw new Error("selectors")
        const clientBody = (await clientResponse.json()) as { items: readonly ClientListItemDTO[] }
        const catalogBody = (await catalogResponse.json()) as { items: readonly CatalogListItemDTO[] }
        setClients(clientBody.items)
        setCatalog(catalogBody.items.map(({ description, id, itemKind, name }) => ({
          description,
          id,
          itemKind,
          name,
        })))
      } catch {
        if (!controller.signal.aborted) setMessage("Não foi possível carregar clientes e catálogo deste segmento.")
      } finally {
        if (!controller.signal.aborted) setSelectorsLoading(false)
      }
    }, 250)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [segmentDraft])

  function commitSegment(currentValue: string) {
    const next = currentValue.trim()
    setSegmentDraft(next)
    if (next === values.segment) return
    // The first segment is the source used to load the current selectors, so
    // choices already made from that list are compatible and can be retained.
    if (values.segment === "") {
      setValue("segment", next, { shouldDirty: true, shouldValidate: true })
      return
    }
    const hasSelections = values.clientId !== "" || values.items.length > 0
    if (
      hasSelections &&
      !window.confirm(
        "Alterar o segmento removerá o cliente e os itens incompatíveis. Continuar?",
      )
    ) {
      setSegmentDraft(values.segment)
      return
    }
    setValue("segment", next, { shouldDirty: true, shouldValidate: true })
    setValue("clientId", "", { shouldDirty: true })
    setValue("items", [], { shouldDirty: true })
  }

  function synchronize(detail: ProposalDetailDTO) {
    void queryClient.invalidateQueries({
      queryKey: administrativeKeys.proposals(userId, companyId),
    })
    void queryClient.invalidateQueries({
      queryKey: administrativeKeys.client(userId, companyId, detail.proposal.clientId),
    })
    void queryClient.invalidateQueries({ queryKey: queryKeys.resource(scope, "dashboard") })
    publishInvalidation({
      resources: ["proposals", "clients", "dashboard"],
      scope,
      senderId,
      type: "invalidate",
    })
  }

  async function save(valuesToSave: ProposalFormValues) {
    if (pending) return
    const controller = new AbortController()
    setPending(true)
    setMessage(null)
    setConflict(null)
    try {
      const token = await csrfToken(controller.signal)
      let response: Response
      if (!initial) {
        response = await fetch("/api/administrative/proposals", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({
            clientId: valuesToSave.clientId,
            segment: valuesToSave.segment,
            issuedOn: valuesToSave.issuedOn,
            items: requestLines(valuesToSave),
          }),
          signal: controller.signal,
        })
      } else {
        const detailsResponse = await fetch(
          `/api/administrative/proposals/${initial.proposal.id}`,
          {
            method: "PATCH",
            cache: "no-store",
            credentials: "same-origin",
            headers: { "content-type": "application/json", "x-csrf-token": token },
            body: JSON.stringify({
              version: initial.proposal.version,
              clientId: valuesToSave.clientId,
              segment: valuesToSave.segment,
              issuedOn: valuesToSave.issuedOn,
            }),
            signal: controller.signal,
          },
        )
        if (!detailsResponse.ok) response = detailsResponse
        else {
          const afterDetails = (await detailsResponse.json()) as ProposalDetailDTO
          response = await fetch(`/api/administrative/proposals/${initial.proposal.id}`, {
            method: "PATCH",
            cache: "no-store",
            credentials: "same-origin",
            headers: { "content-type": "application/json", "x-csrf-token": token },
            body: JSON.stringify({
              version: afterDetails.proposal.version,
              items: requestLines(valuesToSave),
            }),
            signal: controller.signal,
          })
        }
      }
      const body = (await response.json()) as ProposalDetailDTO & ErrorEnvelope
      if (!response.ok) {
        if (response.status === 409 && body.error?.code === "VERSION_CONFLICT" && initial) {
          const currentResponse = await fetch(
            `/api/administrative/proposals/${initial.proposal.id}`,
            { cache: "no-store", credentials: "same-origin", signal: controller.signal },
          )
          if (currentResponse.ok) {
            const current = (await currentResponse.json()) as ProposalDetailDTO
            setConflict({ current, local: structuredClone(valuesToSave) })
            requestAnimationFrame(() => conflictPanel.current?.focus())
            return
          }
        }
        for (const [field, errors] of Object.entries(body.error?.fieldErrors ?? {})) {
          setFormError(field as keyof ProposalFormValues, {
            message: errors?.[0] ?? "Campo inválido.",
          })
        }
        setMessage(body.error?.message ?? "Não foi possível salvar a proposta.")
        return
      }
      setConfirmedTotal(body.proposal.total)
      setMessage("Proposta salva. Total confirmado pelo banco.")
      synchronize(body)
      if (onSaved) onSaved(body)
      else window.location.assign(`/app/administrativo/propostas/${body.proposal.id}`)
    } catch {
      setMessage("Não foi possível salvar a proposta. Verifique a conexão.")
    } finally {
      setPending(false)
    }
  }

  const preview = proposalPreviewTotal(values.items)
  return (
    <FormProvider {...methods}>
      <form className="min-h-[calc(100dvh-9rem)] space-y-7" onSubmit={handleSubmit(save)}>
        <div aria-live="polite" className="min-h-5 text-sm">
          {message ? <p role={message.startsWith("Não") ? "alert" : "status"}>{message}</p> : null}
          {selectorsLoading ? <p className="text-muted-foreground">Carregando opções do segmento...</p> : null}
        </div>
        {conflict ? (
          <section
            aria-label="Conflito de edição da proposta"
            className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
            ref={conflictPanel}
            tabIndex={-1}
          >
            <div className="flex gap-3"><WarningCircleIcon aria-hidden className="mt-0.5 text-amber-600" /><div><h2 className="font-semibold">A proposta mudou em outra sessão</h2><p className="mt-1 text-sm text-muted-foreground">Sua edição foi preservada para comparação.</p></div></div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-lg border bg-background p-3"><dt className="text-xs text-muted-foreground">Sua data</dt><dd>{conflict.local.issuedOn}</dd></div><div className="rounded-lg border bg-background p-3"><dt className="text-xs text-muted-foreground">Data atual</dt><dd>{conflict.current.proposal.issuedOn}</dd></div></dl>
          </section>
        ) : null}
        <section className="grid gap-5 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2 sm:p-6">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="proposal-segment">Segmento</Label>
            <Input
              id="proposal-segment"
              maxLength={80}
              minLength={2}
              onBlur={(event) => commitSegment(event.currentTarget.value)}
              onChange={(event) => setSegmentDraft(event.target.value)}
              required
              value={segmentDraft}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proposal-client">Cliente</Label>
            <select
              className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
              disabled={segmentDraft.trim().length < 2 || selectorsLoading}
              id="proposal-client"
              required
              value={values.clientId}
              {...methods.register("clientId", { required: "Selecione o cliente." })}
            >
              <option value="">Selecione</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.tradeName ?? client.legalName}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="proposal-issued-on">Data de emissão</Label>
            <Input id="proposal-issued-on" required type="date" {...methods.register("issuedOn", { required: true })} />
          </div>
        </section>
        <ProposalItemsEditor catalogItems={catalog} />
        <footer className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-5">
          <div>
            <p className="text-xs text-muted-foreground">{confirmedTotal ? "Total confirmado pelo banco" : "Prévia calculada"}</p>
            <p className="text-xl font-semibold">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(confirmedTotal ?? preview))}</p>
          </div>
          <div className="flex gap-2">
            {onCancel ? <Button className="min-h-11" disabled={pending} onClick={onCancel} type="button" variant="ghost">Cancelar</Button> : null}
            <Button
              className="min-h-11"
              disabled={pending || selectorsLoading}
              type="submit"
            >
              {pending ? "Salvando..." : initial ? "Salvar alterações" : "Salvar proposta"}
            </Button>
          </div>
        </footer>
      </form>
    </FormProvider>
  )
}
