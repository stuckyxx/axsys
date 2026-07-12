import { createHash } from "node:crypto"

import { fileTypeFromBuffer } from "file-type"

import { ApiError } from "@/lib/http/api-error"
import type {
  EnabledImagePurpose,
  FilePurpose,
  UploadPolicy,
  ValidatedFile,
} from "@/modules/files/domain/file-types"

const IMAGE_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
] as const)
const IMAGE_EXTENSIONS = Object.freeze(["jpg", "png", "webp"] as const)

function imagePolicy(): UploadPolicy {
  return Object.freeze({
    maxBytes: 5 * 1024 * 1024,
    declaredMimeTypes: IMAGE_MIME_TYPES,
    detectedMimeTypes: IMAGE_MIME_TYPES,
    detectedExtensions: IMAGE_EXTENSIONS,
    transform: "reencode-image" as const,
    outputMime: "image/webp",
    outputExtension: "webp",
  })
}

const IMAGE_POLICY = imagePolicy()
const ENABLED_POLICIES: Readonly<Record<EnabledImagePurpose, UploadPolicy>> =
  Object.freeze({
    profile_avatar: IMAGE_POLICY,
    company_letterhead: IMAGE_POLICY,
    company_signature: IMAGE_POLICY,
  })

function fileError(code: string, status: number, message: string): ApiError {
  return new ApiError(code, status, message)
}

function originalExtension(originalName: string): string | null {
  if (
    originalName.length < 3 ||
    originalName.length > 255 ||
    originalName !== originalName.trim() ||
    originalName.includes("/") ||
    originalName.includes("\\") ||
    originalName.includes("..") ||
    /[\u0000-\u001f\u007f]/u.test(originalName)
  ) {
    return null
  }

  const separator = originalName.lastIndexOf(".")
  if (separator <= 0 || separator === originalName.length - 1) return null

  const extension = originalName.slice(separator + 1)
  return /^[A-Za-z0-9]{1,10}$/u.test(extension)
    ? extension.toLowerCase()
    : null
}

export function getUploadPolicy(purpose: FilePurpose): UploadPolicy {
  if (Object.hasOwn(ENABLED_POLICIES, purpose)) {
    return ENABLED_POLICIES[purpose as EnabledImagePurpose]
  }

  throw fileError(
    "UPLOAD_PURPOSE_NOT_ENABLED",
    400,
    "Tipo de arquivo indisponível.",
  )
}

export async function validateFile(input: {
  purpose: FilePurpose
  originalName: string
  declaredMime: string
  bytes: Buffer
}): Promise<ValidatedFile> {
  const policy = getUploadPolicy(input.purpose)

  if (input.bytes.byteLength > policy.maxBytes) {
    throw fileError(
      "FILE_TOO_LARGE",
      413,
      "O arquivo excede o tamanho permitido.",
    )
  }
  if (!policy.declaredMimeTypes.includes(input.declaredMime)) {
    throw fileError(
      "FILE_TYPE_MISMATCH",
      400,
      "O tipo declarado não corresponde ao arquivo.",
    )
  }

  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>
  try {
    detected = await fileTypeFromBuffer(input.bytes)
  } catch {
    detected = undefined
  }
  if (
    detected === undefined ||
    !policy.detectedMimeTypes.includes(detected.mime) ||
    !policy.detectedExtensions.includes(detected.ext)
  ) {
    throw fileError(
      "FILE_MAGIC_BYTES_INVALID",
      400,
      "O conteúdo do arquivo não é reconhecido.",
    )
  }
  if (detected.mime !== input.declaredMime) {
    throw fileError(
      "FILE_TYPE_MISMATCH",
      400,
      "O tipo declarado não corresponde ao arquivo.",
    )
  }

  const extension = originalExtension(input.originalName)
  if (extension === null || extension !== detected.ext) {
    throw fileError(
      "FILE_EXTENSION_MISMATCH",
      400,
      "A extensão não corresponde ao conteúdo do arquivo.",
    )
  }

  return Object.freeze({
    detectedMime: detected.mime,
    extension: detected.ext,
    byteSize: input.bytes.byteLength,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
  })
}
