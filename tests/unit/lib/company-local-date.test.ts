import { describe, expect, it } from "vitest"

import { getCompanyLocalDate } from "@/lib/dates/company-local-date"

describe("company local date", () => {
  it("crosses UTC midnight using the injected company timezone", () => {
    expect(getCompanyLocalDate("America/Fortaleza", new Date("2026-07-10T02:59:59.000Z"))).toBe("2026-07-09")
    expect(getCompanyLocalDate("America/Fortaleza", new Date("2026-07-10T03:00:00.000Z"))).toBe("2026-07-10")
  })

  it("converts a closure instant whose UTC and local dates differ", () => {
    expect(getCompanyLocalDate("America/Fortaleza", new Date("2026-07-10T01:30:00.000Z"))).toBe("2026-07-09")
  })

  it("rejects an invalid timezone or instant", () => {
    expect(() => getCompanyLocalDate("Invalid/Zone", new Date())).toThrow("INVALID_TIME_ZONE")
    expect(() => getCompanyLocalDate("America/Fortaleza", new Date("invalid"))).toThrow("INVALID_INSTANT")
  })
})
