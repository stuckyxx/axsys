import { z } from "@/lib/validation/zod"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { withNoStore } from "@/lib/security/no-store"
import { createAuthorizedDownload } from "@/modules/files/server/authorize-file-download"
import { getImageDownloadRepository } from "@/modules/files/server/file-repository"
import { authorizeFileDownload } from "@/modules/files/server/file-route-security"
import { getPrivateDownloadStorage } from "@/modules/files/server/file-storage"

const fileIdSchema = z.uuid()

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const context = await authorizeFileDownload()
    const fileId = fileIdSchema.parse((await params).fileId)
    const response = await createAuthorizedDownload(
      {
        repository: getImageDownloadRepository(),
        storage: getPrivateDownloadStorage(),
      },
      { context, fileId, correlationId },
    )
    return withNoStore(response)
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
