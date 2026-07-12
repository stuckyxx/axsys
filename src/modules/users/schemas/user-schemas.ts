import { z } from "@/lib/validation/zod"
import { ADMINISTRATIVE_RESET_REASON_CODES } from "@/modules/auth/domain/administrative-reset-reason"

const MODULE_ORDER = [
  "administrative",
  "financial",
  "certificates",
] as const
const moduleSchema = z.enum(MODULE_ORDER)

const modulesSchema = z
  .array(moduleSchema)
  .transform((modules) =>
    MODULE_ORDER.filter((module) => modules.includes(module)),
  )
  .pipe(z.array(moduleSchema).max(3))

const displayNameSchema = z.string().trim().min(2).max(120)
const normalizedEmailSchema = z.string().trim().toLowerCase().email().max(254)
const passwordInputSchema = z.string().min(1).max(128)

export const createCompanyUserSchema = z
  .object({
    displayName: displayNameSchema,
    email: normalizedEmailSchema,
    temporaryPassword: passwordInputSchema,
    role: z.enum(["company_admin", "member"]),
    modules: modulesSchema,
  })
  .strict()

export const updateCompanyUserSchema = z
  .object({
    displayName: displayNameSchema,
    role: z.enum(["company_admin", "member"]),
    modules: modulesSchema,
    status: z.enum(["active", "suspended"]),
    suspensionReason: z.string().trim().min(10).max(500).nullable(),
    version: z.int().positive(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.status === "suspended" && input.suspensionReason === null) {
      context.addIssue({
        code: "custom",
        message: "Informe o motivo da suspensão.",
        path: ["suspensionReason"],
      })
    }
    if (input.status === "active" && input.suspensionReason !== null) {
      context.addIssue({
        code: "custom",
        message: "Remova o motivo para ativar o acesso.",
        path: ["suspensionReason"],
      })
    }
  })

export const temporaryPasswordResetSchema = z
  .object({
    temporaryPassword: passwordInputSchema,
    reasonCode: z.enum(ADMINISTRATIVE_RESET_REASON_CODES),
  })
  .strict()

export type CreateCompanyUserInput = z.infer<typeof createCompanyUserSchema>
export type UpdateCompanyUserInput = z.infer<typeof updateCompanyUserSchema>
export type TemporaryPasswordResetInput = z.infer<
  typeof temporaryPasswordResetSchema
>
