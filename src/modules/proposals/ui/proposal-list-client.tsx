"use client"

import { FileTextIcon, FunnelIcon, PlusIcon, XIcon } from "@phosphor-icons/react"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

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
import { getMutationSenderId, useMutationSync } from "@/lib/query/mutation-sync"
import { ProposalCard, PROPOSAL_STATUS } from "@/modules/proposals/ui/proposal-card"
import type { ProposalListItemDTO } from "@/modules/proposals/server/proposal-repository"

type Filters = Readonly<{
  q: string
  segment: string
  status: "all" | "approved" | "draft" | "rejected" | "sent"
}>

const INITIAL_FILTERS: Filters = { q: "", segment: "", status: "all" }

export function ProposalListClient({
  companyId,
  initialItems,
  initialNextCursor,
  userId,
}: Readonly<{
  companyId: string
  initialItems: readonly ProposalListItemDTO[]
  initialNextCursor: string | null
  userId: string
}>) {
  const [items, setItems] = useState(initialItems)
  const [nextCursor, setNextCursor] = useState(initialNextCursor)
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const first = useRef(true)
  const request = useRef<AbortController | null>(null)
  const queryClient = useQueryClient()
  const [senderId] = useState(getMutationSenderId)
  const scope = useMemo(() => ({ companyId, userId }), [companyId, userId])

  const load = useCallback(async (active = filters, cursor?: string | null, append = false) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setFailed(false)
    try {
      const query = new URLSearchParams({ limit: "25" })
      if (active.q.trim()) query.set("q", active.q.trim())
      if (active.segment.trim()) query.set("segment", active.segment.trim())
      if (active.status !== "all") query.set("status", active.status)
      if (cursor) query.set("cursor", cursor)
      const response = await fetch(`/api/administrative/proposals?${query}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      })
      if (!response.ok) throw new Error("list")
      const body = (await response.json()) as {
        items: readonly ProposalListItemDTO[]
        nextCursor: string | null
      }
      setItems((current) => append ? [...current, ...body.items] : body.items)
      setNextCursor(body.nextCursor)
    } catch {
      if (!controller.signal.aborted) setFailed(true)
    } finally {
      if (request.current === controller) {
        request.current = null
        setLoading(false)
      }
    }
  }, [filters])

  const refresh = useCallback(() => void load(filters), [filters, load])
  useMutationSync(scope, queryClient, { onInvalidate: refresh, senderId })

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const timeout = window.setTimeout(() => void load(filters), 250)
    return () => window.clearTimeout(timeout)
  }, [filters, load])
  useEffect(() => () => request.current?.abort(), [])

  const filtered = filters.q !== "" || filters.segment !== "" || filters.status !== "all"
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Administrativo</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Propostas</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Crie, documente e acompanhe o ciclo legal das propostas comerciais.</p></div>
        <Button asChild className="min-h-11"><Link href="/app/administrativo/propostas/nova"><PlusIcon aria-hidden />Nova proposta</Link></Button>
      </header>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-2"><Label htmlFor="proposal-search">Buscar propostas</Label><Input id="proposal-search" onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Número ou cliente" type="search" value={filters.q} /></div>
        <div className="hidden gap-3 sm:flex"><ProposalFilterFields filters={filters} setFilters={setFilters} suffix="desktop" /></div>
        <Sheet><SheetTrigger asChild><Button aria-label="Filtros de propostas" className="min-h-11 sm:hidden" variant="outline"><FunnelIcon aria-hidden />Filtros</Button></SheetTrigger><SheetContent className="flex h-dvh flex-col" side="right"><SheetHeader><SheetTitle>Filtrar propostas</SheetTitle><SheetDescription>Restrinja por estado e segmento.</SheetDescription></SheetHeader><div className="flex-1 space-y-5 overflow-y-auto px-4 py-5"><ProposalFilterFields filters={filters} setFilters={setFilters} suffix="mobile" /></div><div className="border-t p-4"><SheetClose asChild><Button className="min-h-11 w-full">Aplicar filtros</Button></SheetClose></div></SheetContent></Sheet>
      </div>
      {filtered ? <div aria-label="Filtros ativos" className="flex flex-wrap gap-2"><button className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-secondary px-3 text-xs" onClick={() => setFilters(INITIAL_FILTERS)} type="button">Limpar filtros<XIcon aria-hidden /></button></div> : null}
      <div aria-live="polite" className="min-h-5 text-sm">{loading ? <p>Atualizando propostas...</p> : null}</div>
      {failed ? <ProposalState title="Não foi possível carregar as propostas" action="Tentar novamente" onAction={() => void load()} /> : items.length === 0 ? <ProposalState title={filtered ? "Nenhuma proposta encontrada" : "Crie a primeira proposta"} action={filtered ? "Limpar filtros" : "Nova proposta"} href={filtered ? undefined : "/app/administrativo/propostas/nova"} onAction={filtered ? () => setFilters(INITIAL_FILTERS) : undefined} /> : <>
        <div className="grid gap-4 lg:hidden">{items.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} />)}</div>
        <div className="hidden overflow-hidden rounded-2xl border bg-card lg:block"><table className="w-full table-fixed text-left text-sm"><caption className="sr-only">Propostas comerciais</caption><thead className="border-b bg-muted/50 text-xs uppercase tracking-[0.1em] text-muted-foreground"><tr><th className="px-5 py-4">Número</th><th className="px-4 py-4">Cliente</th><th className="px-4 py-4">Segmento</th><th className="px-4 py-4">Emissão</th><th className="px-4 py-4">Total</th><th className="px-4 py-4">Estado</th><th className="px-4 py-4 text-right">Ação</th></tr></thead><tbody className="divide-y">{items.map((proposal) => { const status = PROPOSAL_STATUS[proposal.status]; const Icon = status.icon; return <tr key={proposal.id}><td className="px-5 py-4 font-mono">{proposal.number}</td><td className="px-4 py-4 font-medium">{proposal.clientName}</td><td className="px-4 py-4">{proposal.segment}</td><td className="px-4 py-4 font-mono text-xs">{proposal.issuedOn}</td><td className="px-4 py-4">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(proposal.total))}</td><td className="px-4 py-4"><span className="inline-flex items-center gap-1.5"><Icon aria-hidden />{status.label}</span></td><td className="px-4 py-3 text-right"><Button asChild className="min-h-11" variant="ghost"><Link href={`/app/administrativo/propostas/${proposal.id}`}>Abrir</Link></Button></td></tr> })}</tbody></table></div>
        {nextCursor ? <div className="flex justify-center"><Button className="min-h-11" disabled={loading} onClick={() => void load(filters, nextCursor, true)} variant="outline">Carregar mais</Button></div> : null}
      </>}
    </div>
  )
}

function ProposalFilterFields({ filters, setFilters, suffix }: Readonly<{ filters: Filters; setFilters: (filters: Filters) => void; suffix: string }>) {
  return <><div className="space-y-2"><Label htmlFor={`proposal-status-${suffix}`}>Estado</Label><select className="min-h-11 rounded-lg border bg-background px-3 text-sm" id={`proposal-status-${suffix}`} onChange={(event) => setFilters({ ...filters, status: event.target.value as Filters["status"] })} value={filters.status}><option value="all">Todos</option><option value="draft">Rascunhos</option><option value="sent">Enviadas</option><option value="approved">Aprovadas</option><option value="rejected">Rejeitadas</option></select></div><div className="space-y-2"><Label htmlFor={`proposal-segment-${suffix}`}>Segmento</Label><Input id={`proposal-segment-${suffix}`} onChange={(event) => setFilters({ ...filters, segment: event.target.value })} value={filters.segment} /></div></>
}

function ProposalState({ action, href, onAction, title }: Readonly<{ action: string; href?: string; onAction?: () => void; title: string }>) {
  return <section className="rounded-2xl border border-dashed p-8"><FileTextIcon aria-hidden className="size-7 text-muted-foreground" /><h2 className="mt-4 text-xl font-semibold">{title}</h2>{href ? <Button asChild className="mt-5 min-h-11"><Link href={href}>{action}</Link></Button> : <Button className="mt-5 min-h-11" onClick={onAction}>{action}</Button>}</section>
}
