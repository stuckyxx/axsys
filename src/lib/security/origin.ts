import "server-only"

import { getServerEnv } from "@/lib/env/server"
import { ApiError } from "@/lib/http/api-error"

function isCanonicalHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      value === url.origin
    )
  } catch {
    return false
  }
}

export function assertMutationOrigin(
  origin: string | null,
): void {
  const expectedOrigin = getServerEnv().APP_ORIGIN
  if (
    !origin ||
    !isCanonicalHttpOrigin(expectedOrigin) ||
    origin !== expectedOrigin
  ) {
    throw new ApiError(
      "ORIGIN_INVALID",
      403,
      "Origem da requisição recusada.",
    )
  }
}
