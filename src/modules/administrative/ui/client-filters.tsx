import { ArchiveBoxIcon, FunnelIcon, XIcon } from "@phosphor-icons/react"

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

export type ClientFiltersValue = Readonly<{
  archived: boolean
  q: string
  segment: string
}>

type ClientFiltersProps = Readonly<{
  onChange: (filters: ClientFiltersValue) => void
  value: ClientFiltersValue
}>

export function ClientFilters({ onChange, value }: ClientFiltersProps) {
  const clear = () => onChange({ archived: false, q: "", segment: "" })
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="client-search">Buscar clientes</Label>
          <Input
            className="min-h-11"
            id="client-search"
            maxLength={160}
            onChange={(event) => onChange({ ...value, q: event.target.value })}
            placeholder="Razão social, nome fantasia ou CNPJ"
            type="search"
            value={value.q}
          />
        </div>
        <div className="hidden items-end gap-3 sm:flex">
          <div className="space-y-2">
            <Label htmlFor="client-segment">Segmento</Label>
            <Input
              className="min-h-11 w-48"
              id="client-segment"
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
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button className="min-h-11 sm:hidden" type="button" variant="outline">
              <FunnelIcon aria-hidden />
              Filtros
            </Button>
          </SheetTrigger>
          <SheetContent className="flex h-dvh w-full flex-col sm:max-w-md" side="right">
            <SheetHeader>
              <SheetTitle>Filtrar clientes</SheetTitle>
              <SheetDescription>Restrinja a lista por segmento e situação.</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
              <div className="space-y-2">
                <Label htmlFor="client-segment-mobile">Segmento</Label>
                <Input
                  className="min-h-11"
                  id="client-segment-mobile"
                  maxLength={80}
                  onChange={(event) => onChange({ ...value, segment: event.target.value })}
                  value={value.segment}
                />
              </div>
              <Button
                aria-pressed={value.archived}
                className="min-h-11 w-full"
                onClick={() => onChange({ ...value, archived: !value.archived })}
                type="button"
                variant={value.archived ? "secondary" : "outline"}
              >
                <ArchiveBoxIcon aria-hidden />
                {value.archived ? "Mostrar ativos" : "Mostrar arquivados"}
              </Button>
            </div>
            <div className="border-t border-border p-4">
              <SheetClose asChild>
                <Button className="min-h-11 w-full" type="button">Aplicar filtros</Button>
              </SheetClose>
            </div>
          </SheetContent>
        </Sheet>
      </div>
      {value.q || value.segment || value.archived ? (
        <div aria-label="Filtros ativos" className="flex flex-wrap items-center gap-2">
          {value.q ? <FilterChip label={`Busca: ${value.q}`} onRemove={() => onChange({ ...value, q: "" })} /> : null}
          {value.segment ? <FilterChip label={`Segmento: ${value.segment}`} onRemove={() => onChange({ ...value, segment: "" })} /> : null}
          {value.archived ? <FilterChip label="Arquivados" onRemove={() => onChange({ ...value, archived: false })} /> : null}
          <Button className="min-h-11" onClick={clear} size="sm" type="button" variant="ghost">
            Limpar tudo
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function FilterChip({ label, onRemove }: Readonly<{ label: string; onRemove: () => void }>) {
  return (
    <span className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-secondary px-3 text-xs font-medium">
      {label}
      <button
        aria-label={`Remover ${label}`}
        className="grid size-8 place-items-center rounded-full hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onRemove}
        type="button"
      >
        <XIcon aria-hidden className="size-4" />
      </button>
    </span>
  )
}
