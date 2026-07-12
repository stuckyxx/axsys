import "server-only"

import { bffDb, type UploadAuthorizationRetirementClaim } from "@/lib/db/bff"
import { getFileFinalizationStorage } from "@/modules/files/server/file-storage"

type DeleteErrorCode =
  | "FILE_QUARANTINE_DELETE_AMBIGUOUS"
  | "FILE_QUARANTINE_DELETE_FAILED"
  | "FILE_QUARANTINE_DELETE_UNAVAILABLE"

export type UploadRetirementDependencies = Readonly<{
  repository: Readonly<{
    claim(
      limit: number,
      workerId: string,
    ): Promise<UploadAuthorizationRetirementClaim[]>
    complete(input: {
      intentId: string
      claimId: string
      expectedVersion: number
    }): Promise<{ releasedBytes: number }>
    release(input: {
      intentId: string
      claimId: string
      expectedVersion: number
      errorCode: DeleteErrorCode
    }): Promise<number>
    cancelStaleReserved(limit: number): Promise<number>
  }>
  storage: Readonly<{
    removeQuarantine(path: string): Promise<void>
  }>
}>

export type UploadRetirementResult = Readonly<{
  claimed: number
  retired: number
  releasedClaims: number
  cancelledReserved: number
  releasedBytes: number
}>

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const DELETE_ERROR_CODES = new Set<DeleteErrorCode>([
  "FILE_QUARANTINE_DELETE_AMBIGUOUS",
  "FILE_QUARANTINE_DELETE_FAILED",
  "FILE_QUARANTINE_DELETE_UNAVAILABLE",
])
const RETIREMENT_FAILURE = "Upload retirement unavailable"

function deletionErrorCode(error: unknown): DeleteErrorCode {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    DELETE_ERROR_CODES.has(error.code as DeleteErrorCode)
  ) {
    return error.code as DeleteErrorCode
  }
  return "FILE_QUARANTINE_DELETE_AMBIGUOUS"
}

export async function retireUploadAuthorizations(
  deps: UploadRetirementDependencies,
  input: Readonly<{ workerId: string; limit: number }>,
): Promise<UploadRetirementResult> {
  if (!UUID.test(input.workerId) || !Number.isInteger(input.limit)) {
    throw new Error(RETIREMENT_FAILURE)
  }
  if (input.limit < 1 || input.limit > 100) {
    throw new Error(RETIREMENT_FAILURE)
  }

  const cancelledReserved = await deps.repository.cancelStaleReserved(
    input.limit,
  )
  const claims = await deps.repository.claim(input.limit, input.workerId)
  let retired = 0
  let releasedClaims = 0
  let releasedBytes = 0

  for (const claim of claims) {
    try {
      await deps.storage.removeQuarantine(claim.quarantineObjectPath)
    } catch (error) {
      await deps.repository.release({
        intentId: claim.intentId,
        claimId: claim.claimId,
        expectedVersion: claim.expectedVersion,
        errorCode: deletionErrorCode(error),
      })
      releasedClaims += 1
      continue
    }

    try {
      const completion = await deps.repository.complete({
        intentId: claim.intentId,
        claimId: claim.claimId,
        expectedVersion: claim.expectedVersion,
      })
      retired += 1
      releasedBytes += completion.releasedBytes
    } catch {
      // The delete-first claim stays leased; its idempotent retry is safe.
      throw new Error(RETIREMENT_FAILURE)
    }
  }

  return {
    claimed: claims.length,
    retired,
    releasedClaims,
    cancelledReserved,
    releasedBytes,
  }
}

export function getUploadRetirementDependencies(): UploadRetirementDependencies {
  const storage = getFileFinalizationStorage()
  return {
    repository: {
      claim: (limit, workerId) =>
        bffDb.claimUploadAuthorizationsForRetirement(limit, workerId),
      complete: (input) => bffDb.completeUploadAuthorizationRetirement(input),
      release: (input) =>
        bffDb.releaseUploadAuthorizationRetirementClaim(input),
      cancelStaleReserved: (limit) =>
        bffDb.cancelStaleReservedUploadIntents(limit),
    },
    storage: {
      removeQuarantine: (path) => storage.removeQuarantine(path),
    },
  }
}
