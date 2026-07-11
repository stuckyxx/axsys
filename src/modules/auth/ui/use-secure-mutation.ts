"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const GENERIC_ERROR = "Não foi possível concluir a operação. Tente novamente."
const EMPTY_FIELD_ERRORS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({})

export type ApiErrorBody = Readonly<{
  error: Readonly<{
    code: string
    message: string
    correlationId: string
    fieldErrors?: Readonly<Record<string, readonly string[]>>
  }>
}>

export type SecureMutationResult<TResult> = Readonly<{
  data: TResult
  status: number
}>

type ParsedApiError = Readonly<{
  code: string | null
  message: string
  fieldErrors: Readonly<Record<string, readonly string[]>>
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseFieldErrors(
  value: unknown,
): Readonly<Record<string, readonly string[]>> {
  if (!isRecord(value)) return EMPTY_FIELD_ERRORS

  const parsed: Record<string, readonly string[]> = {}
  for (const [field, messages] of Object.entries(value)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(field) || !Array.isArray(messages)) {
      continue
    }

    const safeMessages = messages.filter(
      (message): message is string =>
        typeof message === "string" &&
        message.length > 0 &&
        message.length <= 240,
    )
    if (safeMessages.length > 0) parsed[field] = Object.freeze(safeMessages)
  }

  return Object.freeze(parsed)
}

function parseApiErrorBody(value: unknown): ParsedApiError {
  if (!isRecord(value) || !isRecord(value.error)) {
    return {
      code: null,
      message: GENERIC_ERROR,
      fieldErrors: EMPTY_FIELD_ERRORS,
    }
  }

  const code = value.error.code
  const message = value.error.message
  return {
    code:
      typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code)
        ? code
        : null,
    message:
      typeof message === "string" && message.length > 0 && message.length <= 240
        ? message
        : GENERIC_ERROR,
    fieldErrors: parseFieldErrors(value.error.fieldErrors),
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const rawBody = await response.text()
  if (rawBody.length === 0) return null

  try {
    return JSON.parse(rawBody) as unknown
  } catch {
    return null
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

export function useSecureMutation<TPayload>(endpoint: string) {
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const requestController = useRef<AbortController | null>(null)
  const [csrfToken, setCsrfToken] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<
    Readonly<Record<string, readonly string[]>>
  >(EMPTY_FIELD_ERRORS)

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
      requestController.current?.abort()
      requestController.current = null
      inFlight.current = false
    }
  }, [])

  const submit = useCallback(
    async <TResult,>(
      payload: TPayload,
    ): Promise<SecureMutationResult<TResult> | null> => {
      if (inFlight.current) return null

      inFlight.current = true
      const controller = new AbortController()
      requestController.current?.abort()
      requestController.current = controller
      setPending(true)
      setError(null)
      setFieldErrors(EMPTY_FIELD_ERRORS)

      try {
        let token = csrfToken
        if (token === null) {
          const csrfResponse = await fetch("/api/auth/csrf", {
            cache: "no-store",
            credentials: "same-origin",
            redirect: "error",
            signal: controller.signal,
          })
          const csrfBody = await readResponseBody(csrfResponse)
          token =
            isRecord(csrfBody) &&
            typeof csrfBody.token === "string" &&
            csrfBody.token.length > 0 &&
            csrfBody.token.length <= 4_096 &&
            csrfBody.token === csrfBody.token.trim()
              ? csrfBody.token
              : null

          if (!csrfResponse.ok || token === null) throw new Error(GENERIC_ERROR)
          if (mounted.current) setCsrfToken(token)
        }

        const response = await fetch(endpoint, {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": token,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        const body = await readResponseBody(response)

        if (!response.ok) {
          const parsedError = parseApiErrorBody(body)
          if (mounted.current) {
            if (parsedError.code === "CSRF_INVALID") setCsrfToken(null)
            setError(parsedError.message)
            setFieldErrors(parsedError.fieldErrors)
          }
          return null
        }

        return Object.freeze({ data: body as TResult, status: response.status })
      } catch (caughtError) {
        if (!isAbortError(caughtError) && mounted.current) {
          setError(GENERIC_ERROR)
          setFieldErrors(EMPTY_FIELD_ERRORS)
        }
        return null
      } finally {
        if (requestController.current === controller) {
          requestController.current = null
        }
        inFlight.current = false
        if (!controller.signal.aborted && mounted.current) setPending(false)
      }
    },
    [csrfToken, endpoint],
  )

  return { submit, pending, error, fieldErrors } as const
}
