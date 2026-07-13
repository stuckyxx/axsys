import "server-only"

import { bffDb, type OwnProfileSnapshot } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import type { AccessContext } from "@/modules/auth/domain/access-context"

type Identity = Pick<AccessContext, "userId" | "sessionId">

function hasErrorToken(error: unknown, expected: string): boolean {
  if (typeof error !== "object" || error === null) return false
  return ["code", "message"].some(
    (key) => (error as Record<string, unknown>)[key] === expected,
  )
}

function mapProfileError(error: unknown): never {
  if (hasErrorToken(error, "AXSYS_PROFILE_VERSION_CONFLICT")) {
    throw new ApiError(
      "VERSION_CONFLICT",
      409,
      "O perfil foi alterado em outra sessão.",
    )
  }
  if (
    hasErrorToken(error, "AXSYS_PROFILE_AVATAR_INVALID") ||
    hasErrorToken(error, "AXSYS_PROFILE_AVATAR_FORBIDDEN") ||
    hasErrorToken(error, "AXSYS_PROFILE_PREVIOUS_AVATAR_INVALID")
  ) {
    throw new ApiError("FILE_NOT_FOUND", 404, "Arquivo não encontrado.")
  }
  if (hasErrorToken(error, "AXSYS_PROFILE_SESSION_INVALID")) {
    throw new ApiError("AUTH_REQUIRED", 401, "Faça login para continuar.")
  }
  throw error
}

export async function getOwnProfile(actor: Identity): Promise<OwnProfileSnapshot> {
  try {
    return await bffDb.getOwnProfile({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
    })
  } catch (error) {
    return mapProfileError(error)
  }
}

export async function updateOwnDisplayName(input: {
  actor: Identity
  displayName: string
  version: number
  correlationId: string
}): Promise<OwnProfileSnapshot> {
  try {
    return await bffDb.updateOwnProfile({
      actorUserId: input.actor.userId,
      sessionId: input.actor.sessionId,
      displayName: input.displayName,
      expectedVersion: input.version,
      correlationId: input.correlationId,
    })
  } catch (error) {
    return mapProfileError(error)
  }
}

export async function attachOwnAvatar(input: {
  actor: Identity
  fileId: string
  version: number
  correlationId: string
}): Promise<OwnProfileSnapshot> {
  try {
    return await bffDb.attachOwnAvatar({
      actorUserId: input.actor.userId,
      sessionId: input.actor.sessionId,
      fileId: input.fileId,
      expectedVersion: input.version,
      correlationId: input.correlationId,
    })
  } catch (error) {
    return mapProfileError(error)
  }
}
