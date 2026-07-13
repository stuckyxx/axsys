import { Buffer } from "node:buffer"
import { describe, expect, it } from "vitest"

import {
  decodeContractCursor,
  encodeContractCursor,
} from "@/modules/contracts/domain/contract-cursor"

const cursor = { endsOn: "2026-08-25", id: "891bdc44-90f0-4638-b65e-f4d8d434b732" }

describe("contract cursor", () => {
  it("round-trips endsOn and UUID", () => {
    expect(decodeContractCursor(encodeContractCursor(cursor))).toEqual(cursor)
  })

  it.each([
    "***",
    Buffer.from(JSON.stringify({ endsOn: "2026-02-30", id: cursor.id })).toString("base64url"),
    Buffer.from(JSON.stringify({ ...cursor, extra: true })).toString("base64url"),
    Buffer.from(JSON.stringify({ ...cursor, id: "not-a-uuid" })).toString("base64url"),
  ])("maps malformed cursor to INVALID_CURSOR", (value) => {
    expect(() => decodeContractCursor(value)).toThrowError(expect.objectContaining({ code: "INVALID_CURSOR", status: 422 }))
  })
})
