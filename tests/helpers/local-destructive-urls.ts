const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])

function parseUrl(value: string | undefined, fixtureName: string): URL {
  if (!value) throw new Error(`${fixtureName} is unavailable`)
  try {
    return new URL(value)
  } catch {
    throw new Error(`${fixtureName} is unavailable`)
  }
}

function reject(fixtureName: string): never {
  throw new Error(`${fixtureName} is unavailable`)
}

export function requireLocalHttpUrl(
  value: string | undefined,
  port: string,
  fixtureName: string,
): string {
  const url = parseUrl(value, fixtureName)
  if (
    url.protocol !== "http:" ||
    url.username !== "" ||
    url.password !== "" ||
    !LOCAL_HOSTS.has(url.hostname) ||
    url.port !== port ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return reject(fixtureName)
  }
  return url.toString()
}

export function requireLocalOwnerDatabaseUrl(
  value: string | undefined,
  fixtureName: string,
): string {
  const url = parseUrl(value, fixtureName)
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.username !== "postgres" ||
    url.password.length === 0 ||
    !LOCAL_HOSTS.has(url.hostname) ||
    url.port !== "54322" ||
    url.pathname !== "/postgres" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return reject(fixtureName)
  }
  return url.toString()
}
