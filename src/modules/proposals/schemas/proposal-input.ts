import { z } from "@/lib/validation/zod"

const MONEY_INPUT = /^\d{1,12}(?:\.\d{1,2})?$/u
const QUANTITY_INPUT = /^\d{1,9}(?:\.\d{1,3})?$/u

const commonLineShape = {
  catalogItemId: z.uuid(),
  description: z.string().trim().min(2).max(2_000),
} as const

const serviceLineSchema = z
  .object({
    kind: z.literal("service"),
    ...commonLineShape,
    months: z.int().positive(),
    monthlyAmount: z.string().regex(MONEY_INPUT),
  })
  .strict()

const productLineSchema = z
  .object({
    kind: z.literal("product"),
    ...commonLineShape,
    quantity: z
      .string()
      .regex(QUANTITY_INPUT)
      .refine((value) => /[1-9]/u.test(value), "Quantidade deve ser positiva."),
    unitAmount: z.string().regex(MONEY_INPUT),
  })
  .strict()

export const proposalLineSchema = z.discriminatedUnion("kind", [
  serviceLineSchema,
  productLineSchema,
])

export const proposalCreateSchema = z
  .object({
    clientId: z.uuid(),
    segment: z.string().trim().min(2).max(80),
    issuedOn: z.iso.date(),
    items: z.array(proposalLineSchema).min(1).max(100),
  })
  .strict()

export const proposalItemsSchema = z.array(proposalLineSchema).min(1).max(100)

export const proposalDetailsUpdateSchema = z
  .object({
    version: z.int().positive(),
    clientId: z.uuid(),
    segment: z.string().trim().min(2).max(80),
    issuedOn: z.iso.date(),
  })
  .strict()

export const proposalItemsUpdateSchema = z
  .object({
    version: z.int().positive(),
    items: proposalItemsSchema,
  })
  .strict()

export const proposalDraftUpdateSchema = z.union([
  proposalDetailsUpdateSchema,
  proposalItemsUpdateSchema,
])

export const proposalStatusUpdateSchema = z
  .object({
    expectedVersion: z.int().positive(),
    nextStatus: z.enum(["draft", "sent", "approved", "rejected"]),
  })
  .strict()

export const proposalDeleteSchema = z.object({ version: z.int().positive() }).strict()

export type ProposalLineInput = z.infer<typeof proposalLineSchema>
export type ProposalCreateInput = z.infer<typeof proposalCreateSchema>
export type ProposalDraftUpdateInput = z.infer<typeof proposalDraftUpdateSchema>
