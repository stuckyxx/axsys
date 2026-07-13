import {
  ArchiveBoxIcon,
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  DotsThreeVerticalIcon,
  NotePencilIcon,
  PackageIcon,
  TrashIcon,
  WrenchIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { CatalogListItemDTO } from "@/modules/administrative/server/catalog-item-repository"

type CatalogCardProps = Readonly<{
  disabled: boolean
  item: CatalogListItemDTO
  onArchive: (item: CatalogListItemDTO) => void
  onDelete: (item: CatalogListItemDTO) => void
  onEdit: (item: CatalogListItemDTO) => void
  onRestore: (item: CatalogListItemDTO) => void
}>

export function CatalogCard({
  disabled,
  item,
  onArchive,
  onDelete,
  onEdit,
  onRestore,
}: CatalogCardProps) {
  const archived = item.archivedAt !== null
  const KindIcon = item.itemKind === "service" ? WrenchIcon : PackageIcon
  return (
    <article className="rounded-2xl border border-border bg-card p-5 shadow-[0_14px_36px_-28px_hsl(var(--foreground)/0.45)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <KindIcon aria-hidden className="size-4" />
            {item.itemKind === "service" ? "Serviço" : "Produto"} · {item.segment}
          </p>
          <h2 className="mt-2 text-base font-semibold tracking-tight">{item.name}</h2>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium">
          {archived ? (
            <ArchiveBoxIcon aria-hidden className="size-4" />
          ) : (
            <CheckCircleIcon aria-hidden className="size-4 text-emerald-600 dark:text-emerald-400" />
          )}
          {archived ? "Arquivado" : "Ativo"}
        </span>
      </div>
      <p className="mt-4 line-clamp-3 text-sm leading-6 text-muted-foreground">
        {item.description}
      </p>
      <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
        {item.proposalCount} {item.proposalCount === 1 ? "proposta vinculada" : "propostas vinculadas"}
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          aria-label={`Editar ${item.name}`}
          className="min-h-11"
          disabled={disabled}
          onClick={() => onEdit(item)}
          type="button"
          variant="ghost"
        >
          <NotePencilIcon aria-hidden />
          Editar
        </Button>
        <Button
          aria-label={`${archived ? "Restaurar" : "Arquivar"} ${item.name}`}
          className="min-h-11"
          disabled={disabled}
          onClick={() => (archived ? onRestore(item) : onArchive(item))}
          type="button"
          variant="outline"
        >
          {archived ? <ArrowCounterClockwiseIcon aria-hidden /> : <ArchiveBoxIcon aria-hidden />}
          {archived ? "Restaurar" : "Arquivar"}
        </Button>
        <CatalogDangerMenu disabled={disabled} item={item} onDelete={onDelete} />
      </div>
    </article>
  )
}

export function CatalogDangerMenu({
  disabled,
  item,
  onDelete,
}: Readonly<{
  disabled: boolean
  item: CatalogListItemDTO
  onDelete: (item: CatalogListItemDTO) => void
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Abrir ações perigosas de ${item.name}`}
          className="size-11"
          disabled={disabled}
          size="icon"
          type="button"
          variant="ghost"
        >
          <DotsThreeVerticalIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem
          aria-label={`Excluir ${item.name}`}
          className="min-h-11"
          onSelect={() => onDelete(item)}
          variant="destructive"
        >
          <TrashIcon aria-hidden />
          Excluir definitivamente
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
