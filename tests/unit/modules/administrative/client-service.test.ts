import { beforeEach, describe, expect, it, vi } from "vitest"

import { createCompanyContext } from "../../../helpers/auth"

const writers = vi.hoisted(() => ({
  createClient: vi.fn(),
  updateClient: vi.fn(),
  archiveClient: vi.fn(),
  restoreClient: vi.fn(),
  deleteClient: vi.fn(),
}))

vi.mock("@/lib/db/bff", () => ({ bffDb: writers }))
vi.mock("@/modules/administrative/server/client-repository", () => ({
  listClients: vi.fn(),
  getClientDetail: vi.fn(),
}))

const validInput = {
  legalName: "Município de Horizonte",
  tradeName: null,
  cnpj: "04.252.011/0001-10",
  segment: "Prefeituras",
  email: null,
  phone: null,
  addressStreet: null,
  addressNumber: null,
  addressComplement: null,
  addressNeighborhood: null,
  municipality: "Horizonte",
  state: "CE",
  postalCode: null,
}

describe("client service writer boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const writer of Object.values(writers)) {
      writer.mockResolvedValue({ record: null, scopes: [] })
    }
  })

  it("derives actor/session and never forwards tenant identity from input", async () => {
    const { createClient } = await import(
      "@/modules/administrative/server/client-service"
    )
    const context = createCompanyContext()

    await createClient({ context, input: validInput, correlationId: crypto.randomUUID() })

    expect(writers.createClient).toHaveBeenCalledWith({
      actorUserId: context.userId,
      sessionId: context.sessionId,
      input: expect.not.objectContaining({ companyId: expect.anything() }),
      correlationId: expect.any(String),
    })
  })

  it("moves update version into the CAS argument and strips it from JSON", async () => {
    const { updateClient } = await import(
      "@/modules/administrative/server/client-service"
    )
    const context = createCompanyContext()

    await updateClient({
      context,
      clientId: crypto.randomUUID(),
      input: { ...validInput, version: 7 },
      correlationId: crypto.randomUUID(),
    })

    expect(writers.updateClient).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: context.userId,
      sessionId: context.sessionId,
      expectedVersion: 7,
      input: expect.not.objectContaining({ version: expect.anything() }),
    }))
  })

  it.each([
    ["AXSYS_CLIENT_NOT_FOUND", 404, "CLIENT_NOT_FOUND"],
    ["AXSYS_CLIENT_VERSION_CONFLICT", 409, "VERSION_CONFLICT"],
    ["23503", 409, "RESOURCE_IN_USE"],
    ["23505", 409, "CLIENT_CONFLICT"],
  ])("maps %s to a safe HTTP error", async (token, status, code) => {
    const { deleteClient } = await import(
      "@/modules/administrative/server/client-service"
    )
    writers.deleteClient.mockRejectedValueOnce(Object.assign(new Error(token), { code: token }))

    const result = deleteClient({
      context: createCompanyContext(),
      clientId: crypto.randomUUID(),
      version: 2,
      correlationId: crypto.randomUUID(),
    })

    await expect(result).rejects.toMatchObject({ code, status })
  })
})
