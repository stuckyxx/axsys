"use client"

import {
  ArchiveBoxIcon,
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  PackageIcon,
  PlusIcon,
  WrenchIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useQueryClient } from "@tanstack/react-query"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  getMutationSenderId,
  publishInvalidation,
  useMutationSync,
} from "@/lib/query/mutation-sync"
import { administrativeKeys } from "@/lib/query/query-keys"
import {
  AdministrativeErrorState,
} from "@/modules/administrative/ui/administrative-screen-states"
import {
  CatalogCard,
  CatalogDangerMenu,
} from "@/modules/administrative/ui/catalog-card"
import { CatalogFormSheet } from "@/modules/administrative/ui/catalog-form-sheet"
import type {
  CatalogItemDTO,
  CatalogListItemDTO,
} from "@/modules/administrative/server/catalog-item-repository"

type CatalogListClientProps = Readonly<{
  companyId: string
  initialItems: readonly CatalogListItemDTO[]
  initialNextCursor: string | null
  userId: string
}>

type CatalogFilters = Readonly<{
  archived: boolean
  itemKind: "all" | "product" | "service"
  q: string
  segment: string
}>

type ErrorEnvelope = Readonly<{
  error?: Readonly<{ code?: string; message?: string }>
}>

const INITIAL_FILTERS: CatalogFilters = {
  archived: false,
  itemKind: "all",
  q: "",
  segment: "",
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

function matches(item: CatalogItemDTO, filters: CatalogFilters): boolean {
  const archived = item.archivedAt !== null
  return (
    archived === filters.archived &&
    (filters.itemKind === "all" || item.itemKind === filters.itemKind) &&
    (!filters.segment.trim() || item.segment === filters.segment.trim()) &&
    (!filters.q.trim() ||
      item.name.toLocaleLowerCase("pt-BR").startsWith(
        filters.q.trim().toLocaleLowerCase("pt-BR"),
      ))
  )
}

export function CatalogListClient({
  companyId,
  initialItems,
  initialNextCursor,
  userId,
}: CatalogListClientProps) {
  const [items, setItems] = useState<readonly CatalogListItemDTO[]>(initialItems)
  const [nextCursor, setNextCursor] = useState(initialNextCursor)
  const [filters, setFilters] = useState<CatalogFilters>(INITIAL_FILTERS)
  const [formItem, setFormItem] = useState<CatalogItemDTO | null>(null)
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
      if (activeFilters.segment.trim()) {
        query.set("segment", activeFilters.segment.trim())
      }
      if (activeFilters.itemKind !== "all") {
        query.set("itemKind", activeFilters.itemKind)
      }
      if (cursor) query.set("cursor", cursor)
      const response = await fetch(`/api/administrative/catalog-items?${query}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      })
      if (!response.ok) throw new Error("list")
      const body = (await response.json()) as {
        items: readonly CatalogListItemDTO[]
        nextCursor: string | null
      }
      setItems((current) =>
        append ? [...current, ...body.items] : body.items,
      )
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

  function synchronize() {
    void queryClient.invalidateQueries({
      queryKey: administrativeKeys.catalog(userId, companyId),
    })
    void queryClient.invalidateQueries({
      queryKey: administrativeKeys.proposals(userId, companyId),
    })
    publishInvalidation({
      resources: ["catalog", "proposals"],
      scope,
      senderId,
      type: "invalidate",
    })
  }

  function saved(record: CatalogItemDTO, created: boolean) {
    setItems((current) => {
      const previous = current.find(({ id }) => id === record.id)
      const item: CatalogListItemDTO = {
        ...record,
        proposalCount: previous?.proposalCount ?? 0,
      }
      if (!matches(record, filters)) {
        return current.filter(({ id }) => id !== record.id)
      }
      return created
        ? [item, ...current]
        : current.map((entry) => (entry.id === item.id ? item : entry))
    })
    setMessage(created ? "Item criado." : "Item atualizado.")
    synchronize()
  }

  async function lifecycle(
    item: CatalogListItemDTO,
    action: "archive" | "delete" | "restore",
  ) {
    if (pendingId) return
    if (
      action === "delete" &&
      !window.confirm(`Excluir ${item.name}? Esta ação não pode ser desfeita.`)
    ) {
      return
    }
    const controller = new AbortController()
    setPendingId(item.id)
    setMessage(null)
    try {
      const token = await csrfToken(controller.signal)
      const suffix = action === "delete" ? "" : `/${action}`
      const response = await fetch(
        `/api/administrative/catalog-items/${item.id}${suffix}`,
        {
          method: action === "delete" ? "DELETE" : "POST",
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "x-csrf-token": token,
          },
          body: JSON.stringify({ version: item.version }),
        },
      )
      if (!response.ok) {
        const body = (await response.json()) as ErrorEnvelope
        setMessage(body.error?.message ?? "Não foi possível atualizar o item.")
        return
      }
      if (action === "delete") {
        setItems((current) => current.filter(({ id }) => id !== item.id))
        setMessage("Item excluído.")
        synchronize()
        return
      }
      const body = (await response.json()) as { record: CatalogItemDTO }
      const updated: CatalogListItemDTO = {
        ...body.record,
        proposalCount: item.proposalCount,
      }
      if (
        (action === "archive" && !filters.archived) ||
        (action === "restore" && filters.archived)
      ) {
        setItems((current) => current.filter(({ id }) => id !== item.id))
      } else {
        setItems((current) =>
          current.map((entry) => (entry.id === item.id ? updated : entry)),
        )
      }
      setMessage(action === "archive" ? "Item arquivado." : "Item restaurado.")
      synchronize()
    } catch {
      setMessage("Não foi possível atualizar o item. Verifique a conexão.")
    } finally {
      setPendingId(null)
    }
  }

  const filtered =
    filters.archived ||
    filters.itemKind !== "all" ||
    filters.q.trim() !== "" ||
    filters.segment.trim() !== ""

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Administrativo
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Serviços e produtos
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Catálogo reutilizável para compor propostas sem perder o histórico contratado.
          </p>
        </div>
        <Button
          className="min-h-11 shrink-0"
          onClick={() => {
            setFormItem(null)
            setFormOpen(true)
          }}
          type="button"
        >
          <PlusIcon aria-hidden />
          Novo item
        </Button>
      </header>

      <CatalogFilters onChange={setFilters} value={filters} />
      <div aria-live="polite" className="min-h-5 text-sm">
        {message ? (
          <p role={message.startsWith("Não") || message.includes("não pode") ? "alert" : "status"}>
            {message}
          </p>
        ) : null}
        {loading ? <p className="text-muted-foreground" role="status">Atualizando catálogo...</p> : null}
      </div>

      {failed ? (
        <AdministrativeErrorState
          description="A leitura do catálogo não foi concluída. Tente novamente sem recarregar a sessão."
          onRetry={() => void load()}
          title="Não foi possível carregar o catálogo"
        />
      ) : items.length === 0 ? (
        <CatalogEmpty
          filtered={filtered}
          onAction={() => {
            if (filtered) setFilters(INITIAL_FILTERS)
            else {
              setFormItem(null)
              setFormOpen(true)
            }
          }}
        />
      ) : (
        <>
          <div className="grid gap-4 lg:hidden">
            {items.map((item) => (
              <CatalogCard
                disabled={pendingId !== null}
                item={item}
                key={item.id}
                onArchive={(entry) => void lifecycle(entry, "archive")}
                onDelete={(entry) => void lifecycle(entry, "delete")}
                onEdit={(entry) => {
                  setFormItem(entry)
                  setFormOpen(true)
                }}
                onRestore={(entry) => void lifecycle(entry, "restore")}
              />
            ))}
          </div>
          <CatalogTable
            disabled={pendingId !== null}
            items={items}
            onArchive={(entry) => void lifecycle(entry, "archive")}
            onDelete={(entry) => void lifecycle(entry, "delete")}
            onEdit={(entry) => {
              setFormItem(entry)
              setFormOpen(true)
            }}
            onRestore={(entry) => void lifecycle(entry, "restore")}
          />
          {nextCursor ? (
            <div className="flex justify-center">
              <Button
                className="min-h-11"
                disabled={loading}
                onClick={() => void load(filters, nextCursor, true)}
                type="button"
                variant="outline"
              >
                Carregar mais
              </Button>
            </div>
          ) : null}
        </>
      )}

      {formOpen ? (
        <CatalogFormSheet
          item={formItem}
          onClose={() => setFormOpen(false)}
          onSaved={saved}
        />
      ) : null}
    </div>
  )
}

function CatalogFilters({
  onChange,
  value,
}: Readonly<{
  onChange: (filters: CatalogFilters) => void
  value: CatalogFilters
}>) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="catalog-search">Buscar no catálogo</Label>
          <Input
            className="min-h-11"
            id="catalog-search"
            maxLength={160}
            onChange={(event) => onChange({ ...value, q: event.target.value })}
            placeholder="Comece pelo nome do item"
            type="search"
            value={value.q}
          />
        </div>
        <div
          className="hidden items-end gap-3 sm:flex"
          data-testid="catalog-inline-filters"
        >
          <FilterFields idSuffix="desktop" onChange={onChange} value={value} />
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button
              aria-label="Filtros do catálogo"
              className="min-h-11 sm:hidden"
              type="button"
              variant="outline"
            >
              <FunnelIcon aria-hidden />
              Filtros
            </Button>
          </SheetTrigger>
          <SheetContent className="flex h-dvh w-full flex-col sm:max-w-md" side="right">
            <SheetHeader>
              <SheetTitle>Filtrar catálogo</SheetTitle>
              <SheetDescription>Escolha tipo, segmento e situação.</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5">
              <FilterFields idSuffix="mobile" onChange={onChange} value={value} />
            </div>
            <div className="border-t border-border p-4">
              <SheetClose asChild>
                <Button className="min-h-11 w-full" type="button">Aplicar filtros</Button>
              </SheetClose>
            </div>
          </SheetContent>
        </Sheet>
      </div>
      {filteredChips(value, onChange)}
    </div>
  )
}

function FilterFields({ idSuffix, onChange, value }: Readonly<{
  idSuffix: string
  onChange: (filters: CatalogFilters) => void
  value: CatalogFilters
}>) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`catalog-kind-${idSuffix}`}>Tipo de item</Label>
        <select
          className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm sm:w-40"
          id={`catalog-kind-${idSuffix}`}
          onChange={(event) => onChange({
            ...value,
            itemKind: event.target.value as CatalogFilters["itemKind"],
          })}
          value={value.itemKind}
        >
          <option value="all">Todos</option>
          <option value="service">Serviços</option>
          <option value="product">Produtos</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`catalog-filter-segment-${idSuffix}`}>Segmento do catálogo</Label>
        <Input
          className="min-h-11 sm:w-44"
          id={`catalog-filter-segment-${idSuffix}`}
          maxLength={80}
          onChange={(event) => onChange({ ...value, segment: event.target.value })}
          placeholder="Todos"
          value={value.segment}
        />
      </div>
      <Button
        aria-pressed={value.archived}
        className="min-h-11"
        onClick={() => onChange({ ...value, archived: !value.archived })}
        type="button"
        variant={value.archived ? "secondary" : "outline"}
      >
        <ArchiveBoxIcon aria-hidden />
        {value.archived ? "Mostrar ativos" : "Mostrar arquivados"}
      </Button>
    </>
  )
}

function filteredChips(
  value: CatalogFilters,
  onChange: (filters: CatalogFilters) => void,
) {
  const chips: Readonly<{ label: string; remove: () => void }>[] = [
    ...(value.q ? [{ label: `Busca: ${value.q}`, remove: () => onChange({ ...value, q: "" }) }] : []),
    ...(value.segment ? [{ label: `Segmento: ${value.segment}`, remove: () => onChange({ ...value, segment: "" }) }] : []),
    ...(value.itemKind !== "all" ? [{ label: value.itemKind === "service" ? "Serviços" : "Produtos", remove: () => onChange({ ...value, itemKind: "all" }) }] : []),
    ...(value.archived ? [{ label: "Arquivados", remove: () => onChange({ ...value, archived: false }) }] : []),
  ]
  if (chips.length === 0) return null
  return (
    <div aria-label="Filtros ativos do catálogo" className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <span className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-secondary px-3 text-xs font-medium" key={chip.label}>
          {chip.label}
          <button aria-label={`Remover ${chip.label}`} className="grid size-8 place-items-center rounded-full hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={chip.remove} type="button">
            <XIcon aria-hidden className="size-4" />
          </button>
        </span>
      ))}
    </div>
  )
}

type CatalogActions = Readonly<{
  disabled: boolean
  items: readonly CatalogListItemDTO[]
  onArchive: (item: CatalogListItemDTO) => void
  onDelete: (item: CatalogListItemDTO) => void
  onEdit: (item: CatalogListItemDTO) => void
  onRestore: (item: CatalogListItemDTO) => void
}>

function CatalogTable({ disabled, items, onArchive, onDelete, onEdit, onRestore }: CatalogActions) {
  return (
    <div className="hidden overflow-hidden rounded-2xl border border-border bg-card lg:block">
      <table className="w-full table-fixed border-collapse text-left text-sm">
        <caption className="sr-only">Itens cadastrados no catálogo</caption>
        <thead className="border-b border-border bg-muted/50 text-xs uppercase tracking-[0.1em] text-muted-foreground">
          <tr>
            <th className="w-[22%] px-5 py-4 font-medium" scope="col">Item</th>
            <th className="w-[13%] px-4 py-4 font-medium" scope="col">Tipo</th>
            <th className="w-[15%] px-4 py-4 font-medium" scope="col">Segmento</th>
            <th className="w-[27%] px-4 py-4 font-medium" scope="col">Descrição</th>
            <th className="w-[8%] px-4 py-4 font-medium" scope="col">Uso</th>
            <th className="w-[8%] px-4 py-4 font-medium" scope="col">Estado</th>
            <th className="w-[7%] px-4 py-4 text-right font-medium" scope="col">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item) => {
            const archived = item.archivedAt !== null
            const KindIcon = item.itemKind === "service" ? WrenchIcon : PackageIcon
            return (
              <tr className="align-middle hover:bg-muted/25" key={item.id}>
                <td className="px-5 py-4 font-medium">{item.name}</td>
                <td className="px-4 py-4"><span className="inline-flex items-center gap-1.5"><KindIcon aria-hidden />{item.itemKind === "service" ? "Serviço" : "Produto"}</span></td>
                <td className="truncate px-4 py-4">{item.segment}</td>
                <td className="px-4 py-4"><p className="line-clamp-2 text-muted-foreground">{item.description}</p></td>
                <td className="px-4 py-4">{item.proposalCount}</td>
                <td className="px-4 py-4"><span className="inline-flex items-center gap-1.5">{archived ? <ArchiveBoxIcon aria-hidden /> : <CheckCircleIcon aria-hidden className="text-emerald-600 dark:text-emerald-400" />}{archived ? "Arquivado" : "Ativo"}</span></td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button aria-label={`Editar ${item.name}`} className="size-11" disabled={disabled} onClick={() => onEdit(item)} size="icon" title="Editar" type="button" variant="ghost"><NotePencilIcon aria-hidden /></Button>
                    <Button aria-label={`${archived ? "Restaurar" : "Arquivar"} ${item.name}`} className="size-11" disabled={disabled} onClick={() => archived ? onRestore(item) : onArchive(item)} size="icon" title={archived ? "Restaurar" : "Arquivar"} type="button" variant="ghost">{archived ? <ArrowCounterClockwiseIcon aria-hidden /> : <ArchiveBoxIcon aria-hidden />}</Button>
                    <CatalogDangerMenu disabled={disabled} item={item} onDelete={onDelete} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CatalogEmpty({ filtered, onAction }: Readonly<{ filtered: boolean; onAction: () => void }>) {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card/40 px-5 py-12 sm:px-8">
      {filtered ? <MagnifyingGlassIcon aria-hidden className="size-7 text-muted-foreground" /> : <PlusIcon aria-hidden className="size-7 text-primary" />}
      <h2 className="mt-5 text-xl font-semibold tracking-tight">{filtered ? "Nenhum item encontrado" : "Monte seu catálogo"}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{filtered ? "Revise os filtros aplicados para localizar outros serviços ou produtos." : "Cadastre serviços e produtos para reutilizá-los na criação de propostas."}</p>
      <Button className="mt-6 min-h-11" onClick={onAction} type="button" variant={filtered ? "outline" : "default"}>{filtered ? "Limpar filtros" : "Criar primeiro item"}</Button>
    </section>
  )
}
