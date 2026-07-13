import { listCatalogItems } from "@/modules/administrative/server/catalog-item-service"
import { CatalogListClient } from "@/modules/administrative/ui/catalog-list-client"
import { requireCompanyContext } from "@/modules/auth/server/guards"

export const dynamic = "force-dynamic"

export default async function AdministrativeCatalogPage() {
  const context = await requireCompanyContext("administrative")
  const initial = await listCatalogItems({
    context,
    archived: false,
    limit: 25,
  })

  return (
    <CatalogListClient
      companyId={context.companyId}
      initialItems={initial.items}
      initialNextCursor={initial.nextCursor}
      userId={context.userId}
    />
  )
}
