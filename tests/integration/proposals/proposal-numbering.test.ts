import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/http/api-error"
import { calculateProductTotal, calculateProposalTotal, calculateServiceTotal } from "@/lib/money/money"
import { createCompanyContext } from "../../helpers/auth"

const writer = vi.hoisted(() => ({
  createProposal: vi.fn(),
  getProposalDetail: vi.fn(),
  writeProposalTotalMismatchSecurityEvent: vi.fn(),
}))

vi.mock("@/modules/proposals/server/proposal-repository", () => ({
  createProposalRecord: writer.createProposal,
  getProposalDetail: writer.getProposalDetail,
  listProposals: vi.fn(),
  updateProposalDetails: vi.fn(),
  replaceProposalItems: vi.fn(),
  transitionProposalRecord: vi.fn(),
  deleteProposalRecord: vi.fn(),
}))
vi.mock("@/lib/db/bff", () => ({
  bffDb: {
    writeProposalTotalMismatchSecurityEvent:
      writer.writeProposalTotalMismatchSecurityEvent,
  },
}))

function companyContext(companyId: string, userId: string) {
  return Object.freeze({ ...createCompanyContext(), companyId, userId })
}

const companyA = companyContext(
  "30000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000001",
)
const companyB = companyContext(
  "30000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000002",
)

const clientId = "71000000-0000-4000-8000-000000000001"
const serviceId = "72000000-0000-4000-8000-000000000001"
const productId = "72000000-0000-4000-8000-000000000002"

describe("proposal service numbering and decimal boundary", () => {
  beforeEach(() => {
    writer.writeProposalTotalMismatchSecurityEvent.mockResolvedValue(undefined)
  })

  it("preserves independent tenant sequences under concurrent requests", async () => {
    const counters = new Map<string, number>()
    writer.createProposal.mockImplementation(async ({ context }: { context: typeof companyA }) => {
      const next = (counters.get(context.companyId) ?? 0) + 1
      counters.set(context.companyId, next)
      return {
        proposal: {
          id: crypto.randomUUID(), clientId, clientName: "Cliente", segment: "Tecnologia",
          number: next, issuedOn: "2026-07-12", status: "draft", total: "100.00",
          sentAt: null, version: 1, createdAt: "2026-07-12T12:00:00.000Z",
          updatedAt: "2026-07-12T12:00:00.000Z",
        },
        items: [{
          id: crypto.randomUUID(), catalogItemId: serviceId, itemKind: "service",
          position: 1, description: "Serviço", months: 1, monthlyAmount: "100.00",
          quantity: null, unitAmount: null, lineTotal: "100.00",
        }],
      }
    })

    const { createProposal } = await import("@/modules/proposals/server/proposal-service")
    const payload = {
      clientId,
      segment: "Tecnologia",
      issuedOn: "2026-07-12",
      items: [{
        kind: "service" as const,
        catalogItemId: serviceId,
        description: "Serviço",
        months: 1,
        monthlyAmount: "100.00",
      }],
    }
    const results = await Promise.all([
      ...Array.from({ length: 20 }, () => createProposal({
        context: companyA, input: payload, correlationId: crypto.randomUUID(),
      })),
      ...Array.from({ length: 7 }, () => createProposal({
        context: companyB, input: payload, correlationId: crypto.randomUUID(),
      })),
    ])
    expect(results.slice(0, 20).map((entry) => entry.proposal.number).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 20 }, (_, index) => index + 1))
    expect(results.slice(20).map((entry) => entry.proposal.number).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 7 }, (_, index) => index + 1))
  })

  it("uses Decimal-compatible totals for services and fractional products", () => {
    const service = calculateServiceTotal(3, "1250.40")
    const product = calculateProductTotal("2.5", "199.99")
    expect(service).toBe("3751.20")
    expect(product).toBe("499.98")
    expect(calculateProposalTotal([service, product])).toBe("4251.18")
  })

  it("maps a rolled-back invalid mixed segment without consuming application state", async () => {
    writer.createProposal.mockRejectedValueOnce(
      Object.assign(new Error("AXSYS_PROPOSAL_CATALOG_NOT_FOUND"), {
        code: "AXSYS_PROPOSAL_CATALOG_NOT_FOUND",
      }),
    )
    const { createProposal } = await import("@/modules/proposals/server/proposal-service")
    await expect(createProposal({
      context: companyA,
      correlationId: crypto.randomUUID(),
      input: {
        clientId,
        segment: "Tecnologia",
        issuedOn: "2026-07-12",
        items: [{
          kind: "product",
          catalogItemId: productId,
          description: "Produto de outro segmento",
          quantity: "1",
          unitAmount: "10.00",
        }],
      },
    })).rejects.toMatchObject({ code: "PROPOSAL_REFERENCE_INVALID", status: 422 } satisfies Partial<ApiError>)
  })

  it("records a redacted security event when persisted totals diverge", async () => {
    writer.createProposal.mockRejectedValueOnce(
      new ApiError(
        "INTERNAL_TOTAL_MISMATCH",
        503,
        "Os totais da proposta não puderam ser confirmados.",
      ),
    )
    const { createProposal } = await import("@/modules/proposals/server/proposal-service")
    const correlationId = crypto.randomUUID()
    await expect(createProposal({
      context: companyA,
      correlationId,
      input: {
        clientId,
        segment: "Tecnologia",
        issuedOn: "2026-07-12",
        items: [{
          kind: "service",
          catalogItemId: serviceId,
          description: "Serviço",
          months: 1,
          monthlyAmount: "100.00",
        }],
      },
    })).rejects.toMatchObject({ code: "INTERNAL_TOTAL_MISMATCH", status: 503 })
    expect(writer.writeProposalTotalMismatchSecurityEvent).toHaveBeenCalledWith({
      actorUserId: companyA.userId,
      sessionId: companyA.sessionId,
      proposalId: null,
      correlationId,
    })
  })
})
