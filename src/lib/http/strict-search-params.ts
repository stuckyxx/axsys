export function strictSearchParams(
  searchParams: URLSearchParams,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  for (const [key, value] of searchParams) {
    const current = result[key]
    if (current === undefined) {
      result[key] = value
    } else if (Array.isArray(current)) {
      current.push(value)
    } else {
      result[key] = [current, value]
    }
  }
  return result
}
