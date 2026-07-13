import {
  ArchiveBoxIcon,
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  MapPinIcon,
  NotePencilIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import type { ClientListItemDTO } from "@/modules/administrative/server/client-repository"

type ClientCardProps = Readonly<{
  client: ClientListItemDTO
  disabled: boolean
  onArchive: (client: ClientListItemDTO) => void
  onDelete: (client: ClientListItemDTO) => void
  onEdit: (client: ClientListItemDTO) => void
  onRestore: (client: ClientListItemDTO) => void
}>

export function ClientCard({ client, disabled, onArchive, onDelete, onEdit, onRestore }: ClientCardProps) {
  const archived = client.archivedAt !== null
  return (
    <article className="rounded-2xl border border-border bg-card p-5 shadow-[0_14px_36px_-28px_hsl(var(--foreground)/0.45)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {client.segment}
          </p>
          <Link
            className="mt-2 block text-base font-semibold tracking-tight text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={`/app/administrativo/clientes/${client.id}`}
          >
            {client.legalName}
          </Link>
          {client.tradeName ? (
            <p className="mt-1 truncate text-sm text-muted-foreground">{client.tradeName}</p>
          ) : null}
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
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 text-sm">
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">Localização</dt>
          <dd className="mt-1 flex items-center gap-1.5">
            <MapPinIcon aria-hidden className="size-4 text-muted-foreground" />
            {client.address.municipality}/{client.address.state}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">CNPJ</dt>
          <dd className="mt-1 font-mono text-xs">{client.cnpj}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Vínculos</dt>
          <dd className="mt-1">{client.proposalCount} prop. · {client.contractCount} cont.</dd>
        </div>
      </dl>
      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button
          aria-label={`Editar ${client.legalName}`}
          className="min-h-11"
          disabled={disabled}
          onClick={() => onEdit(client)}
          type="button"
          variant="ghost"
        >
          <NotePencilIcon aria-hidden />
          Editar
        </Button>
        <Button
          aria-label={`${archived ? "Restaurar" : "Arquivar"} ${client.legalName}`}
          className="min-h-11"
          disabled={disabled}
          onClick={() => (archived ? onRestore(client) : onArchive(client))}
          type="button"
          variant="outline"
        >
          {archived ? <ArrowCounterClockwiseIcon aria-hidden /> : <ArchiveBoxIcon aria-hidden />}
          {archived ? "Restaurar" : "Arquivar"}
        </Button>
        <Button
          aria-label={`Excluir ${client.legalName}`}
          className="min-h-11 text-destructive hover:text-destructive"
          disabled={disabled || client.proposalCount > 0 || client.contractCount > 0}
          onClick={() => onDelete(client)}
          title={client.proposalCount > 0 || client.contractCount > 0 ? "Cliente com vínculos não pode ser excluído" : undefined}
          type="button"
          variant="ghost"
        >
          <TrashIcon aria-hidden />
          Excluir
        </Button>
      </div>
    </article>
  )
}
