"use client"

import type { QueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { queryKeys, type QueryScope } from "@/lib/query/query-keys"
import {
  openInvalidationChannel,
  type ClientInvalidation,
} from "@/lib/realtime/invalidation-channel"

type InvalidationClient = Pick<QueryClient, "clear" | "invalidateQueries">
type ReplaceLocation = (path: string) => void
type StopDocument = () => void
type MutationSyncOptions = Readonly<{ onInvalidate?: () => void }>

const RESOURCE_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,79}$/u
const MAX_RESOURCES = 32
const MAX_IDENTIFIER_LENGTH = 128

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort()
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  )
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    value === value.trim()
  )
}

function isDensePlainResources(value: unknown): value is string[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > MAX_RESOURCES ||
    Reflect.ownKeys(value).length !== value.length + 1 ||
    Object.keys(value).length !== value.length
  ) {
    return false
  }

  for (let index = 0; index < value.length; index += 1) {
    if (
      !Object.hasOwn(value, index) ||
      typeof value[index] !== "string" ||
      !RESOURCE_PATTERN.test(value[index])
    ) {
      return false
    }
  }
  return true
}

function readClientInvalidation(value: unknown): ClientInvalidation | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["resources", "scope", "senderId", "type"])
  ) {
    return null
  }
  if (
    (value.type !== "invalidate" && value.type !== "session-ended") ||
    !isIdentifier(value.senderId) ||
    !isRecord(value.scope) ||
    !hasExactKeys(value.scope, ["companyId", "userId"]) ||
    !isIdentifier(value.scope.userId) ||
    (value.scope.companyId !== null && !isIdentifier(value.scope.companyId)) ||
    !isDensePlainResources(value.resources) ||
    (value.type === "session-ended" && value.resources.length !== 0)
  ) {
    return null
  }

  return value as ClientInvalidation
}

function matchesScope(
  eventScope: ClientInvalidation["scope"],
  currentScope: QueryScope,
): boolean {
  return (
    eventScope.userId === currentScope.userId &&
    eventScope.companyId === currentScope.companyId
  )
}

export function publishInvalidation(event: ClientInvalidation): void {
  if (readClientInvalidation(event) === null) {
    throw new TypeError("Invalid invalidation signal")
  }
  if (typeof BroadcastChannel !== "function") return

  let channel: BroadcastChannel
  try {
    channel = openInvalidationChannel()
  } catch {
    return
  }
  try {
    channel.postMessage(event)
  } catch {
    // The committed mutation remains authoritative when cross-tab signaling fails.
  } finally {
    try {
      channel.close()
    } catch {
      // Closing an already-failed optional transport is best effort.
    }
  }
}

export function applyClientInvalidation(
  value: unknown,
  scope: QueryScope,
  queryClient: InvalidationClient,
  replaceLocation: ReplaceLocation = (path) => window.location.replace(path),
  onInvalidate?: () => void,
  stopDocument: StopDocument = () => window.stop(),
): void {
  const event = readClientInvalidation(value)
  if (event === null || !matchesScope(event.scope, scope)) return

  if (event.type === "session-ended") {
    queryClient.clear()
    try {
      stopDocument()
    } finally {
      replaceLocation("/login")
    }
    return
  }

  for (const resource of new Set(event.resources)) {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.resource(scope, resource),
    })
  }
  onInvalidate?.()
}

export function useMutationSync(
  scope: QueryScope,
  queryClient: InvalidationClient,
  { onInvalidate }: MutationSyncOptions = {},
): void {
  useEffect(() => {
    if (typeof BroadcastChannel !== "function") return

    let channel: BroadcastChannel
    try {
      channel = openInvalidationChannel()
    } catch {
      return
    }
    const receive = (event: MessageEvent<unknown>) => {
      applyClientInvalidation(
        event.data,
        scope,
        queryClient,
        undefined,
        onInvalidate,
      )
    }

    channel.addEventListener("message", receive)
    return () => {
      channel.removeEventListener("message", receive)
      try {
        channel.close()
      } catch {
        // Optional cross-tab transport cleanup is best effort.
      }
    }
  }, [onInvalidate, queryClient, scope])
}
