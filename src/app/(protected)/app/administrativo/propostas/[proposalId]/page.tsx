import { notFound } from "next/navigation"

import { z } from "@/lib/validation/zod"
import { requireCompanyContext } from "@/modules/auth/server/guards"
import { listProposalDocuments } from "@/modules/documents/server/proposal-pdf-service"
import { getProposalDetail } from "@/modules/proposals/server/proposal-service"
import { ProposalDetail } from "@/modules/proposals/ui/proposal-detail"

export const dynamic = "force-dynamic"

export default async function AdministrativeProposalDetailPage({
  params,
}: Readonly<{ params: Promise<{ proposalId: string }> }>) {
  const context = await requireCompanyContext("administrative")
  const parsed = z.uuid().safeParse((await params).proposalId)
  if (!parsed.success) notFound()

  let result
  try {
    result = await Promise.all([
      getProposalDetail({ context, proposalId: parsed.data }),
      listProposalDocuments({ context, proposalId: parsed.data }),
    ])
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "PROPOSAL_NOT_FOUND") notFound()
    throw error
  }
  const [detail, documents] = result
  return <ProposalDetail companyId={context.companyId} initialDetail={detail} initialDocuments={documents} userId={context.userId} />
}
