type CspInput = {
  nonce: string
  supabaseUrl: string
  development: boolean
}

const CSP_NONCE = /^[A-Za-z0-9+/_=-]{1,128}$/u

function resolveSupabaseOrigins(value: string): {
  httpOrigin: string
  websocketOrigin: string
} {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Invalid CSP input")
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("Invalid CSP input")
  }
  return {
    httpOrigin: url.origin,
    websocketOrigin: `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`,
  }
}

export function buildContentSecurityPolicy({
  nonce,
  supabaseUrl,
  development,
}: CspInput): string {
  if (!CSP_NONCE.test(nonce)) throw new Error("Invalid CSP input")
  const { httpOrigin, websocketOrigin } = resolveSupabaseOrigins(supabaseUrl)
  const scriptSources = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]
  if (development) scriptSources.push("'unsafe-eval'")

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${httpOrigin}`,
    "font-src 'self' data:",
    `connect-src 'self' ${httpOrigin} ${websocketOrigin}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ")
}
