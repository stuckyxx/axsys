import { requireCompanyContext } from "@/modules/auth/server/guards"
import { ProposalForm } from "@/modules/proposals/ui/proposal-form"

export const dynamic = "force-dynamic"

export default async function NewAdministrativeProposalPage() {
  const context = await requireCompanyContext("administrative")

  return (
    <div className="space-y-6 pb-10">
      <header className="border-b border-border pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Administrativo · Propostas</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Nova proposta</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">Combine serviços e produtos, confira a prévia e salve o total validado pelo banco.</p>
      </header>
      <ProposalForm companyId={context.companyId} userId={context.userId} />
    </div>
  )
}
