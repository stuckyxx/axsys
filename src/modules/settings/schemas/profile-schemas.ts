import { z } from "@/lib/validation/zod"

const displayNameSchema = z
  .string()
  .trim()
  .min(2, "Informe um nome com pelo menos 2 caracteres.")
  .max(120, "O nome deve ter no máximo 120 caracteres.")
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), {
    message: "O nome contém caracteres inválidos.",
  })

const profileVersionSchema = z.int().positive()

export const profileUpdateSchema = z
  .object({
    displayName: displayNameSchema,
    version: profileVersionSchema,
  })
  .strict()

export const profileAvatarSchema = z
  .object({
    fileId: z.uuid(),
    version: profileVersionSchema,
  })
  .strict()

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>
export type ProfileAvatarInput = z.infer<typeof profileAvatarSchema>
