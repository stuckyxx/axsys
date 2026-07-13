const DATE_PARTS = Object.freeze(["year", "month", "day"] as const)

export function getCompanyLocalDate(timeZone: string, instant: Date): string {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new Error("INVALID_INSTANT")
  }

  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      calendar: "gregory",
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
  } catch {
    throw new Error("INVALID_TIME_ZONE")
  }

  const values = new Map(
    formatter
      .formatToParts(instant)
      .filter((part) => DATE_PARTS.includes(part.type as (typeof DATE_PARTS)[number]))
      .map((part) => [part.type, part.value]),
  )
  const year = values.get("year")
  const month = values.get("month")
  const day = values.get("day")
  if (!year || !month || !day) throw new Error("INVALID_LOCAL_DATE")
  return `${year.padStart(4, "0")}-${month}-${day}`
}
