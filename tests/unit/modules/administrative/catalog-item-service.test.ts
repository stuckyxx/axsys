import { beforeEach, describe, expect, it, vi } from "vitest"

import { createCompanyContext } from "../../../helpers/auth"

const writers = vi.hoisted(() => ({
  createCatalogItem: vi.fn(),
  updateCatalogItem: vi.fn(),
  archiveCatalogItem: vi.fn(),
  restoreCatalogItem: vi.fn(),
  deleteCatalogItem: vi.fn(),
}))

vi.mock("@/lib/db/bff", () => ({ bffDb: writers }))
vi.mock("@/modules/administrative/server/catalog-item-repository", () => ({
  listCatalogItems: vi.fn(),
  getCatalogItem: vi.fn(),
}))

const validInput = {
  itemKind: "service" as const,
  segment: "Tecnologia",
  name: "Assessoria técnica",
  description: "Acompanhamento técnico especializado",
}

describe("catalog service writer boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const writer of Object.values(writers)) {
      writer.mockResolvedValue({ record: null, scopes: [] })
    }
  })

  it("derives identity and moves update version outside strict JSON", async () => {
    const { updateCatalogItem } = await import(
      "@/modules/administrative/server/catalog-item-service"
    )
    const context = createCompanyContext()

    await updateCatalogItem({
      context,
      itemId: crypto.randomUUID(),
      input: { ...validInput, version: 4 },
      correlationId: crypto.randomUUID(),
    })

    expect(writers.updateCatalogItem).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: context.userId,
      sessionId: context.sessionId,
      expectedVersion: 4,
      input: expect.not.objectContaining({ version: expect.anything() }),
    }))
  })

  it.each([
    ["AXSYS_CATALOG_ITEM_NOT_FOUND", 404, "CATALOG_ITEM_NOT_FOUND"],
    ["AXSYS_CATALOG_ITEM_VERSION_CONFLICT", 409, "VERSION_CONFLICT"],
    ["23503", 409, "RESOURCE_IN_USE"],
    ["23505", 409, "CATALOG_ITEM_CONFLICT"],
  ])("maps %s without exposing SQL details", async (token, status, code) => {
    const { deleteCatalogItem } = await import(
      "@/modules/administrative/server/catalog-item-service"
    )
    writers.deleteCatalogItem.mockRejectedValueOnce(Object.assign(new Error(token), { code: token }))

    const result = deleteCatalogItem({
      context: createCompanyContext(),
      itemId: crypto.randomUUID(),
      version: 2,
      correlationId: crypto.randomUUID(),
    })

    await expect(result).rejects.toMatchObject({ code, status })
  })
})
