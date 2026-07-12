import { randomUUID } from "node:crypto"

import { z } from "@/lib/validation/zod"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { withNoStore } from "@/lib/security/no-store"
import { getClamAvScanner } from "@/modules/files/server/clamav-client"
import { finalizeUploadIntent } from "@/modules/files/server/finalize-upload-intent"
import { getFileRepository } from "@/modules/files/server/file-repository"
import { getFileFinalizationStorage } from "@/modules/files/server/file-storage"
import { authorizeFileMutation } from "@/modules/files/server/file-route-security"
import { normalizeImage } from "@/modules/files/server/image-normalizer"

const intentIdSchema = z.uuid()

export async function POST(
  request: Request,
  { params }: { params: Promise<{ intentId: string }> },
): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const context = await authorizeFileMutation(request)
    const intentId = intentIdSchema.parse((await params).intentId)
    const file = await finalizeUploadIntent(
      {
        scanner: getClamAvScanner(),
        storage: getFileFinalizationStorage(),
        repository: getFileRepository(),
        transformer: Object.freeze({ toWebp: normalizeImage }),
        clock: () => new Date(),
        uuid: randomUUID,
      },
      { context, intentId, correlationId },
    )
    return withNoStore(Response.json(file))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
