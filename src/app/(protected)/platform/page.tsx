import { CompanyCreateForm } from "@/modules/companies/ui/company-create-form"

export default function PlatformPage() {
  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-primary">
          Portal restrito
        </p>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Visão geral da plataforma
          </h1>
          <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-muted-foreground sm:text-base">
            Administração separada dos ambientes operacionais das empresas.
          </p>
        </div>
      </header>

      <section className="border-t border-border/80 pt-8" aria-labelledby="platform-foundation-title">
        <div className="border-l-2 border-primary/70 pl-5">
            <h2 id="platform-foundation-title" className="text-base font-semibold text-foreground">
              Estrutura pronta para os dados da plataforma
            </h2>
            <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
              Empresas, administradores, auditoria e saúde aparecerão aqui conforme forem cadastrados e autorizados. Nenhum dado operacional de empresa é exibido neste portal.
            </p>
        </div>
      </section>

      <CompanyCreateForm />
    </div>
  )
}
