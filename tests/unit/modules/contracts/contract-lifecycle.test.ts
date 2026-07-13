import { describe, expect, it } from "vitest"

import { deriveContractLifecycle } from "@/modules/contracts/domain/contract-lifecycle"

const base = { startsOn: "2026-07-01", endsOn: "2026-08-25", today: "2026-07-10" }

describe("contract lifecycle", () => {
  it("derives status with an inclusive 45-day expiring window", () => {
    expect(deriveContractLifecycle({ ...base, endsOn: "2026-07-09" }).status).toBe("expired")
    expect(deriveContractLifecycle({ ...base, endsOn: "2026-07-10" }).status).toBe("expiring")
    expect(deriveContractLifecycle({ ...base, endsOn: "2026-08-24" }).status).toBe("expiring")
    expect(deriveContractLifecycle({ ...base, endsOn: "2026-08-25" }).status).toBe("active")
    expect(deriveContractLifecycle({ ...base, endsOn: "2026-07-09", closedOn: "2026-07-05" }).status).toBe("closed")
  })

  it("clamps progress before start and on end", () => {
    expect(deriveContractLifecycle({ startsOn: "2026-07-11", endsOn: "2026-07-20", today: "2026-07-10" }).progress).toBe(0)
    expect(deriveContractLifecycle({ startsOn: "2026-07-01", endsOn: "2026-07-10", today: "2026-07-10" }).progress).toBe(100)
  })

  it("handles one-day contracts", () => {
    expect(deriveContractLifecycle({ startsOn: "2026-07-10", endsOn: "2026-07-10", today: "2026-07-09" }).progress).toBe(0)
    expect(deriveContractLifecycle({ startsOn: "2026-07-10", endsOn: "2026-07-10", today: "2026-07-10" }).progress).toBe(100)
  })

  it("freezes early-close progress on the company-local closure day", () => {
    expect(deriveContractLifecycle({ startsOn: "2026-07-01", endsOn: "2026-07-11", today: "2026-07-20", closedOn: "2026-07-06" })).toEqual({ status: "closed", progress: 50 })
  })

  it("rejects impossible date-only values and inverted ranges", () => {
    expect(() => deriveContractLifecycle({ ...base, today: "2026-02-30" })).toThrow("INVALID_DATE_ONLY")
    expect(() => deriveContractLifecycle({ ...base, startsOn: "2026-09-01" })).toThrow("INVALID_CONTRACT_RANGE")
  })
})
