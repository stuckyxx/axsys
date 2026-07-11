import { describe, expect, it } from "vitest"

import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  temporaryPasswordSchema,
  themeSchema,
} from "@/modules/auth/schemas/auth-schemas"

describe("auth schemas", () => {
  it("canonicalizes email while preserving password bytes exactly", () => {
    const password = "  Senha e\u0301 exata  "

    expect(
      loginSchema.parse({
        email: "  USER@Example.TEST  ",
        password,
      }),
    ).toEqual({
      email: "user@example.test",
      password,
      rememberMe: false,
    })
  })

  it("accepts an explicit remember-me boolean", () => {
    expect(
      loginSchema.parse({
        email: "user@example.test",
        password: "password",
        rememberMe: true,
      }).rememberMe,
    ).toBe(true)
  })

  it.each([
    ["companyId", "11111111-1111-4111-8111-111111111111"],
    ["role", "super_admin"],
    ["modules", ["financial"]],
    ["redirectTo", "/platform"],
    ["userId", "11111111-1111-4111-8111-111111111111"],
  ])("rejects the protected login field %s", (field, value) => {
    expect(
      loginSchema.safeParse({
        email: "user@example.test",
        password: "password",
        [field]: value,
      }).success,
    ).toBe(false)
  })

  it("compares password confirmation as exact bytes", () => {
    const composed = "mot-de-passe-é"
    const decomposed = "mot-de-passe-e\u0301"

    expect(
      changePasswordSchema.safeParse({
        password: composed,
        confirmation: decomposed,
      }),
    ).toMatchObject({
      success: false,
      error: {
        issues: [
          expect.objectContaining({
            message: "As senhas não coincidem.",
            path: ["confirmation"],
          }),
        ],
      },
    })

    expect(
      changePasswordSchema.parse({
        password: decomposed,
        confirmation: decomposed,
      }),
    ).toEqual({ password: decomposed, confirmation: decomposed })
  })

  it("rejects unknown fields in every mutation schema", () => {
    expect(
      changePasswordSchema.safeParse({
        password: "a",
        confirmation: "a",
        userId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(false)
    expect(
      forgotPasswordSchema.safeParse({
        email: "user@example.test",
        redirectTo: "https://attacker.example",
      }).success,
    ).toBe(false)
    expect(
      temporaryPasswordSchema.safeParse({
        targetUserId: "11111111-1111-4111-8111-111111111111",
        password: "password",
        role: "super_admin",
      }).success,
    ).toBe(false)
    expect(
      themeSchema.safeParse({
        theme: "dark",
        version: 1,
        companyId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(false)
  })

  it("validates email, UUID, theme, versions, and input bounds", () => {
    expect(forgotPasswordSchema.safeParse({ email: "invalid" }).success).toBe(
      false,
    )
    expect(
      forgotPasswordSchema.safeParse({
        email: `${"a".repeat(246)}@example.test`,
      }).success,
    ).toBe(false)
    expect(
      temporaryPasswordSchema.safeParse({
        targetUserId: "not-a-uuid",
        password: "password",
      }).success,
    ).toBe(false)
    expect(
      temporaryPasswordSchema.safeParse({
        targetUserId: "11111111-1111-4111-8111-111111111111",
        password: "x".repeat(129),
      }).success,
    ).toBe(false)
    expect(themeSchema.safeParse({ theme: "system", version: 1 }).success).toBe(
      false,
    )

    for (const version of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(themeSchema.safeParse({ theme: "light", version }).success).toBe(
        false,
      )
    }

    expect(themeSchema.parse({ theme: "light", version: 1 })).toEqual({
      theme: "light",
      version: 1,
    })
  })
})
