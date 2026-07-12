import { ShieldWarningIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"

export default function ForbiddenPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6 py-12 text-foreground">
      <section className="w-full max-w-lg border-l-2 border-primary py-4 pl-6">
        <ShieldWarningIcon
          size={28}
          weight="duotone"
          className="text-primary"
          aria-hidden="true"
        />
        <p className="mt-5 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Acesso restrito
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Você não tem permissão para acessar esta área.
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          As permissões são verificadas novamente no servidor a cada acesso.
        </p>
        <Link
          href="/app/dashboard"
          className="mt-7 inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Voltar ao painel
        </Link>
      </section>
    </main>
  )
}
