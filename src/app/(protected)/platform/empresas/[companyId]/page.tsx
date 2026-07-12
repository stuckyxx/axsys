import { notFound } from "next/navigation"

import { bffDb } from "@/lib/db/bff"
import { z } from "@/lib/validation/zod"
import { requirePlatformContext } from "@/modules/auth/server/guards"
import { CompanyDetail } from "@/modules/platform/ui/company-detail"

export const dynamic = "force-dynamic"

export default async function CompanyDetailPage({ params }: { params: Promise<{ companyId: string }> }) {
  const context = await requirePlatformContext()
  const parsed = z.uuid().safeParse((await params).companyId)
  if (!parsed.success) notFound()
  let detail
  try {
    detail = await bffDb.getCompanyDetail({ actorUserId: context.userId, sessionId: context.sessionId, companyId: parsed.data })
  } catch {
    notFound()
  }
  return <CompanyDetail detail={detail} />
}
