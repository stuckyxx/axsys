import {
  MagnifyingGlassIcon,
  PlusIcon,
  ShieldWarningIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr"

import { Button } from "@/components/ui/button"

type ActionStateProps = Readonly<{
  actionLabel: string
  description: string
  onAction: () => void
  title: string
}>

function ActionState({ actionLabel, description, onAction, title }: ActionStateProps) {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card/40 px-5 py-12 text-left sm:px-8">
      <WarningCircleIcon aria-hidden className="size-7 text-muted-foreground" weight="duotone" />
      <h2 className="mt-5 text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
      <Button className="mt-6 min-h-11" onClick={onAction} type="button" variant="outline">
        {actionLabel}
      </Button>
    </section>
  )
}

export function AdministrativeEmptyState({ onCreate }: Readonly<{ onCreate: () => void }>) {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card/40 px-5 py-12 text-left sm:px-8">
      <PlusIcon aria-hidden className="size-7 text-primary" weight="duotone" />
      <h2 className="mt-5 text-xl font-semibold tracking-tight">Cadastre o primeiro cliente</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        Organize os órgãos e entidades atendidos antes de criar propostas e contratos.
      </p>
      <Button className="mt-6 min-h-11" onClick={onCreate} type="button">
        Criar cliente
      </Button>
    </section>
  )
}

export function AdministrativeNoResultsState({ onClear }: Readonly<{ onClear: () => void }>) {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card/40 px-5 py-12 text-left sm:px-8">
      <MagnifyingGlassIcon aria-hidden className="size-7 text-muted-foreground" weight="duotone" />
      <h2 className="mt-5 text-xl font-semibold tracking-tight">Nenhum cliente encontrado</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        Revise a busca ou remova os filtros aplicados para visualizar outros registros.
      </p>
      <Button className="mt-6 min-h-11" onClick={onClear} type="button" variant="outline">
        Limpar filtros
      </Button>
    </section>
  )
}

export function AdministrativeErrorState({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <ActionState
      actionLabel="Tentar novamente"
      description="A leitura não foi concluída. Nenhuma alteração foi perdida."
      onAction={onRetry}
      title="Não foi possível carregar os clientes"
    />
  )
}

export function AdministrativeDeniedState() {
  return (
    <section className="rounded-2xl border border-border bg-card/40 px-5 py-12 sm:px-8">
      <ShieldWarningIcon aria-hidden className="size-7 text-muted-foreground" weight="duotone" />
      <h2 className="mt-5 text-xl font-semibold tracking-tight">Acesso não autorizado</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        Seu acesso atual não inclui o módulo Administrativo.
      </p>
    </section>
  )
}

export function AdministrativeUnavailableState({ correlationId }: Readonly<{ correlationId: string }>) {
  return (
    <section className="rounded-2xl border border-border bg-card/40 px-5 py-12 sm:px-8">
      <WarningCircleIcon aria-hidden className="size-7 text-muted-foreground" weight="duotone" />
      <h2 className="mt-5 text-xl font-semibold tracking-tight">Serviço temporariamente indisponível</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        Tente novamente em instantes. Informe o código abaixo ao suporte se o problema continuar.
      </p>
      <code className="mt-5 inline-block rounded-md bg-muted px-3 py-2 font-mono text-xs">
        {correlationId}
      </code>
    </section>
  )
}
