const REQUEST_NONCE = /^[a-f0-9]{32}$/u

export function requireRequestNonce(value: string | null): string {
  if (value === null || !REQUEST_NONCE.test(value)) {
    throw new Error("Invalid request security context")
  }
  return value
}
