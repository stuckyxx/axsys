import { z } from "@/lib/validation/zod"
import { getCorrelationId } from "@/lib/http/correlation-id"
import { toErrorResponse } from "@/lib/http/error-response"
import { withNoStore } from "@/lib/security/no-store"
import { createUploadIntent } from "@/modules/files/server/create-upload-intent"
import { getFileRepository } from "@/modules/files/server/file-repository"
import {
  getResumableUploadEndpoint,
  getUploadCapabilityStorage,
} from "@/modules/files/server/file-storage"
import { authorizeFileMutation } from "@/modules/files/server/file-route-security"
import { requireRecentAuthentication } from "@/modules/auth/server/guards"

const createUploadSchema = z
  .object({
    purpose: z.enum([
      "profile_avatar",
      "company_letterhead",
      "company_signature",
    ]),
    targetResourceId: z.null(),
    declaredName: z.string().min(3).max(255),
    declaredMime: z.enum(["image/jpeg", "image/png", "image/webp"]),
    declaredSize: z.int().positive().max(5 * 1024 * 1024),
  })
  .strict()

export async function POST(request: Request): Promise<Response> {
  const correlationId = getCorrelationId(request)
  try {
    const context = await authorizeFileMutation(request)
    const input = createUploadSchema.parse(await request.json())
    if (
      input.purpose === "company_letterhead" ||
      input.purpose === "company_signature"
    ) {
      requireRecentAuthentication(context, 600)
    }
    const handshake = await createUploadIntent(
      {
        repository: getFileRepository(),
        storage: getUploadCapabilityStorage(),
        resumableEndpoint: getResumableUploadEndpoint(),
      },
      { context, correlationId, ...input },
    )
    return withNoStore(Response.json(handshake, { status: 201 }))
  } catch (error) {
    return toErrorResponse(error, correlationId)
  }
}
