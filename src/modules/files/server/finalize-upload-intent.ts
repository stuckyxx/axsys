import "server-only"

import type { AccessContext } from "@/modules/auth/domain/access-context"
import { ApiError } from "@/lib/http/api-error"
import type {
  EnabledImagePurpose,
  FileObject,
} from "@/modules/files/domain/file-types"
import { getUploadPolicy, validateFile } from "@/modules/files/domain/upload-policy"
import type { MalwareScanner } from "@/modules/files/server/clamav-client"

type CompanyAccessContext = Extract<AccessContext, { kind: "company" }>

export type FinalizableUploadIntent = Readonly<{
  id: string
  companyId: string
  actorUserId: string
  purpose: EnabledImagePurpose
  quarantinePath: string
  declaredName: string
  declaredMime: string
  declaredSize: number
  cleanupNotBefore: string
}>

type FinalizationCommand = Readonly<{
  actorUserId: string
  sessionId: string
  intentId: string
}>

type RejectionReason =
  | "FILE_EXTENSION_MISMATCH"
  | "FILE_MAGIC_BYTES_INVALID"
  | "FILE_SIZE_MISMATCH"
  | "FILE_TYPE_MISMATCH"
  | "MALWARE_DETECTED"
  | "TRANSFORMED_FILE_INVALID"

type RetryReason =
  | "FILE_FINALIZATION_UNAVAILABLE"
  | "FILE_QUARANTINE_DOWNLOAD_FAILED"
  | "FILE_SCANNER_UNAVAILABLE"
  | "FILE_TRANSFORM_UNAVAILABLE"

type CleanupReason =
  | "FILE_METADATA_COMMIT_FAILED"
  | "FILE_PRIVATE_UPLOAD_AMBIGUOUS"

export type FileFinalizationRepository = Readonly<{
  beginFinalization(
    input: FinalizationCommand & { now: string },
  ): Promise<
    | Readonly<{ kind: "ready"; file: FileObject }>
    | Readonly<{ kind: "finalizing"; intent: FinalizableUploadIntent }>
  >
  commitReadyFile(input: {
    actorUserId: string
    sessionId: string
    intentId: string
    fileId: string
    objectPath: string
    detectedMime: string
    finalExtension: string
    byteSize: number
    sha256: string
    correlationId: string
  }): Promise<FileObject>
  markCleanupRequired(
    input: FinalizationCommand & { reasonCode: CleanupReason },
  ): Promise<void>
  rejectUpload(
    input: FinalizationCommand & { reasonCode: RejectionReason },
  ): Promise<void>
  releaseForRetry(
    input: FinalizationCommand & { reasonCode: RetryReason },
  ): Promise<void>
}>

export type FileFinalizationStorage = Readonly<{
  downloadQuarantine(path: string): Promise<Buffer>
  uploadPrivate(input: {
    path: string
    bytes: Buffer
    contentType: "image/webp"
    upsert: false
  }): Promise<void>
  removePrivate(path: string): Promise<void>
  removeQuarantine(path: string): Promise<void>
}>

export type FileFinalizationDependencies = Readonly<{
  scanner: MalwareScanner
  storage: FileFinalizationStorage
  repository: FileFinalizationRepository
  transformer: Readonly<{
    toWebp(buffer: Buffer, purpose: EnabledImagePurpose): Promise<Buffer>
  }>
  clock(): Date
  uuid(): string
}>

export type FinalizeUploadIntentInput = Readonly<{
  context: CompanyAccessContext
  intentId: string
  correlationId: string
}>

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function fileError(code: string, status: number, message: string): ApiError {
  return new ApiError(code, status, message)
}

function notFound(): ApiError {
  return fileError("FILE_NOT_FOUND", 404, "Arquivo não encontrado.")
}

function finalizationCommand(
  context: CompanyAccessContext,
  intentId: string,
): FinalizationCommand {
  return {
    actorUserId: context.userId,
    sessionId: context.sessionId,
    intentId,
  }
}

