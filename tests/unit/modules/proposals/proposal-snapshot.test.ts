import { describe, expect, it } from "vitest"

import {
  buildProposalDocumentSnapshot,
  proposalDocumentSnapshotSchema,
  type ProposalSnapshotSource,
} from "@/modules/proposals/server/proposal-snapshot"

const LONG_DESCRIPTION = (
  "Descrição técnica com acentuação: ação, prestação e São Luís. " +
  "<script>alert(1)</script> " +
  "<img src=x onerror=alert(2)> " +
  "javascript:alert(document.domain) " +
  "conteúdo técnico com acentuação çãõ. ".repeat(80)
).slice(0, 2_000)

function source(): ProposalSnapshotSource {
  return {
    proposal: {
      number: 1042,
      status: "draft",
      issuedOn: "2026-07-13",
      total: "3751.20",
    },
    items: [
      {
        catalogItemId: "6850d1bc-5990-4ead-aa94-e0e48e9f93d1",
        itemKind: "service",
        position: 1,
        descriptionSnapshot: LONG_DESCRIPTION,
        months: 3,
        monthlyAmount: "1250.40",
        quantity: null,
        unitAmount: null,
        lineTotal: "3751.20",
      },
    ],
    client: {
      legalName: "Cliente São José Ltda",
      tradeName: "São José",
      cnpj: "11222333000181",
      email: "financeiro@cliente.test",
      phone: "+55 85 3333-2222",
      address: {
        street: "Rua da Constituição",
        number: "100",
        complement: "Sala 2",
        neighborhood: "Centro",
        municipality: "Fortaleza",
        state: "CE",
        postalCode: "60000000",
      },
    },
    company: {
      legalName: "Axsys Tecnologia Ltda",
      tradeName: "Axsys",
      cnpj: "04252011000110",
      consolidatedAddress: "Rua Central, 100 · Fortaleza/CE · CEP 60000-000",
      representativeName: "Márcia Araújo",
      representativeRole: "Diretora Executiva",
      letterheadSha256: "a".repeat(64),
      signatureSha256: null,
    },
    author: {
      displayName: "João D'Ávila",
      email: "joao@axsys.test",
    },
    templateVersion: "proposal-v1",
    generatedAt: "2026-07-13T12:30:00.000Z",
  }
}

function expectDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return
  expect(Object.isFrozen(value)).toBe(true)
  for (const nested of Object.values(value)) expectDeepFrozen(nested)
}

describe("proposal document snapshot", () => {
  it("copies only immutable structured source data and preserves inert text", () => {
    const raw = {
      ...source(),
      signedUrl: "https://storage.test/private/proposal.pdf?token=secret",
      objectPath: "tenant/generated-documents/secret.pdf",
      storageToken: "secret",
      auditActorIp: "127.0.0.1",
      items: source().items.map((item) => ({
        ...item,
        currentCatalogDescription: "Descrição mutável que não pode entrar",
      })),
    } as ProposalSnapshotSource

    const snapshot = buildProposalDocumentSnapshot(raw)

    expect(snapshot).toMatchObject({
      templateVersion: "proposal-v1",
      generatedAt: "2026-07-13T12:30:00.000Z",
      proposal: { number: 1042, status: "draft", issuedOn: "2026-07-13", total: "3751.20" },
      company: {
        legalName: "Axsys Tecnologia Ltda",
        representative: { name: "Márcia Araújo", role: "Diretora Executiva" },
        branding: { letterheadSha256: "a".repeat(64), signatureSha256: null },
      },
      client: {
        legalName: "Cliente São José Ltda",
        address: { municipality: "Fortaleza", state: "CE" },
      },
      author: { displayName: "João D'Ávila", email: "joao@axsys.test" },
      items: [{ description: LONG_DESCRIPTION, monthlyAmount: "1250.40", lineTotal: "3751.20" }],
    })
    expect(JSON.stringify(snapshot)).not.toMatch(
      /signedUrl|objectPath|storageToken|auditActorIp|currentCatalogDescription/u,
    )
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    expectDeepFrozen(snapshot)
  })

  it("validates the completed object with recursive strict schemas", () => {
    const snapshot = buildProposalDocumentSnapshot(source())
    expect(proposalDocumentSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(() => proposalDocumentSnapshotSchema.parse({ ...snapshot, url: "https://storage.test/private" })).toThrow()
    expect(() => proposalDocumentSnapshotSchema.parse({
      ...snapshot,
      client: { ...snapshot.client, token: "secret" },
    })).toThrow()
  })

  it("preserves a trim_scale product quantity with fewer than three decimals", () => {
    const base = source()
    const snapshot = buildProposalDocumentSnapshot({
      ...base,
      proposal: { ...base.proposal, total: "25.03" },
      items: [{
        catalogItemId: "7850d1bc-5990-4ead-aa94-e0e48e9f93d1",
        itemKind: "product",
        position: 1,
        descriptionSnapshot: "Licença de produto",
        months: null,
        monthlyAmount: null,
        quantity: "2.5",
        unitAmount: "10.01",
        lineTotal: "25.03",
      }],
    })

    expect(snapshot.items[0]).toMatchObject({
      itemKind: "product",
      quantity: "2.5",
      unitAmount: "10.01",
    })
  })
})
