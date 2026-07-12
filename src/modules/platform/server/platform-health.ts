import "server-only"

import { bffDb, type PlatformHealthSnapshot } from "@/lib/db/bff"
import { getPublicEnv } from "@/lib/env/public"
import { getServerEnv } from "@/lib/env/server"

type PlatformIdentity = Readonly<{ userId: string; sessionId: string }>
type ProviderStatus = "healthy" | "degraded"

export type PlatformHealth = Readonly<{
  checkedAt: string
  database: ProviderStatus
  auth: ProviderStatus
  storage: ProviderStatus
  pendingCompensations: number
  pendingFileCleanup: number
  scanFailures: number
  storageBytes: number
  reservedStorageBytes: number
  companiesNearQuota: number
  quotaDriftAlerts: number
}>

type PlatformHealthDependencies = Readonly<{
  authProbe: () => Promise<boolean>
  storageProbe: () => Promise<boolean>
}>

const PROBE_TIMEOUT_MS = 3_000

async function fixedProviderProbe(
  path: "/auth/v1/health" | "/storage/v1/object/authenticated/axsys-private/.health/probe",
  acceptedStatuses: ReadonlySet<number>,
): Promise<boolean> {
  const baseUrl = getPublicEnv().NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/u, "")
  const secretKey = getServerEnv().SUPABASE_SECRET_KEY
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
    })
    try {
      await response.body?.cancel()
    } catch {
      // Probe status is enough; response bodies never cross the health boundary.
    }
    return acceptedStatuses.has(response.status)
  } catch {
    return false
  }
}

const defaultDependencies: PlatformHealthDependencies = Object.freeze({
  authProbe: () => fixedProviderProbe("/auth/v1/health", new Set([200])),
  storageProbe: () =>
    fixedProviderProbe(
      "/storage/v1/object/authenticated/axsys-private/.health/probe",
      new Set([200, 404]),
    ),
})

const emptyDatabaseHealth = (): PlatformHealthSnapshot => ({
  checkedAt: new Date().toISOString(),
  pendingCompensations: 0,
  pendingCompanyAccessReconciliations: 0,
  pendingMemberAccessReconciliations: 0,
  pendingFileCleanup: 0,
  scanFailures: 0,
  storageBytes: 0,
  reservedStorageBytes: 0,
  companiesNearQuota: 0,
  quotaDriftAlerts: 0,
})

export async function getPlatformHealth(
  identity: PlatformIdentity,
  dependencies: PlatformHealthDependencies = defaultDependencies,
): Promise<PlatformHealth> {
  const [databaseResult, authResult, storageResult] = await Promise.allSettled([
    bffDb.getPlatformHealth({
      actorUserId: identity.userId,
      sessionId: identity.sessionId,
    }),
    dependencies.authProbe(),
    dependencies.storageProbe(),
  ])
  const database =
    databaseResult.status === "fulfilled"
      ? databaseResult.value
      : emptyDatabaseHealth()
  return Object.freeze({
    checkedAt: database.checkedAt,
    database: databaseResult.status === "fulfilled" ? "healthy" : "degraded",
    auth:
      authResult.status === "fulfilled" && authResult.value
        ? "healthy"
        : "degraded",
    storage:
      storageResult.status === "fulfilled" && storageResult.value
        ? "healthy"
        : "degraded",
    pendingCompensations: database.pendingCompensations,
    pendingFileCleanup: database.pendingFileCleanup,
    scanFailures: database.scanFailures,
    storageBytes: database.storageBytes,
    reservedStorageBytes: database.reservedStorageBytes,
    companiesNearQuota: database.companiesNearQuota,
    quotaDriftAlerts: database.quotaDriftAlerts,
  })
}