function hasValidIntentContract(
  intent: FinalizableUploadIntent,
  input: FinalizeUploadIntentInput,
  now: Date,
): boolean {
  const path = intent.quarantinePath.split("/")
  const cleanupTimestamp = Date.parse(intent.cleanupNotBefore)
  return (
    intent.id === input.intentId &&
    intent.companyId === input.context.companyId &&
    intent.actorUserId === input.context.userId &&
    path.length === 4 &&
    path[0] === input.context.companyId &&
    path[1] === input.context.userId &&
    path[2] === input.intentId &&
    UUID_V4.test(path[3] ?? "") &&
    Number.isFinite(cleanupTimestamp) &&
    cleanupTimestamp > now.getTime()
  )
}

function hasValidReadyFile(
  file: FileObject,
  context: CompanyAccessContext,
): boolean {
  return (
    file.companyId === context.companyId &&
    file.bucket === "axsys-private" &&
    file.status === "ready" &&
    file.scanStatus === "clean" &&
    file.objectPath.startsWith(`${context.companyId}/${file.purpose}/`)
  )
}

async function deleteRejectedQuarantine(
  storage: FileFinalizationStorage,
  path: string,
): Promise<void> {
  try {
    await storage.removeQuarantine(path)
  } catch {
    // The retained capability hold lets the exact-path cleaner retry safely.
  }
}

async function rejectUpload(
  deps: FileFinalizationDependencies,
  command: FinalizationCommand,
  intent: FinalizableUploadIntent,
  reasonCode: RejectionReason,
  error: ApiError,
): Promise<never> {
  await deps.repository.rejectUpload({ ...command, reasonCode })
  await deleteRejectedQuarantine(deps.storage, intent.quarantinePath)
  throw error
}

async function scanOrRelease(
  deps: FileFinalizationDependencies,
  command: FinalizationCommand,
  bytes: Buffer,
): Promise<"clean" | "infected"> {
  try {
    return await deps.scanner.scan(bytes)
  } catch (error) {
    await deps.repository.releaseForRetry({
      ...command,
      reasonCode: "FILE_SCANNER_UNAVAILABLE",
    })
    if (
      error instanceof ApiError &&
      error.code === "FILE_SCANNER_UNAVAILABLE"
    ) {
      throw error
    }
    throw fileError(
      "FILE_SCANNER_UNAVAILABLE",
      503,
      "A verificação de segurança está temporariamente indisponível.",
    )
  }
}

async function releaseForRetry(
  deps: FileFinalizationDependencies,
  command: FinalizationCommand,
  reasonCode: RetryReason,
  error: ApiError,
): Promise<never> {
  await deps.repository.releaseForRetry({ ...command, reasonCode })
  throw error
}

async function markAmbiguousPromotion(
  deps: FileFinalizationDependencies,
  command: FinalizationCommand,
  privatePath: string,
  reasonCode: CleanupReason,
): Promise<void> {
  try {
    await deps.storage.removePrivate(privatePath)
  } finally {
    await deps.repository.markCleanupRequired({ ...command, reasonCode })
  }
}

