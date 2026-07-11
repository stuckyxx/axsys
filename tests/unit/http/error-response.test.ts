import { describe, expect, it } from "vitest"
import { z } from "zod"

import { ApiError } from "@/lib/http/api-error"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { NO_STORE_HEADERS, withNoStore } from "@/lib/security/no-store"

const FIXED_CORRELATION_ID = "80000000-0000-4000-8000-000000000001"

describe("getCorrelationId", () => {
  it("preserves a valid caller-provided UUID", () => {
    const request = new Request("https://axsys.test/api", {
      headers: { "x-correlation-id": FIXED_CORRELATION_ID },
    })

    expect(getCorrelationId(request)).toBe(FIXED_CORRELATION_ID)
  })

  it.each(["", "not-a-uuid", `${FIXED_CORRELATION_ID} extra`])(
    "replaces an invalid correlation ID with a fresh UUID: %s",
    (provided) => {
      const request = new Request("https://axsys.test/api", {
        headers: { "x-correlation-id": provided },
      })

      const generated = getCorrelationId(request)

      expect(generated).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      )
      expect(generated).not.toBe(provided)
    },
  )
})

describe("ApiError", () => {
  it("retains only the stable public error contract", () => {
    const error = new ApiError("FORBIDDEN", 403, "Acesso negado", {
      email: ["E-mail inválido"],
    })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("ApiError")
    expect(error.code).toBe("FORBIDDEN")
    expect(error.status).toBe(403)
    expect(error.fieldErrors).toEqual({ email: ["E-mail inválido"] })
  })
})

describe("no-store headers", () => {
  it("overwrites every cache-sensitive header with the frozen values", () => {
    const response = new Response(null, {
      headers: {
        "Cache-Control": "public, max-age=3600",
        Vary: "Accept-Encoding",
      },
    })

    expect(withNoStore(response)).toBe(response)
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
      expect(response.headers.get(name)).toBe(value)
    }
  })

  it("adds the frozen headers to an immutable redirect response", () => {
    const response = withNoStore(
      Response.redirect("https://axsys.test/login", 303),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("https://axsys.test/login")
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
      expect(response.headers.get(name)).toBe(value)
    }
  })
})

describe("toErrorResponse", () => {
  it("returns the stable ApiError envelope with all no-store headers", async () => {
    const response = toErrorResponse(
      new ApiError("FORBIDDEN", 403, "Acesso negado"),
      FIXED_CORRELATION_ID,
    )

    expect(response.status).toBe(403)
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
      expect(response.headers.get(name)).toBe(value)
    }
    expect(response.headers.get("content-type")).toContain("application/json")
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Acesso negado",
        correlationId: FIXED_CORRELATION_ID,
      },
    })
  })

  it("normalizes Zod failures to field errors without leaking issue inputs", async () => {
    const rejectedValue = "plaintext-password-secret"
    const schema = z.object({ email: z.email(), password: z.string().min(30) })
    const validationError = schema.safeParse({
      email: "invalid",
      password: rejectedValue,
    })
    expect(validationError.success).toBe(false)
    if (validationError.success) throw new Error("expected validation failure")

    const response = toErrorResponse(validationError.error, FIXED_CORRELATION_ID)
    const serialized = JSON.stringify(await response.json())

    expect(response.status).toBe(422)
    expect(JSON.parse(serialized)).toEqual({
      error: {
        code: "VALIDATION_FAILED",
        message: "Revise os campos informados.",
        correlationId: FIXED_CORRELATION_ID,
        fieldErrors: {
          email: [expect.any(String)],
          password: [expect.any(String)],
        },
      },
    })
    expect(serialized).not.toContain(rejectedValue)
  })

  it("maps unknown failures to a fixed internal envelope without leaking details", async () => {
    const privateDetail = "sb_secret_should-never-cross-the-boundary"
    const response = toErrorResponse(new Error(privateDetail), FIXED_CORRELATION_ID)
    const serialized = JSON.stringify(await response.json())

    expect(response.status).toBe(500)
    expect(JSON.parse(serialized)).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Não foi possível concluir a operação.",
        correlationId: FIXED_CORRELATION_ID,
      },
    })
    expect(serialized).not.toContain(privateDetail)
  })
})
