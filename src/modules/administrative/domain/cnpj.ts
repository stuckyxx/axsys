const NON_DIGITS = /\D/g

function calculateDigit(base: string, weights: readonly number[]): number {
  const sum = weights.reduce(
    (total, weight, index) => total + Number(base[index]) * weight,
    0,
  )
  const remainder = sum % 11
  return remainder < 2 ? 0 : 11 - remainder
}

export function normalizeCnpj(value: string): string {
  return value.replace(NON_DIGITS, "")
}

export function isValidCnpj(value: string): boolean {
  const digits = normalizeCnpj(value)
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false
  const first = calculateDigit(
    digits.slice(0, 12),
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  )
  const second = calculateDigit(
    digits.slice(0, 12) + first,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  )
  return digits.endsWith(String(first) + String(second))
}
