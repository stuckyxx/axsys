"use client"

import type { FormEvent } from "react"
import { BuildingsIcon, MagnifyingGlassIcon, WarningCircleIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { CompanyListSnapshot } from "@/lib/db/bff"

type CompanyListProps = Readonly<{
  companies: readonly CompanyListSnapshot[]
  currentCursor?: string | null
  nextCursor?: string | null
  query?: string
  state?: "ready" | "no-results" | "temporarily-unavailable"
}>

function cnpj(value: string): string {
  return value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/u, "$1.$2.$3/$4-$5")
}

export function CompanyList({ companies, currentCursor = null, nextCursor = null, query = "", state = "ready" }: CompanyListProps) {
  const router = useRouter()

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get("q")
    const params = new URLSearchParams()
    if (typeof value === "string" && value.trim()) params.set("q", value.trim())
    router.push(`/platform/empresas${params.size ? `?${params}` : ""}`)
  }

  return (
    <section className="space-y-6" aria-labelledby="companies-title">
      <header className="flex flex-col gap-5 border-b border-border/70 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Diretório</p>
          <h1 id="companies-title" className="mt-2 text-3xl font-semibold tracking-tight">Empresas</h1>
          <p className="mt-2 text-sm text-muted-foreground">Cadastro, acesso e situação de cada fornecedor.</p>
        </div>
        <form className="flex w-full gap-2 md:max-w-md" onSubmit={search} role="search">
          <Input aria-label="Buscar empresas" defaultValue={query} name="q" placeholder="CNPJ, razão social ou nome" />
          <Button className="h-11 px-4" type="submit" variant="secondary"><MagnifyingGlassIcon aria-hidden />Buscar</Button>
        </form>
      </header>

      {state === "temporarily-unavailable" ? (
        <div role="alert" className="flex min-h-48 items-center gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
          <WarningCircleIcon aria-hidden className="size-8 shrink-0 text-destructive" />
          <div><h2 className="font-semibold">Não foi possível carregar as empresas</h2><p className="mt-1 text-sm text-muted-foreground">Tente novamente em instantes. Nenhum dado foi substituído por uma lista vazia.</p></div>
        </div>
      ) : companies.length === 0 ? (
        <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
          <div><BuildingsIcon aria-hidden className="mx-auto size-9 text-muted-foreground" weight="duotone" /><h2 className="mt-4 font-semibold">{state === "no-results" || query ? "Nenhuma empresa encontrada" : "Nenhuma empresa cadastrada"}</h2><p className="mt-2 text-sm text-muted-foreground">{query ? "Revise a busca ou limpe o filtro." : "Crie a primeira empresa para iniciar o diretório."}</p></div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/80 bg-card">
          <div className="divide-y divide-border/70 md:hidden">
            {companies.map((company) => <CompanyRow company={company} key={company.id} mobile />)}
          </div>
          <div className="hidden md:block">
            <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(10rem,0.8fr)_8rem_2.5rem] gap-4 border-b border-border/70 bg-muted/35 px-5 py-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground"><span>Empresa</span><span>CNPJ</span><span>Situação</span><span className="sr-only">Abrir</span></div>
            <div className="divide-y divide-border/70">{companies.map((company) => <CompanyRow company={company} key={company.id} />)}</div>
          </div>
        </div>
      )}
      {state === "ready" && (currentCursor || nextCursor) ? <nav aria-label="Paginação de empresas" className="flex items-center justify-end gap-2"><Button className="h-11" disabled={!currentCursor} onClick={() => router.back()} type="button" variant="ghost">Página anterior</Button>{nextCursor ? <Button asChild className="h-11" variant="outline"><Link href={`/platform/empresas?${new URLSearchParams({ ...(query ? { q: query } : {}), cursor: nextCursor })}`} prefetch={false}>Próxima página</Link></Button> : <Button className="h-11" disabled variant="outline">Próxima página</Button>}</nav> : null}
    </section>
  )
}

function CompanyRow({ company, mobile = false }: { company: CompanyListSnapshot; mobile?: boolean }) {
  return (
    <Link className={mobile ? "block p-5 transition-colors hover:bg-muted/50" : "grid grid-cols-[minmax(0,1.5fr)_minmax(10rem,0.8fr)_8rem_2.5rem] items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40"} href={`/platform/empresas/${company.id}`} prefetch={false}>
      <div className="min-w-0"><p className="truncate font-medium text-foreground">{company.tradeName ?? company.legalName}</p><p className="mt-1 truncate text-xs text-muted-foreground">{company.legalName}</p></div>
      <p className={mobile ? "mt-4 font-mono text-xs text-muted-foreground" : "font-mono text-xs text-muted-foreground"}>{cnpj(company.cnpj)}</p>
      <span className={mobile ? "mt-3 inline-flex rounded-full border px-2.5 py-1 text-xs" : "w-fit rounded-full border px-2.5 py-1 text-xs"}>{company.status === "active" ? "Ativa" : "Arquivada"}</span>
      <span aria-hidden className={mobile ? "sr-only" : "text-right text-muted-foreground"}>›</span>
    </Link>
  )
}
