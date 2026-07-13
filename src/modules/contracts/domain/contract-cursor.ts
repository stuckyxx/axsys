import { Buffer } from "node:buffer"

import { ApiError } from "@/lib/http/api-error"
import { z } from "@/lib/validation/zod"

const contractCursorSchema = z
  .object({
    endsOn: z.iso.date(),
    id: z.uuid(),
  })
  .strict()

export type ContractCursor = z.infer<typeof contractCursorSchema>

function invalidCursor(): ApiError {
  return new ApiError("INVALID_CURSOR", 422, "Cursor inválido.")
}

export function encodeContractCursor(value: ContractCursor): string {
  const parsed = contractCursorSchema.safeParse(value)
  if (!parsed.success) throw invalidCursor()
  return Buffer.from(JSON.stringify(parsed.data), "utf8").toString("base64url")
}

export function decodeContractCursor(value: string): ContractCursor {
  try {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 512 ||
      !/^[A-Za-z0-9_-]+$/u.test(value)
    ) {
      throw invalidCursor()
    }
    const bytes = Buffer.from(value, "base64url")
    if (bytes.toString("base64url") !== value) throw invalidCursor()
    return contractCursorSchema.parse(JSON.parse(bytes.toString("utf8")))
  } catch {
    throw invalidCursor()
  }
}
