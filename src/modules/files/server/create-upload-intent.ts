import "server-only"

import { ApiError } from "@/lib/http/api-error"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import type {
  EnabledImagePurpose,
  FilePurpose,
  UploadReservationDTO,
} from "@/modules/files/domain/file-types"
import { getUploadPolicy } from "@/modules/files/domain/upload-policy"

type CompanyAccessContext = Extract<AccessContext, { kind: "company" }>

export type CreateUploadIntentInput = Readonly<{
  context: CompanyAccessContext
  purpose: FilePurpose
  targetResourceId: string | null
  declaredName: string
  declaredMime: string
  declaredSize: number
  correlationId: string
}>

type ReservationInput = Readonly<{
  actorUserId: string
  sessionId: string
  purpose: EnabledImagePurpose
  targetResourceId: string | null
  declaredName: string
  declaredMime: string
  declaredSize: number
  correlationId: string
}>

type ActivationInput = Readonly<{
  actorUserId: string
  sessionId: string
  intentId: string
}>

type UploadAuthorization = Readonly<{
  uploadAuthorizationExpiresAt: string
  finalizeBefore: string
}>

export type CreateUploadIntentDependencies = Readonly<{
  repository: Readonly<{
    reserveImageUploadIntent(input: ReservationInput): Promise<UploadReservationDTO>
    activateFileUploadAuthorization(input: ActivationInput): Promise<UploadAuthorization>
  }>
  storage: Readonly<{
    createSignedUploadCapability(input: {
      bucket: "axsys-quarantine"
      path: string
      upsert: false
    }): Promise<Readonly<{ token: string }>>
  }>
  resumableEndpoint: string
}>

export type UploadHandshake = Readonly<{
  intentId: string
  endpoint: string
  bucket: "axsys-quarantine"
  path: string
  token: string
  uploadAuthorizationExpiresAt: string
  finalizeBefore: string
  maxBytes: number
  allowedMimeTypes: readonly string[]
}>

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

const MIME_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
})

function uploadError(code: string, status: number, message: string): ApiError {
  return new ApiError(code, status, message)
}

function declaredExtension(name: string): string | null {
  if (
    name.length < 3 ||
    name.length > 255 ||
    name !== name.trim() ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    return null
  }
  const separator = name.lastIndexOf(".")
  if (separator <= 0 || separator === name.length - 1) return null
  const extension = name.slice(separator + 1)
  return /^[A-Za-z0-9]{1,10}$/u.test(extension)
    ? extension.toLowerCase()
    : null
}

function validateDeclaration(
  input: CreateUploadIntentInput,
  maxBytes: number,
  allowedMimeTypes: readonly string[],
): void {
  if (!UUID_V4.test(input.correlationId)) {
    throw uploadError("REQUEST_INVALID", 400, "Solicitação inválida.")
  }
  if (!Number.isSafeInteger(input.declaredSize) || input.declaredSize <= 0) {
    throw uploadError("FILE_SIZE_INVALID", 400, "Tamanho de arquivo inválido.")
  }
  if (input.declaredSize > maxBytes) {
    throw uploadError("FILE_TOO_LARGE", 413, "O arquivo excede o tamanho permitido.")
  }
  if (!allowedMimeTypes.includes(input.declaredMime)) {
    throw uploadError(
      "FILE_TYPE_MISMATCH",
      400,
      "O tipo declarado não corresponde ao arquivo.",
    )
  }
  if (declaredExtension(input.declaredName) !== MIME_EXTENSION[input.declaredMime]) {
    throw uploadError(
      "FILE_EXTENSION_MISMATCH",
      400,
      "A extensão não corresponde ao tipo declarado.",
    )
  }
  if (input.targetResourceId !== null) {
    throw uploadError("REQUEST_INVALID", 400, "Solicitação inválida.")
  }
}

function assertReservation(
  reservation: UploadReservationDTO,
  input: CreateUploadIntentInput,
): void {
  const parts = reservation.quarantinePath.split("/")
  if (
    !UUID_V4.test(reservation.intentId) ||
    reservation.declaredSize !== input.declaredSize ||
    parts.length !== 4 ||
    parts[0] !== input.context.companyId ||
    parts[1] !== input.context.userId ||
    parts[2] !== reservation.intentId ||
    !UUID_V4.test(parts[3] ?? "")
  ) {
    throw uploadError(
      "UPLOAD_RESERVATION_INVALID",
      500,
      "Não foi possível reservar o upload.",
    )
  }
}

function assertAuthorization(authorization: UploadAuthorization): void {
  const expiresAt = Date.parse(authorization.uploadAuthorizationExpiresAt)
  const finalizeBefore = Date.parse(authorization.finalizeBefore)
  if (
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(finalizeBefore) ||
    finalizeBefore <= expiresAt
  ) {
    throw uploadError(
      "UPLOAD_AUTHORIZATION_INVALID",
      500,
      "Não foi possível autorizar o upload.",
    )
  }
}

function assertCapabilityToken(token: string): void {
  if (
    token.length < 1 ||
    token.length > 16_384 ||
    /[\u0000-\u001f\u007f]/u.test(token)
  ) {
    throw uploadError(
      "UPLOAD_AUTHORIZATION_INVALID",
      500,
      "Não foi possível autorizar o upload.",
    )
  }
}

export async function createUploadIntent(
  deps: CreateUploadIntentDependencies,
  input: CreateUploadIntentInput,
): Promise<UploadHandshake> {
  if (
    (input.purpose === "company_letterhead" ||
      input.purpose === "company_signature") &&
    input.context.role !== "company_admin" &&
    !input.context.modules.includes("administrative")
  ) {
    throw uploadError("FILE_FORBIDDEN", 403, "Operação não autorizada.")
  }
  const policy = getUploadPolicy(input.purpose)
  validateDeclaration(input, policy.maxBytes, policy.declaredMimeTypes)

  const reservation = await deps.repository.reserveImageUploadIntent({
    actorUserId: input.context.userId,
    sessionId: input.context.sessionId,
    purpose: input.purpose as EnabledImagePurpose,
    targetResourceId: input.targetResourceId,
    declaredName: input.declaredName,
    declaredMime: input.declaredMime,
    declaredSize: input.declaredSize,
    correlationId: input.correlationId,
  })
  assertReservation(reservation, input)

  // Activation is deliberately durable before capability signing. Once this
  // call starts, ambiguity is handled by retirement; quota is never cancelled.
  const authorization = await deps.repository.activateFileUploadAuthorization({
    actorUserId: input.context.userId,
    sessionId: input.context.sessionId,
    intentId: reservation.intentId,
  })
  assertAuthorization(authorization)

  const capability = await deps.storage.createSignedUploadCapability({
    bucket: "axsys-quarantine",
    path: reservation.quarantinePath,
    upsert: false,
  })
  assertCapabilityToken(capability.token)

  return Object.freeze({
    intentId: reservation.intentId,
    endpoint: deps.resumableEndpoint,
    bucket: "axsys-quarantine" as const,
    path: reservation.quarantinePath,
    token: capability.token,
    uploadAuthorizationExpiresAt: authorization.uploadAuthorizationExpiresAt,
    finalizeBefore: authorization.finalizeBefore,
    maxBytes: policy.maxBytes,
    allowedMimeTypes: policy.declaredMimeTypes,
  })
}
