import { toMoney } from "@/lib/money/money"
import { z } from "@/lib/validation/zod"

const MONEY_INPUT = /^\d{1,12}(?:\.\d{1,2})?$/u
const CONTRACT_STATUSES = ["closed", "expired", "expiring", "active"] as const

const moneySchema = z
  .string()
  .regex(MONEY_INPUT)
  .transform((value, context) => {
    try {
      return toMoney(value)
    } catch {
      context.addIssue({ code: "custom", message: "Valor monetário inválido." })
      return z.NEVER
    }
  })

const contractShape = {
  clientId: z.uuid(),
  number: z.string().trim().min(1).max(80),
  object: z.string().trim().min(3).max(4_000),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  amount: moneySchema,
} as const

function validDateRange(value: { startsOn: string; endsOn: string }): boolean {
  return value.endsOn >= value.startsOn
}

export const contractCreateSchema = z
  .object(contractShape)
  .strict()
  .refine(validDateRange, {
    message: "A data final deve ser igual ou posterior à data inicial.",
    path: ["endsOn"],
  })

export const contractUpdateSchema = z
  .object({ ...contractShape, version: z.int().positive() })
  .strict()
  .refine(validDateRange, {
    message: "A data final deve ser igual ou posterior à data inicial.",
    path: ["endsOn"],
  })

export const closeContractSchema = z
  .object({
    version: z.int().positive(),
    reason: z.string().trim().min(3).max(1_000),
  })
  .strict()

export const listContractSchema = z
  .object({
    q: z.string().trim().min(1).max(120).optional(),
    clientId: z.uuid().optional(),
    status: z.enum(CONTRACT_STATUSES).optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()

export type ContractCreateInput = z.infer<typeof contractCreateSchema>
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>
export type CloseContractInput = z.infer<typeof closeContractSchema>
export type ListContractInput = z.infer<typeof listContractSchema>
