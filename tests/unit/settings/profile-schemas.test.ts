import { describe, expect, it } from "vitest"

import {
  profileAvatarSchema,
  profileUpdateSchema,
} from "@/modules/settings/schemas/profile-schemas"

describe("profile schemas", () => {
  it("normalizes user-editable profile fields", () => {
    expect(
      profileUpdateSchema.parse({
        displayName: "  Maria Administradora  ",
        email: "  MARIA@EXAMPLE.COM ",
        version: 4,
      }),
    ).toEqual({
      displayName: "Maria Administradora",
      email: "maria@example.com",
      version: 4,
    })
  })

  it("rejects protected authorization fields and unsafe versions", () => {
    expect(() =>
      profileUpdateSchema.parse({
        displayName: "Maria",
        version: 1,
        role: "super_admin",
      }),
    ).toThrow()
    expect(() =>
      profileUpdateSchema.parse({ displayName: "Maria", version: 0 }),
    ).toThrow()
  })

  it("accepts only a UUID and optimistic version when attaching an avatar", () => {
    const fileId = crypto.randomUUID()
    expect(profileAvatarSchema.parse({ fileId, version: 2 })).toEqual({
      fileId,
      version: 2,
    })
    expect(() =>
      profileAvatarSchema.parse({
        fileId,
        version: 2,
        companyId: crypto.randomUUID(),
      }),
    ).toThrow()
  })
})
