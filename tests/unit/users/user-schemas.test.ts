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

  it("applies the module limit after deduplication", () => {
    expect(
      createCompanyUserSchema.parse({
        displayName: "Maria Financeiro",
        email: "maria@example.com",
        temporaryPassword: "frase provisoria segura 2026",
        role: "member",
        modules: ["financial", "financial", "financial", "financial"],
      }).modules,
    ).toEqual(["financial"])
  })

  it("normalizes modules in update payloads using the canonical order", () => {
    expect(
      updateCompanyUserSchema.parse({
        displayName: "Maria",
        role: "member",
        modules: ["certificates", "administrative", "certificates"],
        status: "active",
        suspensionReason: null,
        version: 1,
      }).modules,
    ).toEqual(["administrative", "certificates"])
  })

  it.each([
    [
      "create",
      createCompanyUserSchema,
      {
        displayName: "Maria",
        email: "maria@example.com",
        temporaryPassword: "frase provisoria segura 2026",
        role: "member",
        modules: [],
        company_id: crypto.randomUUID(),
      },
    ],
    [
      "update",
      updateCompanyUserSchema,
      {
        displayName: "Maria",
        role: "member",
        modules: [],
        status: "active",
        suspensionReason: null,
        version: 1,
        user_id: crypto.randomUUID(),
      },
    ],
    [
      "temporary password reset",
      temporaryPasswordResetSchema,
      {
        temporaryPassword: "frase provisoria segura 2026",
        reason: "Solicitação administrativa válida",
        targetUserId: crypto.randomUUID(),
      },
    ],
  ])("rejects protected fields in the %s payload", (_name, schema, input) => {
    expect(schema.safeParse(input).success).toBe(false)
  })

  it("rejects modules outside the company module allowlist", () => {
    expect(
      createCompanyUserSchema.safeParse({
        displayName: "Maria",
        email: "maria@example.com",
        temporaryPassword: "frase provisoria segura 2026",
        role: "member",
        modules: ["reports"],
      }).success,
    ).toBe(false)
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
