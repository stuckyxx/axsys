export default function DashboardPage() {
  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-primary">
          Operação da empresa
        </p>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Dashboard
          </h1>
          <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-muted-foreground sm:text-base">
            Uma visão autorizada dos módulos ativos para sua empresa.
          </p>
        </div>
      </header>

      <section className="border-t border-border/80 pt-8" aria-labelledby="dashboard-foundation-title">
        <div className="border-l-2 border-primary/70 pl-5">
            <h2 id="dashboard-foundation-title" className="text-base font-semibold text-foreground">
              Indicadores aguardando dados operacionais
            </h2>
            <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
              Os indicadores serão calculados somente a partir de registros reais dos módulos autorizados. Este estado não apresenta valores de demonstração.
            </p>
        </div>
      </section>
    </div>
  )
}
