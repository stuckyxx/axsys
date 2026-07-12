import { Buffer } from "node:buffer"

import sharp from "sharp"
import { beforeAll, describe, expect, it } from "vitest"

import { normalizeImage } from "@/modules/files/server/image-normalizer"

let avatarInput: Buffer
let letterheadInput: Buffer
let smallInput: Buffer

beforeAll(async () => {
  ;[avatarInput, letterheadInput, smallInput] = await Promise.all([
    sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 4,
        background: "#8b5cf6ff",
      },
    })
      .png()
      .withMetadata({ orientation: 1 })
      .toBuffer(),
    sharp({
      create: {
        width: 3000,
        height: 1200,
        channels: 3,
        background: "#0ea5e9",
      },
    })
      .jpeg()
      .toBuffer(),
    sharp({
      create: {
        width: 100,
        height: 50,
        channels: 3,
        background: "#f97316",
      },
    })
      .webp()
      .toBuffer(),
  ])
})

function animatedOnePixelGif(): Buffer {
  const headerAndPalette = Buffer.from(
    "47494638396101000100800000000000ffffff",
    "hex",
  )
  const frame = Buffer.from(
    "21f90400000000002c0000000001000100000202440100",
    "hex",
  )
  return Buffer.concat([headerAndPalette, frame, frame, Buffer.from("3b", "hex")])
}

describe("normalizeImage", () => {
  it("crops avatars to 512 square WebP and strips metadata", async () => {
    const output = await normalizeImage(avatarInput, "profile_avatar")
    const metadata = await sharp(output, { animated: true }).metadata()

    expect(metadata).toMatchObject({
      format: "webp",
      width: 512,
      height: 512,
    })
    expect(metadata.pages ?? 1).toBe(1)
    expect(metadata.exif).toBeUndefined()
    expect(metadata.icc).toBeUndefined()
    expect(metadata.xmp).toBeUndefined()
    expect(metadata.orientation).toBeUndefined()
  })

  it("fits institutional images inside 2400 square without distortion", async () => {
    const output = await normalizeImage(letterheadInput, "company_letterhead")

    await expect(sharp(output).metadata()).resolves.toMatchObject({
      format: "webp",
      width: 2400,
      height: 960,
    })
  })

  it("does not enlarge a smaller institutional image", async () => {
    const output = await normalizeImage(smallInput, "company_signature")

    await expect(sharp(output).metadata()).resolves.toMatchObject({
      format: "webp",
      width: 100,
      height: 50,
    })
  })

  it("produces deterministic bytes for the same validated input", async () => {
    const [first, second] = await Promise.all([
      normalizeImage(smallInput, "company_signature"),
      normalizeImage(smallInput, "company_signature"),
    ])

    expect(first).toEqual(second)
  })

  it("rejects animated images before transformation", async () => {
    await expect(
      normalizeImage(animatedOnePixelGif(), "profile_avatar"),
    ).rejects.toMatchObject({ code: "FILE_IMAGE_ANIMATED", status: 400 })
  })

  it("rejects an image whose declared canvas exceeds 40 megapixels", async () => {
    const oversizedSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="5001"><rect width="100%" height="100%"/></svg>',
      "utf8",
    )

    await expect(
      normalizeImage(oversizedSvg, "company_letterhead"),
    ).rejects.toMatchObject({
      code: "FILE_IMAGE_DIMENSIONS_INVALID",
      status: 400,
    })
  })

  it("fails closed for malformed bytes", async () => {
    await expect(
      normalizeImage(Buffer.from("not-an-image", "utf8"), "profile_avatar"),
    ).rejects.toMatchObject({ code: "FILE_IMAGE_INVALID", status: 400 })
  })
})
