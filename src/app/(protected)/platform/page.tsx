import { requirePlatformContext } from "@/modules/auth/server/guards"
import { getPlatformDashboard } from "@/modules/platform/server/platform-repository"
import { PlatformDashboard } from "@/modules/platform/ui/platform-dashboard"

export const dynamic = "force-dynamic"

export default async function PlatformPage() {
  const context = await requirePlatformContext()
  const dashboard = await getPlatformDashboard({
    userId: context.userId,
    sessionId: context.sessionId,
  })
  return <PlatformDashboard dashboard={dashboard} />
}
