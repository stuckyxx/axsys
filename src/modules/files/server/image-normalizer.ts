import "server-only"

import { ApiError } from "@/lib/http/api-error"
import type { EnabledImagePurpose } from "@/modules/files/domain/file-types"

const MAX_INPUT_PIXELS = 40_000_000
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"])

function imageError(code: string, message: string): ApiError {
  return new ApiError(code, 400, message)
}

export async function normalizeImage(
  buffer: Buffer,
  purpose: EnabledImagePurpose,
): Promise<Buffer> {
  const { default: sharp } = await import("sharp")

  try {
    const inspector = sharp(buffer, {
      animated: true,
      failOn: "warning",
      limitInputPixels: false,
    })
    const metadata = await inspector.metadata()
    const width = metadata.width
    const height = metadata.height

    if (
      width === undefined ||
      height === undefined ||
      width < 1 ||
      height < 1 ||
      width > MAX_INPUT_PIXELS / height
    ) {
      throw imageError(
        "FILE_IMAGE_DIMENSIONS_INVALID",
        "As dimensões da imagem não são permitidas.",
      )
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw imageError(
        "FILE_IMAGE_ANIMATED",
        "Imagens animadas não são permitidas.",
      )
    }
    if (metadata.format === undefined || !ALLOWED_FORMATS.has(metadata.format)) {
      throw imageError(
        "FILE_IMAGE_INVALID",
        "O conteúdo da imagem não é válido.",
      )
    }

    const dimensions =
      purpose === "profile_avatar"
        ? { width: 512, height: 512, fit: "cover" as const }
        : purpose === "company_letterhead" || purpose === "company_signature"
          ? { width: 2400, height: 2400, fit: "inside" as const }
          : null
    if (dimensions === null) {
      throw imageError(
        "UPLOAD_PURPOSE_NOT_ENABLED",
        "Tipo de arquivo indisponível.",
      )
    }

    return await sharp(buffer, {
      animated: false,
      failOn: "warning",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .resize({ ...dimensions, withoutEnlargement: true })
      .webp({ quality: 90, effort: 5 })
      .toBuffer()
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw imageError(
      "FILE_IMAGE_INVALID",
      "O conteúdo da imagem não é válido.",
    )
  }
}
