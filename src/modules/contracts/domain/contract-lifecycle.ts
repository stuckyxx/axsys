import type { ContractStatus } from "@/modules/contracts/domain/contract-types"

const DAY_MS = 86_400_000
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/u

function dayOrdinal(value: string): number {
  const match = DATE_ONLY.exec(value)
  if (!match) throw new Error("INVALID_DATE_ONLY")
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`)
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().slice(0, 10) !== value
  ) {
    throw new Error("INVALID_DATE_ONLY")
  }
  return milliseconds / DAY_MS
}

export function deriveContractLifecycle(input: {
  startsOn: string
  endsOn: string
  today: string
  closedOn?: string | null
}): { status: ContractStatus; progress: number } {
  const start = dayOrdinal(input.startsOn)
  const end = dayOrdinal(input.endsOn)
  const today = dayOrdinal(input.today)
  if (end < start) throw new Error("INVALID_CONTRACT_RANGE")
  const effective = input.closedOn
    ? Math.min(today, dayOrdinal(input.closedOn))
    : today
  const progress =
    start === end
      ? effective < start
        ? 0
        : 100
      : Math.round(
          Math.max(0, Math.min(1, (effective - start) / (end - start))) * 100,
        )
  const status: ContractStatus = input.closedOn
    ? "closed"
    : end < today
      ? "expired"
      : end <= today + 45
        ? "expiring"
        : "active"
  return { status, progress }
}
