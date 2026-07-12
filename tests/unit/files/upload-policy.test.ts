import { createHash } from "node:crypto"

import sharp from "sharp"
import { beforeAll, describe, expect, it } from "vitest"

import {
  getUploadPolicy,
  validateFile,
} from "@/modules/files/domain/upload-policy"

const FIVE_MEBIBYTES = 5 * 1024 * 1024

let jpegBytes: Buffer
let pngBytes: Buffer
let webpBytes: Buffer

beforeAll(async () => {
  const image = sharp({
    create: {
      width: 8,
      height: 8,
      channels: 4,
      background: "#0c2238ff",
    },
  })

  ;[jpegBytes, pngBytes, webpBytes] = await Promise.all([
    image.clone().jpeg().toBuffer(),
    image.clone().png().toBuffer(),
    image.clone().webp().toBuffer(),
  ])
})

describe("getUploadPolicy", () => {
  it.each([
    "profile_avatar",
    "company_letterhead",
    "company_signature",
  ] as const)("enables %s as a reencoded image of at most 5 MiB", (purpose) => {
    expect(getUploadPolicy(purpose)).toEqual({
      maxBytes: FIVE_MEBIBYTES,
      declaredMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      detectedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      detectedExtensions: ["jpg", "png", "webp"],
      transform: "reencode-image",
      outputMime: "image/webp",
      outputExtension: "webp",
    })
  })

  it.each([
    "contract_attachment",
    "payment_invoice",
    "certificate",
    "generated_document",
  ] as const)("fails closed for reserved purpose %s", (purpose) => {
    expect(() => getUploadPolicy(purpose)).toThrowError(
      expect.objectContaining({
        code: "UPLOAD_PURPOSE_NOT_ENABLED",
        status: 400,
      }),
    )
  })
})

describe("validateFile", () => {
  it.each([
    ["photo.jpg", "image/jpeg", "jpg", () => jpegBytes],
    ["photo.png", "image/png", "png", () => pngBytes],
    ["photo.webp", "image/webp", "webp", () => webpBytes],
  ] as const)(
    "derives trusted metadata for %s from the bytes",
    async (originalName, declaredMime, extension, bytes) => {
      const content = bytes()

      await expect(
        validateFile({
          purpose: "profile_avatar",
          originalName,
          declaredMime,
          bytes: content,
        }),
      ).resolves.toEqual({
        detectedMime: declaredMime,
        extension,
        byteSize: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
      })
    },
  )

  it("rejects a declared MIME that disagrees with magic bytes", async () => {
    await expect(
      validateFile({
        purpose: "profile_avatar",
        originalName: "photo.png",
        declaredMime: "image/png",
        bytes: jpegBytes,
      }),
    ).rejects.toMatchObject({ code: "FILE_TYPE_MISMATCH", status: 400 })
  })

  it.each([
    "photo.jpeg",
    "photo.png.exe",
    "photo",
    ".png",
    "folder/photo.png",
    "folder\\photo.png",
    "photo.png\r\nContent-Type: image/png",
  ])("rejects unsafe or mismatched original name %s", async (originalName) => {
    await expect(
      validateFile({
        purpose: "profile_avatar",
        originalName,
        declaredMime: "image/png",
        bytes: pngBytes,
      }),
    ).rejects.toMatchObject({ code: "FILE_EXTENSION_MISMATCH", status: 400 })
  })

  it("rejects invalid magic bytes without trusting the extension", async () => {
    await expect(
      validateFile({
        purpose: "profile_avatar",
        originalName: "photo.png",
        declaredMime: "image/png",
        bytes: Buffer.from("not-an-image", "utf8"),
      }),
    ).rejects.toMatchObject({ code: "FILE_MAGIC_BYTES_INVALID", status: 400 })
  })

  it("rejects oversize input before attempting type detection", async () => {
    await expect(
      validateFile({
        purpose: "profile_avatar",
        originalName: "photo.png",
        declaredMime: "image/png",
        bytes: Buffer.alloc(FIVE_MEBIBYTES + 1),
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE", status: 413 })
  })

  it("requires an exact allowlisted declared MIME", async () => {
    await expect(
      validateFile({
        purpose: "profile_avatar",
        originalName: "photo.png",
        declaredMime: "image/png; charset=binary",
        bytes: pngBytes,
      }),
    ).rejects.toMatchObject({ code: "FILE_TYPE_MISMATCH", status: 400 })
  })
})
