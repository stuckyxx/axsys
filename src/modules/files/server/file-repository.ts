import "server-only"

import { bffDb } from "@/lib/db/bff"
import type { CreateUploadIntentDependencies } from "@/modules/files/server/create-upload-intent"
import type { FileFinalizationRepository } from "@/modules/files/server/finalize-upload-intent"
import type { AuthorizedDownloadDependencies } from "@/modules/files/server/authorize-file-download"

export type FileRepository =
  CreateUploadIntentDependencies["repository"] & FileFinalizationRepository

export function getFileRepository(): FileRepository {
  return Object.freeze({
    async reserveImageUploadIntent(input) {
      return bffDb.reserveImageUploadIntent({
        actorUserId: input.actorUserId,
        sessionId: input.sessionId,
        purpose: input.purpose,
        declaredName: input.declaredName,
        declaredMime: input.declaredMime,
        declaredSize: input.declaredSize,
      })
    },

    async activateFileUploadAuthorization(input) {
      return bffDb.activateFileUploadAuthorization(input)
    },

    async beginFinalization(input) {
      return bffDb.beginFileFinalization({
        actorUserId: input.actorUserId,
        sessionId: input.sessionId,
        intentId: input.intentId,
      })
    },

    async commitReadyFile(input) {
      return bffDb.finalizeFileUpload(input)
    },

    async markCleanupRequired(input) {
      await bffDb.markFileCleanupRequired(input)
    },

    async rejectUpload(input) {
      await bffDb.rejectFileUpload(input)
    },

    async releaseForRetry(input) {
      await bffDb.releaseFileFinalizationForRetry(input)
    },
  })
}

export function getImageDownloadRepository(): AuthorizedDownloadDependencies["repository"] {
  return Object.freeze({
    authorizeImageDownload: (input) =>
      bffDb.authorizeImageFileDownload(input),
    completeDownloadAudit: (input) => bffDb.completeDownloadAudit(input),
  })
}
