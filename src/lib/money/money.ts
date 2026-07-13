import Decimal from "decimal.js"

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP })

const MONEY_INPUT = /^\d+(?:\.\d{1,2})?$/u
const PRODUCT_UNIT_INPUT = /^\d+(?:\.\d{1,3})?$/u
const QUANTITY_INPUT = /^\d{1,9}(?:\.\d{1,3})?$/u

export const MAX_MONEY = new Decimal("999999999999.99")
export type Money = string

function parseMoneyInput(value: string): Decimal {
  if (!MONEY_INPUT.test(value)) throw new Error("INVALID_MONEY")
  const decimal = new Decimal(value)
  if (!decimal.isFinite() || decimal.isNegative()) throw new Error("INVALID_MONEY")
  if (decimal.greaterThan(MAX_MONEY)) throw new Error("MONEY_OUT_OF_RANGE")
  return decimal
}

function parseProductUnitInput(value: string): Decimal {
  if (!PRODUCT_UNIT_INPUT.test(value)) throw new Error("INVALID_MONEY")
  const decimal = new Decimal(value)
  if (!decimal.isFinite() || decimal.isNegative()) throw new Error("INVALID_MONEY")
  if (decimal.greaterThan(MAX_MONEY)) throw new Error("MONEY_OUT_OF_RANGE")
  return decimal
}

export function toMoney(value: Decimal.Value): string {
  if (typeof value === "string") return parseMoneyInput(value).toFixed(2)
  const decimal = new Decimal(value)
  if (!decimal.isFinite() || decimal.isNegative()) throw new Error("INVALID_MONEY")
  const rounded = decimal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  if (rounded.greaterThan(MAX_MONEY)) throw new Error("MONEY_OUT_OF_RANGE")
  return rounded.toFixed(2)
}

export function calculateServiceTotal(
  months: number,
  monthlyAmount: string,
): string {
  if (!Number.isInteger(months) || months <= 0) throw new Error("INVALID_MONTHS")
  return toMoney(parseMoneyInput(monthlyAmount).times(months))
}

export function calculateProductTotal(
  quantity: string,
  unitAmount: string,
): string {
  if (!QUANTITY_INPUT.test(quantity)) throw new Error("INVALID_QUANTITY")
  const parsedQuantity = new Decimal(quantity)
  if (!parsedQuantity.isFinite() || !parsedQuantity.greaterThan(0)) {
    throw new Error("INVALID_QUANTITY")
  }
  return toMoney(parsedQuantity.times(parseProductUnitInput(unitAmount)))
}

export function calculateProposalTotal(lines: readonly string[]): string {
  const total = lines.reduce(
    (sum, value) => sum.plus(parseMoneyInput(value)),
    new Decimal(0),
  )
  return toMoney(total)
}
