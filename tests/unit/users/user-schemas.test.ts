import { describe, expect, it } from "vitest"

import {
  createCompanyUserSchema,
  temporaryPasswordResetSchema,
  updateCompanyUserSchema,
} from "@/modules/users/schemas/user-schemas"

describe("company user schemas", () => {
  it("normalizes identity and deduplicates modules deterministically", () => {
    expect(
      createCompanyUserSchema.parse({
        displayName: "  Maria Financeiro ",
        email: " MARIA@EXAMPLE.COM ",
        temporaryPassword: "frase provisoria segura 2026",
        role: "member",
        modules: ["financial", "administrative", "financial"],
      }),
    ).toEqual({
      displayName: "Maria Financeiro",
      email: "maria@example.com",
      temporaryPassword: "frase provisoria segura 2026",
      role: "member",
      modules: ["administrative", "financial"],
    })
  })

  it("rejects protected tenant and identity fields", () => {
    expect(() =>
      updateCompanyUserSchema.parse({
        displayName: "Maria",
        role: "member",
        modules: [],
        status: "active",
        suspensionReason: null,
        version: 1,
        companyId: crypto.randomUUID(),
      }),
    ).toThrow()
  })

  it("requires a reason for suspension and administrative password reset", () => {
    expect(() =>
      updateCompanyUserSchema.parse({
        displayName: "Maria",
        role: "member",
        modules: [],
        status: "suspended",
        suspensionReason: null,
        version: 1,
      }),
    ).toThrow()
    expect(() =>
      temporaryPasswordResetSchema.parse({
        temporaryPassword: "frase provisoria segura 2026",
        reason: "curto",
      }),
    ).toThrow()
  })
})
