import { z } from "@/lib/validation/zod"
import { ADMINISTRATIVE_RESET_REASON_CODES } from "@/modules/auth/domain/administrative-reset-reason"

const email = z.string().trim().toLowerCase().email().max(254)
const password = z.string().min(1).max(128)

export const loginSchema = z
  .object({
    email,
    password,
    rememberMe: z.boolean().default(false),
  })
  .strict()

export const changePasswordSchema = z
  .object({
    password,
    confirmation: password,
  })
  .strict()
  .refine((value) => value.password === value.confirmation, {
    message: "As senhas não coincidem.",
    path: ["confirmation"],
  })

export const forgotPasswordSchema = z.object({ email }).strict()

export const temporaryPasswordSchema = z
  .object({
    targetUserId: z.uuid(),
    password,
    reasonCode: z.enum(ADMINISTRATIVE_RESET_REASON_CODES),
  })
  .strict()

export const themeSchema = z
  .object({
    theme: z.enum(["dark", "light"]),
    version: z.int().positive(),
  })
  .strict()
