import { z } from "@/lib/validation/zod"

const digitsSchema = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .regex(/^[0-9.\-/\s]+$/u)
    .transform((value) => value.replace(/\D/gu, ""))
    .pipe(z.string().min(minimum).max(maximum))

const editableBankAccountShape = {
  bankCode: digitsSchema(3, 8),
  bankName: z.string().trim().min(2).max(120),
  branch: digitsSchema(1, 16),
  account: digitsSchema(1, 32),
  accountType: z.enum(["checking", "savings", "payment"]),
  holderName: z.string().trim().min(2).max(160),
  holderDocument: z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    digitsSchema(11, 14).nullable(),
  ),
  makeDefault: z.boolean(),
} as const

export const createBankAccountSchema = z
  .object(editableBankAccountShape)
  .strict()

export const updateBankAccountSchema = z
  .object({
    ...editableBankAccountShape,
    version: z.int().positive(),
  })
  .strict()

export const bankAccountArchiveReasonCodeSchema = z.enum([
  "BANK_ARCHIVE_ACCOUNT_CLOSED",
  "BANK_ARCHIVE_BANK_CHANGED",
  "BANK_ARCHIVE_DATA_CORRECTION",
  "BANK_ARCHIVE_SECURITY_RESPONSE",
])

export const archiveBankAccountSchema = z
  .object({
    version: z.int().positive(),
    replacementDefaultId: z.uuid().nullable(),
    reasonCode: bankAccountArchiveReasonCodeSchema,
  })
  .strict()

export type CreateBankAccountInput = z.infer<typeof createBankAccountSchema>
export type UpdateBankAccountInput = z.infer<typeof updateBankAccountSchema>
export type BankAccountArchiveReasonCode = z.infer<
  typeof bankAccountArchiveReasonCodeSchema
>
