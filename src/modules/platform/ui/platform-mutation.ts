"use client"

export type PlatformMutationResponse<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; code: string | null; message: string }>

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function json(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try { return JSON.parse(text) as unknown } catch { return null }
}

export async function platformMutation<T>(input: {
  endpoint: string
  method: "POST" | "PATCH"
  payload: unknown
  idempotencyKey?: string
  signal?: AbortSignal
}): Promise<PlatformMutationResponse<T>> {
  const csrfResponse = await fetch("/api/auth/csrf", {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    signal: input.signal,
  })
  const csrfBody = await json(csrfResponse)
  const token = record(csrfBody) && typeof csrfBody.token === "string" ? csrfBody.token : null
  if (!csrfResponse.ok || !token) return { ok: false, code: null, message: "Não foi possível validar a operação." }

  const headers: Record<string, string> = { "content-type": "application/json", "x-csrf-token": token }
  if (input.idempotencyKey) headers["idempotency-key"] = input.idempotencyKey
  const response = await fetch(input.endpoint, {
    method: input.method,
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    headers,
    body: JSON.stringify(input.payload),
    signal: input.signal,
  })
  const body = await json(response)
  if (response.ok) return { ok: true, data: body as T }
  const error = record(body) && record(body.error) ? body.error : null
  return {
    ok: false,
    code: error && typeof error.code === "string" ? error.code : null,
    message: error && typeof error.message === "string" && error.message.length <= 240 ? error.message : "Não foi possível concluir a operação.",
  }
}