export async function finalizeUploadIntent(
  deps: FileFinalizationDependencies,
  input: FinalizeUploadIntentInput,
): Promise<FileObject> {
  const now = deps.clock()
  if (!Number.isFinite(now.getTime()) || !UUID_V4.test(input.intentId)) {
    throw notFound()
  }
  const command = finalizationCommand(input.context, input.intentId)
  const state = await deps.repository.beginFinalization({
    ...command,
    now: now.toISOString(),
  })

  if (state.kind === "ready") {
    if (!hasValidReadyFile(state.file, input.context)) throw notFound()
    return state.file
  }

  const uploadIntent = state.intent
  if (!hasValidIntentContract(uploadIntent, input, now)) throw notFound()
  const policy = getUploadPolicy(uploadIntent.purpose)
  let originalBytes: Buffer
  try {
    originalBytes = await deps.storage.downloadQuarantine(
      uploadIntent.quarantinePath,
    )
  } catch {
    return releaseForRetry(
      deps,
      command,
      "FILE_QUARANTINE_DOWNLOAD_FAILED",
      fileError(
        "FILE_STORAGE_UNAVAILABLE",
        503,
        "O armazenamento está temporariamente indisponível.",
      ),
    )
  }

  if (
    originalBytes.byteLength !== uploadIntent.declaredSize ||
    originalBytes.byteLength > policy.maxBytes
  ) {
    return rejectUpload(
      deps,
      command,
      uploadIntent,
      "FILE_SIZE_MISMATCH",
      fileError(
        "FILE_SIZE_MISMATCH",
        400,
        "O tamanho recebido não corresponde ao upload reservado.",
      ),
    )
  }

  try {
    await validateFile({
      purpose: uploadIntent.purpose,
      originalName: uploadIntent.declaredName,
      declaredMime: uploadIntent.declaredMime,
      bytes: originalBytes,
    })
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.code === "FILE_TYPE_MISMATCH" ||
        error.code === "FILE_EXTENSION_MISMATCH" ||
        error.code === "FILE_MAGIC_BYTES_INVALID")
    ) {
      return rejectUpload(
        deps,
        command,
        uploadIntent,
        error.code,
        error,
      )
    }
    throw error
  }

  const originalVerdict = await scanOrRelease(
    deps,
    command,
    originalBytes,
  )
  if (originalVerdict === "infected") {
    return rejectUpload(
      deps,
      command,
      uploadIntent,
      "MALWARE_DETECTED",
      fileError("FILE_INFECTED", 400, "O arquivo foi rejeitado por segurança."),
    )
  }

  let finalBytes: Buffer
  try {
    finalBytes = await deps.transformer.toWebp(
      originalBytes,
      uploadIntent.purpose,
    )
  } catch (error) {
    if (error instanceof ApiError) {
      return rejectUpload(
        deps,
        command,
        uploadIntent,
        "FILE_MAGIC_BYTES_INVALID",
        error,
      )
    }
    return releaseForRetry(
      deps,
      command,
      "FILE_TRANSFORM_UNAVAILABLE",
      fileError(
        "FILE_TRANSFORM_UNAVAILABLE",
        503,
        "O processamento da imagem está temporariamente indisponível.",
      ),
    )
  }

  const transformedVerdict = await scanOrRelease(
    deps,
    command,
    finalBytes,
  )
  if (transformedVerdict === "infected") {
    return rejectUpload(
      deps,
      command,
      uploadIntent,
      "MALWARE_DETECTED",
      fileError("FILE_INFECTED", 400, "O arquivo foi rejeitado por segurança."),
    )
  }

  const fileId = deps.uuid()
  if (!UUID_V4.test(fileId)) {
    return releaseForRetry(
      deps,
      command,
      "FILE_FINALIZATION_UNAVAILABLE",
      fileError(
        "FILE_FINALIZATION_UNAVAILABLE",
        500,
        "Não foi possível concluir o arquivo.",
      ),
    )
  }
  let finalMetadata: Awaited<ReturnType<typeof validateFile>>
  try {
    finalMetadata = await validateFile({
      purpose: uploadIntent.purpose,
      originalName: `${fileId}.${policy.outputExtension}`,
      declaredMime: policy.outputMime,
      bytes: finalBytes,
    })
  } catch (error) {
    if (error instanceof ApiError) {
      return rejectUpload(
        deps,
        command,
        uploadIntent,
        "TRANSFORMED_FILE_INVALID",
        error,
      )
    }
    return releaseForRetry(
      deps,
      command,
      "FILE_FINALIZATION_UNAVAILABLE",
      fileError(
        "FILE_FINALIZATION_UNAVAILABLE",
        500,
        "Não foi possível concluir o arquivo.",
      ),
    )
  }
  const privatePath = `${input.context.companyId}/${uploadIntent.purpose}/${fileId}.${finalMetadata.extension}`

  try {
    await deps.storage.uploadPrivate({
      path: privatePath,
      bytes: finalBytes,
      contentType: "image/webp",
      upsert: false,
    })
  } catch (error) {
    await markAmbiguousPromotion(
      deps,
      command,
      privatePath,
      "FILE_PRIVATE_UPLOAD_AMBIGUOUS",
    )
    throw error
  }

  try {
    return await deps.repository.commitReadyFile({
      ...command,
      fileId,
      objectPath: privatePath,
      detectedMime: finalMetadata.detectedMime,
      finalExtension: finalMetadata.extension,
      byteSize: finalMetadata.byteSize,
      sha256: finalMetadata.sha256,
      correlationId: input.correlationId,
    })
  } catch (error) {
    await markAmbiguousPromotion(
      deps,
      command,
      privatePath,
      "FILE_METADATA_COMMIT_FAILED",
    )
    throw error
  }
}
