import { describe, expect, it, vi } from "vitest"

import type { AccessContext } from "@/modules/auth/domain/access-context"
import { createUploadIntent } from "@/modules/files/server/create-upload-intent"

const companyContext = {
  kind: "company",
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  authenticatedAt: 1_700_000_000,
  companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  membershipId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  role: "company_admin",
  modules: [],
  profile: {
    displayName: "Admin",
    email: "admin@example.test",
    preferredTheme: "dark",
    version: 1,
  },
} satisfies Extract<AccessContext, { kind: "company" }>

const intentId = "11111111-1111-4111-8111-111111111111"
const randomId = "22222222-2222-4222-8222-222222222222"
const quarantinePath = `${companyContext.companyId}/${companyContext.userId}/${intentId}/${randomId}`
const correlationId = "33333333-3333-4333-8333-333333333333"

function createDeps() {
  const calls: string[] = []
  return {
    calls,
    deps: {
      repository: {
        reserveImageUploadIntent: vi.fn(async () => {
          calls.push("reserve")
          return { intentId, quarantinePath, declaredSize: 1024 }
        }),
        activateFileUploadAuthorization: vi.fn(async () => {
          calls.push("activate")
          return {
            uploadAuthorizationExpiresAt: "2030-01-01T02:00:00.000Z",
            finalizeBefore: "2030-01-02T02:15:00.000Z",
          }
        }),
      },
      storage: {
        createSignedUploadCapability: vi.fn(async () => {
          calls.push("sign")
          return { token: "signed-capability" }
        }),
      },
      resumableEndpoint: "http://127.0.0.1:54321/storage/v1/upload/resumable",
    },
  }
}

const input = {
  context: companyContext,
  purpose: "profile_avatar" as const,
  targetResourceId: null,
  declaredName: "avatar.png",
  declaredMime: "image/png",
  declaredSize: 1024,
  correlationId,
}

describe("createUploadIntent", () => {
  it("ativa a autorização no banco antes de assinar qualquer capability", async () => {
    const { deps, calls } = createDeps()

    const result = await createUploadIntent(deps, input)

    expect(calls).toEqual(["reserve", "activate", "sign"])
    expect(result).toEqual({
      intentId,
      endpoint: deps.resumableEndpoint,
      bucket: "axsys-quarantine",
      path: quarantinePath,
      token: "signed-capability",
      uploadAuthorizationExpiresAt: "2030-01-01T02:00:00.000Z",
      finalizeBefore: "2030-01-02T02:15:00.000Z",
      maxBytes: 5 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    })
  })

  it("não tenta cancelar após uma ativação ambígua", async () => {
    const { deps } = createDeps()
    deps.repository.activateFileUploadAuthorization.mockRejectedValueOnce(
      new Error("connection dropped after commit"),
    )

    await expect(createUploadIntent(deps, input)).rejects.toThrow(
      "connection dropped after commit",
    )
    expect(deps.storage.createSignedUploadCapability).not.toHaveBeenCalled()
  })

  it("não libera a reserva quando a assinatura falha depois da ativação", async () => {
    const { deps } = createDeps()
    deps.storage.createSignedUploadCapability.mockRejectedValueOnce(
      new Error("storage unavailable"),
    )

    await expect(createUploadIntent(deps, input)).rejects.toThrow(
      "storage unavailable",
    )
    expect(deps.repository.activateFileUploadAuthorization).toHaveBeenCalledOnce()
  })

  it.each([
    ["purpose desabilitado", { purpose: "certificate" as const }, "UPLOAD_PURPOSE_NOT_ENABLED"],
    ["MIME não permitido", { declaredMime: "image/svg+xml" }, "FILE_TYPE_MISMATCH"],
    ["extensão divergente", { declaredName: "avatar.jpg" }, "FILE_EXTENSION_MISMATCH"],
    ["arquivo vazio", { declaredSize: 0 }, "FILE_SIZE_INVALID"],
    ["arquivo acima do limite", { declaredSize: 5 * 1024 * 1024 + 1 }, "FILE_TOO_LARGE"],
    ["correlationId inválido", { correlationId: "invalid" }, "REQUEST_INVALID"],
  ])("rejeita %s antes de reservar", async (_label, override, code) => {
    const { deps } = createDeps()

    await expect(
      createUploadIntent(deps, { ...input, ...override }),
    ).rejects.toMatchObject({ code })
    expect(deps.repository.reserveImageUploadIntent).not.toHaveBeenCalled()
  })

  it("falha fechado se o repositório devolver path fora do tenant", async () => {
    const { deps } = createDeps()
    deps.repository.reserveImageUploadIntent.mockResolvedValueOnce({
      intentId,
      quarantinePath: `ffffffff-ffff-4fff-8fff-ffffffffffff/${companyContext.userId}/${intentId}/${randomId}`,
      declaredSize: 1024,
    })

    await expect(createUploadIntent(deps, input)).rejects.toMatchObject({
      code: "UPLOAD_RESERVATION_INVALID",
    })
    expect(deps.repository.activateFileUploadAuthorization).not.toHaveBeenCalled()
  })

  it("falha fechado se o retorno de ativação trouxer prazos inválidos", async () => {
    const { deps } = createDeps()
    deps.repository.activateFileUploadAuthorization.mockResolvedValueOnce({
      uploadAuthorizationExpiresAt: "invalid",
      finalizeBefore: "2030-01-02T02:15:00.000Z",
    })

    await expect(createUploadIntent(deps, input)).rejects.toMatchObject({
      code: "UPLOAD_AUTHORIZATION_INVALID",
    })
    expect(deps.storage.createSignedUploadCapability).not.toHaveBeenCalled()
  })

  it("passa ao repositório somente identidade verificada e metadados declarados", async () => {
    const { deps } = createDeps()

    await createUploadIntent(deps, input)

    expect(deps.repository.reserveImageUploadIntent).toHaveBeenCalledWith({
      actorUserId: companyContext.userId,
      sessionId: companyContext.sessionId,
      purpose: "profile_avatar",
      targetResourceId: null,
      declaredName: "avatar.png",
      declaredMime: "image/png",
      declaredSize: 1024,
      correlationId,
    })
    expect(deps.repository.activateFileUploadAuthorization).toHaveBeenCalledWith({
      actorUserId: companyContext.userId,
      sessionId: companyContext.sessionId,
      intentId,
    })
    expect(deps.storage.createSignedUploadCapability).toHaveBeenCalledWith({
      bucket: "axsys-quarantine",
      path: quarantinePath,
      upsert: false,
    })
  })
})
