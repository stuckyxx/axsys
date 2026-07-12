"use client"

import type { QueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef } from "react"

import { publishInvalidation } from "@/lib/query/mutation-sync"
import { queryKeys, type QueryScope } from "@/lib/query/query-keys"

export const SESSION_WATCHDOG_INTERVAL_MS = 60_000
export const SESSION_WATCHDOG_TIMEOUT_MS = 10_000

type WatchdogClient = Pick<QueryClient, "clear" | "invalidateQueries">

type SessionWatchdogOptions = Readonly<{
  refresh: () => void
  replaceLocation?: (path: string) => void
  senderId: string
  stopDocument?: () => void
}>

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const MODULES = new Set(["administrative", "certificates", "financial"])

function replaceDocumentLocation(path: string): void {
  window.location.replace(path)
}

function stopCurrentDocument(): void {
  window.stop()
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort()
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  )
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

function isProfile(value: unknown): boolean {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["displayName", "email", "preferredTheme", "version"])
  ) {
    return false
  }
  return (
    typeof value.displayName === "string" &&
    value.displayName.length >= 2 &&
    value.displayName.length <= 120 &&
    value.displayName === value.displayName.trim() &&
    typeof value.email === "string" &&
    value.email.length > 0 &&
    value.email.length <= 320 &&
    value.email === value.email.trim() &&
    (value.preferredTheme === "dark" || value.preferredTheme === "light") &&
    Number.isSafeInteger(value.version) &&
    (value.version as number) > 0
  )
}

function isModules(value: unknown): value is string[] {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length) {
    return false
  }
  return (
    value.every(
      (module, index) =>
        Object.hasOwn(value, index) &&
        typeof module === "string" &&
        MODULES.has(module),
    ) && new Set(value).size === value.length
  )
}

function matchesAccessContext(value: unknown, scope: QueryScope): boolean {
  if (!isPlainRecord(value) || !isUuid(value.userId) || !isProfile(value.profile)) {
    return false
  }

  if (scope.companyId === null) {
    return (
      hasExactKeys(value, ["kind", "modules", "profile", "userId"]) &&
      value.kind === "platform" &&
      value.userId === scope.userId &&
      isModules(value.modules) &&
      value.modules.length === 0
    )
  }

  return (
    hasExactKeys(value, [
      "companyId",
      "kind",
      "modules",
      "profile",
      "role",
      "userId",
    ]) &&
    value.kind === "company" &&
    value.userId === scope.userId &&
    isUuid(value.companyId) &&
    value.companyId === scope.companyId &&
    (value.role === "company_admin" || value.role === "member") &&
    isModules(value.modules)
  )
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function useSessionWatchdog(
  scope: QueryScope,
  queryClient: WatchdogClient,
  {
    refresh,
    replaceLocation = replaceDocumentLocation,
    senderId,
    stopDocument = stopCurrentDocument,
  }: SessionWatchdogOptions,
): () => Promise<void> {
  const controller = useRef<AbortController | null>(null)
  const ended = useRef(false)
  const inFlight = useRef<Promise<void> | null>(null)

  const endSession = useCallback(() => {
    if (ended.current) return
    ended.current = true
    queryClient.clear()
    try {
      publishInvalidation({
        resources: [],
        scope,
        senderId,
        type: "session-ended",
      })
    } finally {
      try {
        stopDocument()
      } finally {
        replaceLocation("/login")
      }
    }
  }, [queryClient, replaceLocation, scope, senderId, stopDocument])

  const revalidate = useCallback((): Promise<void> => {
    if (ended.current) return Promise.resolve()
    if (inFlight.current !== null) return inFlight.current

    const requestController = new AbortController()
    controller.current = requestController
    const request = (async () => {
      let rejectOnAbort: (() => void) | null = null
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(new Error("Session watchdog aborted"))
        rejectOnAbort = onAbort
        requestController.signal.addEventListener("abort", onAbort, {
          once: true,
        })
      })
      const timeout = window.setTimeout(
        () => requestController.abort(),
        SESSION_WATCHDOG_TIMEOUT_MS,
      )
      try {
        const response = await Promise.race([
          fetch("/api/auth/me", {
            cache: "no-store",
            credentials: "same-origin",
            signal: requestController.signal,
          }),
          aborted,
        ])
        if (requestController.signal.aborted || ended.current) return
        if (response.status === 401 || response.status === 403) {
          endSession()
          return
        }
        if (!response.ok) return

        const body = await readBody(response)
        if (requestController.signal.aborted || ended.current) return
        if (!matchesAccessContext(body, scope)) {
          endSession()
          return
        }

        await queryClient.invalidateQueries({ queryKey: queryKeys.root(scope) })
        if (!requestController.signal.aborted && !ended.current) refresh()
      } catch {
        // Network and server availability do not prove the session ended.
      } finally {
        window.clearTimeout(timeout)
        if (rejectOnAbort !== null) {
          requestController.signal.removeEventListener("abort", rejectOnAbort)
        }
      }
    })()

    inFlight.current = request
    void request.finally(() => {
      if (inFlight.current === request) inFlight.current = null
      if (controller.current === requestController) controller.current = null
    })
    return request
  }, [endSession, queryClient, refresh, scope])

  useEffect(() => {
    const trigger = () => {
      void revalidate()
    }
    trigger()
    window.addEventListener("focus", trigger)
    window.addEventListener("online", trigger)
    const interval = window.setInterval(trigger, SESSION_WATCHDOG_INTERVAL_MS)

    return () => {
      window.removeEventListener("focus", trigger)
      window.removeEventListener("online", trigger)
      window.clearInterval(interval)
      controller.current?.abort()
      controller.current = null
      inFlight.current = null
    }
  }, [revalidate])

  return revalidate
}
