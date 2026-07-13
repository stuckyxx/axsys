import { notFound } from "next/navigation"

import { z } from "@/lib/validation/zod"
import { getClientDetail } from "@/modules/administrative/server/client-service"
import { ClientDetail } from "@/modules/administrative/ui/client-detail"
import { requireCompanyContext } from "@/modules/auth/server/guards"

export const dynamic = "force-dynamic"

export default async function AdministrativeClientDetailPage({
  params,
}: Readonly<{ params: Promise<{ clientId: string }> }>) {
  const context = await requireCompanyContext("administrative")
  const parsed = z.uuid().safeParse((await params).clientId)
  if (!parsed.success) notFound()

  let detail
  try {
    detail = await getClientDetail({ context, clientId: parsed.data })
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "CLIENT_NOT_FOUND"
    ) {
      notFound()
    }
    throw error
  }
  return <ClientDetail detail={detail} />
}
