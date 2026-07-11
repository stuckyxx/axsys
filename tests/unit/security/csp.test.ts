import { describe, expect, it } from "vitest"

import { buildContentSecurityPolicy } from "@/lib/security/csp"

describe("buildContentSecurityPolicy", () => {
  it("builds the frozen production policy around one nonce and Supabase origin", () => {
    const value = buildContentSecurityPolicy({
      nonce: "nonce-value",
      supabaseUrl: "https://project.supabase.co/path?ignored=true",
      development: false,
    })

    expect(value.split("; ")).toEqual([
      "default-src 'self'",
      "script-src 'self' 'nonce-nonce-value' 'strict-dynamic'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://project.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https://project.supabase.co wss://project.supabase.co",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ])
    expect(value.match(/nonce-nonce-value/gu)).toHaveLength(1)
    expect(value).not.toContain("connect-src *")
    expect(value).not.toContain("'unsafe-eval'")
  })

  it("adds only the development eval exception and derives local websocket origin", () => {
    const value = buildContentSecurityPolicy({
      nonce: "dev_nonce-1",
      supabaseUrl: "http://127.0.0.1:54321",
      development: true,
    })

    expect(value).toContain(
      "script-src 'self' 'nonce-dev_nonce-1' 'strict-dynamic' 'unsafe-eval'",
    )
    expect(value).toContain(
      "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321",
    )
  })

  it.each([
    { nonce: "bad nonce", supabaseUrl: "https://project.supabase.co" },
    { nonce: "bad'; connect-src *", supabaseUrl: "https://project.supabase.co" },
    { nonce: "valid-nonce", supabaseUrl: "javascript:alert(1)" },
    { nonce: "valid-nonce", supabaseUrl: "https://user:pass@project.supabase.co" },
  ])("rejects CSP injection inputs before building a header: %j", (input) => {
    expect(() =>
      buildContentSecurityPolicy({ ...input, development: false }),
    ).toThrow("Invalid CSP input")
  })
})
