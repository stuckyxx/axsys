import { describe, expect, it } from "vitest"

import { canonicalizeIp } from "@/lib/security/canonical-ip"
import {
  canonicalizeLocalFixtureClientIp,
  hashLocalFixtureClientIp,
} from "../../e2e/auth/local-platform-ip"

describe("canonical IP rate-limit identity", () => {
  it("uses the same hash for a leading-zero IPv6 header and fixture cleanup", () => {
    const rawClientIp = "2001:0db8:0001:0002:0003:0004:0005:0006"
    const pepper = "task14-leading-zero-regression-pepper"

    const headerClientIp = canonicalizeLocalFixtureClientIp(rawClientIp)

    expect(headerClientIp).toBe("2001:db8:1:2:3:4:5:6")
    expect(headerClientIp).toBe(canonicalizeIp(rawClientIp))
    expect(hashLocalFixtureClientIp(rawClientIp, pepper)).toBe(
      hashLocalFixtureClientIp(headerClientIp, pepper),
    )
  })
})
