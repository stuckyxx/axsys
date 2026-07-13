import { ClientListClient } from "@/modules/administrative/ui/client-list-client"
import { listClients } from "@/modules/administrative/server/client-service"
import { requireCompanyContext } from "@/modules/auth/server/guards"

export const dynamic = "force-dynamic"

export default async function AdministrativeClientsPage() {
  const context = await requireCompanyContext("administrative")
  const initial = await listClients({ context, archived: false, limit: 25 })

  return (
    <ClientListClient
      companyId={context.companyId}
      initialItems={initial.items}
      initialNextCursor={initial.nextCursor}
      userId={context.userId}
    />
  )
}
