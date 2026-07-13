import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  persistProposalDocument,
  type GeneratedDocumentDependencies,
} from "@/modules/documents/server/generated-document-repository"
import { buildProposalDocumentSnapshot } from "@/modules/proposals/server/proposal-snapshot"
import { createCompanyContext } from "../../../helpers/auth"

const proposalId = "73000000-0000-4000-8000-000000000001"

function snapshot() {
  return buildProposalDocumentSnapshot({
    templateVersion: "proposal-v1",
    generatedAt: "2026-07-13T12:30:00.000Z",
    proposal: { number: 17, status: "draft", issuedOn: "2026-07-13", total: "100.00" },
    items: [{
      catalogItemId: "72000000-0000-4000-8000-000000000001",
      itemKind: "service",
      position: 1,
      descriptionSnapshot: "Assessoria técnica",
      months: 1,
      monthlyAmount: "100.00",
      quantity: null,
      unitAmount: null,
      lineTotal: "100.00",
    }],
    client: {
      legalName: "Município de Horizonte",
      tradeName: null,
      cnpj: "04252011000110",
      email: "cliente@example.test",
      phone: null,
      address: {
        street: null,
        number: null,
        complement: null,
        neighborhood: null,
        municipality: "Horizonte",
        state: "CE",
        postalCode: null,
      },
    },
    company: {
      legalName: "Axsys Tecnologia Ltda",
      tradeName: "Axsys",
      cnpj: "11222333000181",
      consolidatedAddress: null,
      representativeName: null,
      representativeRole: null,
      letterheadSha256: null,
      signatureSha256: null,
    },
    author: { displayName: "Admin", email: "admin@example.test" },
  })
}

function dependencies() {
  const upload = vi.fn<GeneratedDocumentDependencies["upload"]>(async () => undefined)
  const remove = vi.fn<GeneratedDocumentDependencies["remove"]>(async () => undefined)
  const store = vi.fn<GeneratedDocumentDependencies["store"]>(async () => ({
    documentId: crypto.randomUUID(),
    version: 1,
    checksumSha256: "a".repeat(64),
    templateVersion: "proposal-v1",
    createdAt: "2026-07-13T12:30:00.000Z",
    scopes: ["proposals", "storage"] as const,
  }))
  const recordOrphan = vi.fn<GeneratedDocumentDependencies["recordOrphan"]>(async () => ({
    cleanupId: crypto.randomUUID(),
    recordedAt: "2026-07-13T12:30:00.000Z",
  }))
  return { upload, remove, store, recordOrphan } satisfies GeneratedDocumentDependencies
}

const bytes = Buffer.from("%PDF-1.7\nsecure-pdf", "ascii")

describe("generated proposal document persistence", () => {
  beforeEach(() => vi.clearAllMocks())

  it("uploads to a random tenant path before atomically storing metadata", async () => {
    const deps = dependencies()
    const context = createCompanyContext()
    await persistProposalDocument({
      context,
      proposalId,
      bytes,
      snapshot: snapshot(),
      correlationId: crypto.randomUUID(),
    }, deps)
    expect(deps.upload).toHaveBeenCalledOnce()
    const path = deps.upload.mock.calls[0]?.[0]
    expect(path).toMatch(new RegExp(
      `^${context.companyId}/generated-documents/[0-9a-f-]{36}\\.pdf$`,
      "u",
    ))
    expect(deps.store).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: context.userId,
      sessionId: context.sessionId,
      proposalId,
      objectPath: path,
      contentType: "application/pdf",
      byteSize: bytes.length,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      templateVersion: "proposal-v1",
    }))
    expect(deps.remove).not.toHaveBeenCalled()
  })

  it("removes the uploaded object when the database transaction rejects", async () => {
    const deps = dependencies()
    deps.store.mockRejectedValueOnce(new Error("quota rejected"))
    await expect(persistProposalDocument({
      context: createCompanyContext(),
      proposalId,
      bytes,
      snapshot: snapshot(),
      correlationId: crypto.randomUUID(),
    }, deps)).rejects.toThrow("quota rejected")
    expect(deps.remove).toHaveBeenCalledWith(deps.upload.mock.calls[0]?.[0])
    expect(deps.recordOrphan).not.toHaveBeenCalled()
  })

  it("durably records a redacted orphan when storage compensation also fails", async () => {
    const deps = dependencies()
    deps.store.mockRejectedValueOnce(new Error("metadata rejected"))
    deps.remove.mockRejectedValueOnce(new Error("storage unavailable"))
    const correlationId = crypto.randomUUID()
    await expect(persistProposalDocument({
      context: createCompanyContext(),
      proposalId,
      bytes,
      snapshot: snapshot(),
      correlationId,
    }, deps)).rejects.toThrow("metadata rejected")
    expect(deps.recordOrphan).toHaveBeenCalledWith(expect.objectContaining({
      proposalId,
      objectPath: deps.upload.mock.calls[0]?.[0],
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      correlationId,
    }))
  })

  it("never stores metadata when the private upload fails", async () => {
    const deps = dependencies()
    deps.upload.mockRejectedValueOnce(new Error("upload unavailable"))
    await expect(persistProposalDocument({
      context: createCompanyContext(),
      proposalId,
      bytes,
      snapshot: snapshot(),
      correlationId: crypto.randomUUID(),
    }, deps)).rejects.toThrow("upload unavailable")
    expect(deps.store).not.toHaveBeenCalled()
    expect(deps.remove).not.toHaveBeenCalled()
  })
})
