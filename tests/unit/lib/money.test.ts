import { describe, expect, it } from "vitest"

import {
  calculateProductTotal,
  calculateProposalTotal,
  calculateServiceTotal,
  toMoney,
} from "@/lib/money/money"

describe("canonical money", () => {
  it("calculates services using Decimal", () => {
    expect(calculateServiceTotal(3, "1250.40")).toBe("3751.20")
  })

  it("rounds product multiplication half-up", () => {
    expect(calculateProductTotal("2.555", "10.015")).toBe("25.59")
  })

  it("adds decimal line totals without binary float artifacts", () => {
    expect(calculateProposalTotal(["0.10", "0.20"])).toBe("0.30")
  })

  it.each(["-1.00", "NaN", "Infinity", "1e2", "1.001"])(
    "rejects invalid money input %s",
    (value) => expect(() => toMoney(value)).toThrow(),
  )

  it("enforces numeric(14,2) after rounding", () => {
    expect(toMoney("999999999999.99")).toBe("999999999999.99")
    expect(() => toMoney("1000000000000.00")).toThrow("MONEY_OUT_OF_RANGE")
    expect(() => calculateProductTotal("2.000", "999999999999.99")).toThrow("MONEY_OUT_OF_RANGE")
    expect(() => calculateProposalTotal(["999999999999.99", "0.01"])).toThrow("MONEY_OUT_OF_RANGE")
  })

  it("rejects invalid quantity and service boundaries", () => {
    expect(() => calculateServiceTotal(0, "1.00")).toThrow("INVALID_MONTHS")
    expect(() => calculateProductTotal("0", "1.00")).toThrow("INVALID_QUANTITY")
    expect(() => calculateProductTotal("1.0001", "1.00")).toThrow("INVALID_QUANTITY")
    expect(() => calculateProductTotal("1e2", "1.00")).toThrow("INVALID_QUANTITY")
  })
})
