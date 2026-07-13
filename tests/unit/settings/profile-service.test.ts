import { describe, expect, it, vi } from "vitest"

import { updateOwnDisplayName } from "@/modules/settings/server/profile-service"

const db = vi.hoisted(() => ({ updateOwnProfile: vi.fn() }))
vi.mock("@/lib/db/bff", () => ({ bffDb: db }))

describe("profile service", () => {
  it("maps a Postgres CAS message even when the driver exposes SQLSTATE first", async () => {
    db.updateOwnProfile.mockRejectedValueOnce({
      code: "40001",
      message: "AXSYS_PROFILE_VERSION_CONFLICT",
    })

    await expect(updateOwnDisplayName({
      actor: {
        userId: "71000000-0000-4000-8000-000000000001",
        sessionId: "72000000-0000-4000-8000-000000000001",
      },
      displayName: "Gabriel Machado",
      version: 3,
      correlationId: "73000000-0000-4000-8000-000000000001",
    })).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 })
  })
})
