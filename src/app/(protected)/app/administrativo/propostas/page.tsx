import { requireCompanyContext } from "@/modules/auth/server/guards"
import { listProposals } from "@/modules/proposals/server/proposal-service"
import { ProposalListClient } from "@/modules/proposals/ui/proposal-list-client"

export const dynamic = "force-dynamic"

export default async function AdministrativeProposalsPage() {
  const context = await requireCompanyContext("administrative")
  const initial = await listProposals({ context, limit: 25 })

  return (
    <ProposalListClient
      companyId={context.companyId}
      initialItems={initial.items}
      initialNextCursor={initial.nextCursor}
      userId={context.userId}
    />
  )
}
