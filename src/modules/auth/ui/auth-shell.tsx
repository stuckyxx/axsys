import type { ReactNode } from "react"

import { AxsysLogo } from "@/components/brand/axsys-logo"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"

type AuthShellProps = Readonly<{
  title: ReactNode
  description: ReactNode
  children: ReactNode
}>

export function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <main className="min-h-[100dvh] bg-background px-4 py-8 text-foreground sm:px-6 sm:py-12 lg:px-10">
      <div className="mx-auto grid min-h-[calc(100dvh-4rem)] w-full max-w-6xl items-center gap-10 sm:min-h-[calc(100dvh-6rem)] lg:min-h-[calc(100dvh-6rem)] lg:grid-cols-[minmax(0,1fr)_minmax(24rem,28rem)] lg:gap-20">
        <section
          aria-label="Axsys"
          className="flex min-w-0 flex-col items-start lg:self-stretch lg:py-8"
        >
          <AxsysLogo variant="horizontal" preload className="shrink-0" />

          <div className="mt-auto hidden max-w-lg border-l border-primary/40 pl-7 lg:block">
            <p className="font-mono text-[0.68rem] font-medium tracking-[0.2em] text-primary uppercase">
              Acesso institucional
            </p>
            <p className="mt-5 text-3xl leading-[1.08] font-medium tracking-[-0.035em] text-foreground">
              Gestão pública com identidade, contexto e acesso controlados.
            </p>
            <p className="mt-5 max-w-[52ch] text-sm leading-6 text-muted-foreground">
              Entre somente com uma conta autorizada. Toda sessão é validada no
              servidor antes de liberar dados operacionais.
            </p>
          </div>

          <p className="mt-5 hidden font-mono text-[0.65rem] tracking-[0.18em] text-muted-foreground uppercase lg:block">
            Ambiente restrito · Axsys
          </p>
        </section>

        <Card className="w-full max-w-md justify-self-center gap-0 rounded-[1.35rem] bg-card/95 py-0 shadow-[0_28px_90px_-54px_oklch(0.04_0.02_252/0.9)] ring-1 ring-foreground/12 lg:justify-self-end">
          <CardHeader className="gap-3 border-b border-border/70 px-6 pt-7 pb-6 sm:px-8 sm:pt-8">
            <p className="font-mono text-[0.65rem] font-medium tracking-[0.2em] text-primary uppercase">
              Área segura
            </p>
            <h1 className="text-2xl leading-tight font-semibold tracking-[-0.025em] text-card-foreground sm:text-[1.75rem]">
              {title}
            </h1>
            <CardDescription className="max-w-[44ch] text-sm leading-6">
              {description}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 py-7 sm:px-8 sm:py-8">
            {children}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
