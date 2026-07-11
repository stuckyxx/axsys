"use client"

import { WarningCircleIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"

type PortalErrorProps = Readonly<{
  error: Error & { digest?: string }
  reset: () => void
}>

const SAFE_REFERENCE = /^[A-Za-z0-9_-]{1,64}$/u

export function PortalError({ error, reset }: PortalErrorProps) {
  const reference =
    typeof error.digest === "string" && SAFE_REFERENCE.test(error.digest)
      ? error.digest
      : null

  return (
    <section
      className="mx-auto mt-8 max-w-2xl border-t border-destructive/50 pt-8 sm:mt-12"
      role="alert"
    >
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <WarningCircleIcon aria-hidden className="size-5" weight="bold" />
        </span>
        <div className="min-w-0 space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Não foi possível carregar esta área.
            </h2>
            <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-muted-foreground">
              Tente novamente. Se o problema continuar, informe o horário da tentativa ao suporte.
            </p>
            {reference ? (
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                Referência: {reference}
              </p>
            ) : null}
          </div>
          <Button className="min-h-11" onClick={reset} type="button">
            Tentar novamente
          </Button>
        </div>
      </div>
    </section>
  )
}
