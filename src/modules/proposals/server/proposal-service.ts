import "server-only"

import { bffDb } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import { canTransitionProposal } from "@/modules/proposals/domain/proposal-status"
import {
  proposalCreateSchema,
  proposalDraftUpdateSchema,
  type ProposalCreateInput,
  type ProposalDraftUpdateInput,
} from "@/modules/proposals/schemas/proposal-input"
import {
  createProposalRecord,
  deleteProposalRecord,
  getProposalDetail as readProposalDetail,
  listProposalSelectors as readProposalSelectors,
  listProposals as readProposals,
  proposalHasDocuments,
  replaceProposalItems,
  transitionProposalRecord,
  updateProposalDetails,
} from "@/modules/proposals/server/proposal-repository"

type CompanyContext = Extract<AccessContext, { kind: "company" }>
type ProposalStatus = "draft" | "sent" | "approved" | "rejected"

function errorToken(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  const value = error as Record<string, unknown>
  return typeof value.message === "string"
    ? value.message
    : typeof value.code === "string"
      ? value.code
      : null
}

function mapProposalError(error: unknown): never {
  if (error instanceof ApiError) throw error
  const token = errorToken(error)
  if (
    token === "AXSYS_PROPOSAL_NOT_FOUND" ||
    token === "AXSYS_ADMINISTRATIVE_PROPOSAL_NOT_FOUND"
  ) {
    throw new ApiError("PROPOSAL_NOT_FOUND", 404, "Proposta não encontrada.")
  }
  if (token === "AXSYS_VERSION_CONFLICT" || token === "40001") {
    throw new ApiError(
      "VERSION_CONFLICT",
      409,
      "A proposta foi alterada por outra sessão.",
    )
  }
  if (token === "AXSYS_PROPOSAL_DOCUMENT_REQUIRED") {
    throw new ApiError("DOCUMENT_REQUIRED", 409, "Gere um PDF antes do envio.")
  }
  if (
    token === "AXSYS_PROPOSAL_TRANSITION_INVALID" ||
    token === "AXSYS_PROPOSAL_IMMUTABLE" ||
    token === "AXSYS_PROPOSAL_ITEMS_IMMUTABLE"
  ) {
    throw new ApiError(
      "INVALID_STATUS_TRANSITION",
      409,
      "Transição de estado inválida.",
    )
  }
  if (
    token === "AXSYS_PROPOSAL_CLIENT_NOT_FOUND" ||
    token === "AXSYS_PROPOSAL_CATALOG_NOT_FOUND" ||
    token === "23503"
  ) {
    throw new ApiError(
      "PROPOSAL_REFERENCE_INVALID",
      422,
      "Cliente ou item não está disponível no segmento informado.",
    )
  }
  if (
    token === "AXSYS_PROPOSAL_ITEMS_INVALID" ||
    token === "AXSYS_PROPOSAL_ITEM_PRECISION_INVALID" ||
    token === "AXSYS_PROPOSAL_INPUT_INVALID"
  ) {
    throw new ApiError("VALIDATION_FAILED", 422, "Revise os dados da proposta.")
  }
  throw error
}

async function recordTotalMismatch(
  error: unknown,
  context: CompanyContext,
  correlationId: string,
  resourceId?: string,
): Promise<void> {
  if (!(error instanceof ApiError) || error.code !== "INTERNAL_TOTAL_MISMATCH") return
  await bffDb.writeProposalTotalMismatchSecurityEvent({
    actorUserId: context.userId,
    sessionId: context.sessionId,
    proposalId: resourceId ?? null,
    correlationId,
  }).catch(() => undefined)
}

export function listProposals(input: Readonly<{
  context: CompanyContext
  q?: string
  clientId?: string
  segment?: string
  status?: ProposalStatus
  issuedFrom?: string
  issuedTo?: string
  cursor?: string
  limit: number
}>) {
  return readProposals(input)
}

export function getProposalDetail(input: Readonly<{
  context: CompanyContext
  proposalId: string
}>) {
  return readProposalDetail(input)
}

export function listProposalSelectors(input: Readonly<{
  context: CompanyContext
  segment: string
}>) {
  return readProposalSelectors(input)
}

export async function createProposal(input: Readonly<{
  context: CompanyContext
  input: ProposalCreateInput
  correlationId: string
}>) {
  try {
    return await createProposalRecord({
      ...input,
      input: proposalCreateSchema.parse(input.input),
    })
  } catch (error) {
    await recordTotalMismatch(error, input.context, input.correlationId)
    return mapProposalError(error)
  }
}

export async function updateDraftProposal(input: Readonly<{
  context: CompanyContext
  proposalId: string
  input: ProposalDraftUpdateInput
  correlationId: string
}>) {
  const parsed = proposalDraftUpdateSchema.parse(input.input)
  try {
    if ("items" in parsed) {
      return await replaceProposalItems({
        context: input.context,
        proposalId: input.proposalId,
        version: parsed.version,
        items: parsed.items,
        correlationId: input.correlationId,
      })
    }
    return await updateProposalDetails({
      context: input.context,
      proposalId: input.proposalId,
      version: parsed.version,
      clientId: parsed.clientId,
      segment: parsed.segment,
      issuedOn: parsed.issuedOn,
      correlationId: input.correlationId,
    })
  } catch (error) {
    await recordTotalMismatch(
      error,
      input.context,
      input.correlationId,
      input.proposalId,
    )
    return mapProposalError(error)
  }
}

export async function transitionProposalStatus(input: Readonly<{
  context: CompanyContext
  proposalId: string
  expectedVersion: number
  nextStatus: ProposalStatus
  correlationId: string
}>) {
  try {
    const current = await readProposalDetail({
      context: input.context,
      proposalId: input.proposalId,
    })
    if (!canTransitionProposal(current.proposal.status, input.nextStatus)) {
      throw new ApiError(
        "INVALID_STATUS_TRANSITION",
        409,
        "Transição de estado inválida.",
      )
    }
    return await transitionProposalRecord(input)
  } catch (error) {
    return mapProposalError(error)
  }
}

export async function deleteDraftProposal(input: Readonly<{
  context: CompanyContext
  proposalId: string
  version: number
  correlationId: string
}>) {
  try {
    const current = await readProposalDetail({
      context: input.context,
      proposalId: input.proposalId,
    })
    if (
      current.proposal.status !== "draft" ||
      (await proposalHasDocuments({
        context: input.context,
        proposalId: input.proposalId,
      }))
    ) {
      throw new ApiError(
        "HISTORICAL_RESOURCE",
        409,
        "Propostas emitidas ou documentadas não podem ser excluídas.",
      )
    }
    return await deleteProposalRecord(input)
  } catch (error) {
    return mapProposalError(error)
  }
}
