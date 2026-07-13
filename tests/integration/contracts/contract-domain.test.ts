import { describe, expect, it } from "vitest"

import {
  decodeContractCursor,
  encodeContractCursor,
} from "@/modules/contracts/domain/contract-cursor"
import { deriveContractLifecycle } from "@/modules/contracts/domain/contract-lifecycle"

describe("contract stable pagination and lifecycle boundary", () => {
  it("round-trips the exact endsOn/id keyset", () => {
    const value = { endsOn: "2026-08-24", id: crypto.randomUUID() }
    expect(decodeContractCursor(encodeContractCursor(value))).toEqual(value)
  })

  it.each([
    [null, "2026-07-09", "expired"],
    [null, "2026-07-10", "expiring"],
    [null, "2026-08-24", "expiring"],
    [null, "2026-08-25", "active"],
    ["2026-07-10", "2026-08-25", "closed"],
  ] as const)("derives closed=%s end=%s as %s", (closedOn, endsOn, status) => {
    expect(
      deriveContractLifecycle({
        startsOn: "2026-01-01",
        endsOn,
        today: "2026-07-10",
        closedOn,
      }).status,
    ).toBe(status)
  })
})
