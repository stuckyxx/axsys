import { describe, expect, it, vi } from "vitest"

import { createAuthAdminGateway } from "@/modules/users/server/auth-admin-gateway"

function fixture() {
  const admin = {
    createUser: vi.fn().mockResolvedValue({
      data: { user: { id: crypto.randomUUID() } },
      error: null,
    }),
    updateUserById: vi.fn().mockResolvedValue({ data: {}, error: null }),
    deleteUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
  }
  return { admin, gateway: createAuthAdminGateway(admin) }
}

describe("Auth Admin gateway", () => {
  it("creates confirmed users without authorization metadata", async () => {
    const { admin, gateway } = fixture()
    await expect(
      gateway.createUser({
        email: "member@example.com",
        password: "frase provisoria segura 2026",
        emailConfirm: true,
        provisioningOperationId: "operation-2026-0001",
      }),
    ).resolves.toEqual({ id: expect.any(String) })
    expect(admin.createUser).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "frase provisoria segura 2026",
      email_confirm: true,
      app_metadata: {
        axsys_provisioning_operation_id: "operation-2026-0001",
      },
    })
    expect(admin.createUser.mock.calls[0]![0]).not.toHaveProperty("user_metadata")
  })

  it("uses explicit long-ban, unban and hard-delete operations", async () => {
    const { admin, gateway } = fixture()
    const userId = crypto.randomUUID()

    await gateway.banUser(userId)
    await gateway.unbanUser(userId)
    await gateway.deleteUser(userId)

    expect(admin.updateUserById).toHaveBeenNthCalledWith(1, userId, {
      ban_duration: "876000h",
    })
    expect(admin.updateUserById).toHaveBeenNthCalledWith(2, userId, {
      ban_duration: "none",
    })
    expect(admin.deleteUser).toHaveBeenCalledWith(userId, false)
  })

  it("normalizes provider errors without leaking details", async () => {
    const { admin, gateway } = fixture()
    admin.createUser.mockResolvedValue({
      data: { user: null },
      error: new Error("provider email and internal details"),
    })

    await expect(
      gateway.createUser({
        email: "member@example.com",
        password: "frase provisoria segura 2026",
        emailConfirm: true,
        provisioningOperationId: "operation-2026-0001",
      }),
    ).rejects.toThrow("Auth administration unavailable")
  })

  it("preserves only the safe machine code for an Auth identity conflict", async () => {
    const { admin, gateway } = fixture()
    admin.createUser.mockResolvedValue({
      data: { user: null },
      error: Object.assign(new Error("provider private identity detail"), {
        code: "user_already_exists",
      }),
    })

    await expect(
      gateway.createUser({
        email: "member@example.com",
        password: "frase provisoria segura 2026",
        emailConfirm: true,
        provisioningOperationId: "operation-2026-0001",
      }),
    ).rejects.toMatchObject({
      code: "user_already_exists",
      message: "Auth administration unavailable",
    })
  })
})
