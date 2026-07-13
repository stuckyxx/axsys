"use client"

import {
  ArchiveBoxIcon,
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  NotePencilIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { Button } from "@/components/ui/button"
import {
  getMutationSenderId,
  publishInvalidation,
  useMutationSync,
} from "@/lib/query/mutation-sync"
import {
  AdministrativeEmptyState,
  AdministrativeErrorState,
  AdministrativeNoResultsState,
} from "@/modules/administrative/ui/administrative-screen-states"
import { ClientCard } from "@/modules/administrative/ui/client-card"
import { ClientFilters, type ClientFiltersValue } from "@/modules/administrative/ui/client-filters"
import { ClientFormSheet } from "@/modules/administrative/ui/client-form-sheet"
import type {
  ClientDTO,
  ClientListItemDTO,
} from "@/modules/administrative/server/client-repository"

type ClientListClientProps = Readonly<{
  companyId: string
  initialItems: readonly ClientListItemDTO[]
  initialNextCursor: string | null
  userId: string
}>

type ErrorEnvelope = Readonly<{ error?: Readonly<{ code?: string; message?: string }> }>

const INITIAL_FILTERS: ClientFiltersValue = { archived: false, q: "", segment: "" }

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

export function ClientListClient({
  companyId,
  initialItems,
  initialNextCursor,
  userId,
}: ClientListClientProps) {
  const [items, setItems] = useState<readonly ClientListItemDTO[]>(initialItems)
  const [nextCursor, setNextCursor] = useState(initialNextCursor)
  const [filters, setFilters] = useState<ClientFiltersValue>(INITIAL_FILTERS)
  const [formClient, setFormClient] = useState<ClientDTO | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [senderId] = useState(getMutationSenderId)
  const firstFilterRun = useRef(true)
  const listRequest = useRef<AbortController | null>(null)
  const queryClient = useQueryClient()
  const scope = useMemo(
    () => Object.freeze({ companyId, userId }),
    [companyId, userId],
  )

  const load = useCallback(async (
    activeFilters = filters,
    cursor?: string | null,
    append = false,
  ) => {
    listRequest.current?.abort()
    const controller = new AbortController()
    listRequest.current = controller
    setLoading(true)
    setFailed(false)
    try {
      const query = new URLSearchParams({
        archived: String(activeFilters.archived),
        limit: "25",
      })
      if (activeFilters.q.trim()) query.set("q", activeFilters.q.trim())
      if (activeFilters.segment.trim()) query.set("segment", activeFilters.segment.trim())
      if (cursor) query.set("cursor", cursor)
      const response = await fetch(`/api/administrative/clients?${query}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      })
      if (!response.ok) throw new Error("list")
      const body = (await response.json()) as {
        items: readonly ClientListItemDTO[]
        nextCursor: string | null
      }
      setItems((current) => (append ? [...current, ...body.items] : body.items))
      setNextCursor(body.nextCursor)
    } catch {
      if (!controller.signal.aborted) setFailed(true)
    } finally {
      if (listRequest.current === controller) {
        listRequest.current = null
        setLoading(false)
      }
    }
  }, [filters])

  const refreshFromSignal = useCallback(() => {
    void load(filters)
  }, [filters, load])

  useMutationSync(scope, queryClient, {
    onInvalidate: refreshFromSignal,
    senderId,
  })

  useEffect(() => {
    if (firstFilterRun.current) {
      firstFilterRun.current = false
      return
    }
    const timeout = window.setTimeout(() => void load(filters), 250)
    return () => window.clearTimeout(timeout)
  }, [filters, load])

  useEffect(() => () => listRequest.current?.abort(), [])

  function publish(resources: readonly string[]) {
    publishInvalidation({
      resources: [...resources],
      scope,
      senderId,
      type: "invalidate",
    })
  }

  function openCreate() {
    setFormClient(null)
    setFormOpen(true)
  }

  function openEdit(client: ClientListItemDTO) {
    setFormClient(client)
    setFormOpen(true)
  }

  function saved(record: ClientDTO, created: boolean) {
    setItems((current) => {
      const previous = current.find(({ id }) => id === record.id)
      const item: ClientListItemDTO = {
        ...record,
        proposalCount: previous?.proposalCount ?? 0,
        contractCount: previous?.contractCount ?? 0,
      }
      return created ? [item, ...current] : current.map((entry) => entry.id === item.id ? item : entry)
    })
    setMessage(created ? "Cliente criado." : "Cliente atualizado.")
    publish(["clients", "proposals", "contracts", "dashboard"])
  }

  async function lifecycle(client: ClientListItemDTO, action: "archive" | "restore" | "delete") {
    if (pendingId) return
    if (action === "delete" && !window.confirm(`Excluir ${client.legalName}? Esta ação não pode ser desfeita.`)) return
    const controller = new AbortController()
    setPendingId(client.id)
    setMessage(null)
    try {
      const token = await csrfToken(controller.signal)
      const suffix = action === "delete" ? "" : `/${action}`
      const response = await fetch(`/api/administrative/clients/${client.id}${suffix}`, {
        method: action === "delete" ? "DELETE" : "POST",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-csrf-token": token,
        },
        body: JSON.stringify({ version: client.version }),
      })
      if (!response.ok) {
        const body = (await response.json()) as ErrorEnvelope
        setMessage(body.error?.message ?? "Não foi possível atualizar o cliente.")
        return
      }
      if (action === "delete") {
        setItems((current) => current.filter(({ id }) => id !== client.id))
        setMessage("Cliente excluído.")
        publish(["clients", "proposals", "contracts", "dashboard"])
        return
      }
      const body = (await response.json()) as { record: ClientDTO }
      const updated: ClientListItemDTO = {
        ...body.record,
        proposalCount: client.proposalCount,
        contractCount: client.contractCount,
      }
      if (action === "archive" && !filters.archived) {
        setItems((current) => current.filter(({ id }) => id !== client.id))
      } else if (action === "restore" && filters.archived) {
        setItems((current) => current.filter(({ id }) => id !== client.id))
      } else {
        setItems((current) => current.map((entry) => entry.id === client.id ? updated : entry))
      }
      setMessage(action === "archive" ? "Cliente arquivado." : "Cliente restaurado.")
      publish(["clients", "proposals", "contracts", "dashboard"])
    } catch {
      setMessage("Não foi possível atualizar o cliente. Verifique a conexão.")
    } finally {
      setPendingId(null)
    }
  }

  const filtered = filters.q.trim() !== "" || filters.segment.trim() !== "" || filters.archived
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Administrativo</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Clientes</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Cadastros, vínculos e situação dos órgãos atendidos pela empresa.
          </p>
        </div>
        <Button className="min-h-11 shrink-0" onClick={openCreate} type="button">
          <PlusIcon aria-hidden />
          Novo cliente
        </Button>
      </div>

      <ClientFilters onChange={setFilters} value={filters} />
      <div aria-live="polite" className="min-h-5 text-sm">
        {message ? <p role={message.startsWith("Não") ? "alert" : "status"}>{message}</p> : null}
        {loading ? <p className="text-muted-foreground" role="status">Atualizando lista...</p> : null}
      </div>

      {failed ? <AdministrativeErrorState onRetry={() => void load()} /> : items.length === 0 && !filtered ? (
        <AdministrativeEmptyState onCreate={openCreate} />
      ) : items.length === 0 ? (
        <AdministrativeNoResultsState onClear={() => setFilters(INITIAL_FILTERS)} />
      ) : (
        <>
          <div className="grid gap-4 lg:hidden">
            {items.map((client) => (
              <ClientCard
                client={client}
                disabled={pendingId !== null}
                key={client.id}
                onArchive={(entry) => void lifecycle(entry, "archive")}
                onDelete={(entry) => void lifecycle(entry, "delete")}
                onEdit={openEdit}
                onRestore={(entry) => void lifecycle(entry, "restore")}
              />
            ))}
          </div>
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-card lg:block">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <caption className="sr-only">Clientes cadastrados</caption>
              <thead className="border-b border-border bg-muted/50 text-xs uppercase tracking-[0.1em] text-muted-foreground">
                <tr>
                  <th className="w-[27%] px-5 py-4 font-medium" scope="col">Cliente</th>
                  <th className="w-[17%] px-4 py-4 font-medium" scope="col">CNPJ</th>
                  <th className="w-[15%] px-4 py-4 font-medium" scope="col">Segmento</th>
                  <th className="w-[14%] px-4 py-4 font-medium" scope="col">Município</th>
                  <th className="w-[10%] px-4 py-4 font-medium" scope="col">Vínculos</th>
                  <th className="w-[9%] px-4 py-4 font-medium" scope="col">Estado</th>
                  <th className="w-[8%] px-4 py-4 text-right font-medium" scope="col">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((client) => <ClientRow client={client} disabled={pendingId !== null} key={client.id} onArchive={(entry) => void lifecycle(entry, "archive")} onDelete={(entry) => void lifecycle(entry, "delete")} onEdit={openEdit} onRestore={(entry) => void lifecycle(entry, "restore")} />)}
              </tbody>
            </table>
          </div>
          {nextCursor ? (
            <div className="flex justify-center">
              <Button className="min-h-11" disabled={loading} onClick={() => void load(filters, nextCursor, true)} type="button" variant="outline">Carregar mais</Button>
            </div>
          ) : null}
        </>
      )}

      {formOpen ? (
        <ClientFormSheet
          client={formClient}
          onClose={() => setFormOpen(false)}
          onSaved={saved}
          open
        />
      ) : null}
    </div>
  )
}

type RowProps = Readonly<{
  client: ClientListItemDTO
  disabled: boolean
  onArchive: (client: ClientListItemDTO) => void
  onDelete: (client: ClientListItemDTO) => void
  onEdit: (client: ClientListItemDTO) => void
  onRestore: (client: ClientListItemDTO) => void
}>

function ClientRow({ client, disabled, onArchive, onDelete, onEdit, onRestore }: RowProps) {
  const archived = client.archivedAt !== null
  return (
    <tr className="align-middle hover:bg-muted/25">
      <td className="px-5 py-4"><Link className="font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/app/administrativo/clientes/${client.id}`}>{client.legalName}</Link>{client.tradeName ? <p className="mt-1 truncate text-xs text-muted-foreground">{client.tradeName}</p> : null}</td>
      <td className="px-4 py-4 font-mono text-xs">{client.cnpj}</td>
      <td className="truncate px-4 py-4">{client.segment}</td>
      <td className="px-4 py-4">{client.address.municipality}/{client.address.state}</td>
      <td className="px-4 py-4">{client.proposalCount} / {client.contractCount}</td>
      <td className="px-4 py-4"><span className="inline-flex items-center gap-1.5">{archived ? <ArchiveBoxIcon aria-hidden /> : <CheckCircleIcon aria-hidden className="text-emerald-600 dark:text-emerald-400" />}{archived ? "Arquivado" : "Ativo"}</span></td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-1">
          <Button aria-label={`Editar ${client.legalName}`} className="size-11" disabled={disabled} onClick={() => onEdit(client)} size="icon" title="Editar" type="button" variant="ghost"><NotePencilIcon aria-hidden /></Button>
          <Button aria-label={`${archived ? "Restaurar" : "Arquivar"} ${client.legalName}`} className="size-11" disabled={disabled} onClick={() => archived ? onRestore(client) : onArchive(client)} size="icon" title={archived ? "Restaurar" : "Arquivar"} type="button" variant="ghost">{archived ? <ArrowCounterClockwiseIcon aria-hidden /> : <ArchiveBoxIcon aria-hidden />}</Button>
          <Button aria-label={`Excluir ${client.legalName}`} className="size-11 text-destructive hover:text-destructive" disabled={disabled || client.proposalCount > 0 || client.contractCount > 0} onClick={() => onDelete(client)} size="icon" title="Excluir" type="button" variant="ghost"><TrashIcon aria-hidden /></Button>
        </div>
      </td>
    </tr>
  )
}
