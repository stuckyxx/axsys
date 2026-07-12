import { z } from "@/lib/validation/zod"

const CANONICAL_TIMEZONES = new Set([
  "America/Araguaina",
  "America/Bahia",
  "America/Belem",
  "America/Boa_Vista",
  "America/Campo_Grande",
  "America/Cuiaba",
  "America/Fortaleza",
  "America/Maceio",
  "America/Manaus",
  "America/Noronha",
  "America/Porto_Velho",
  "America/Recife",
  "America/Rio_Branco",
  "America/Santarem",
  "America/Sao_Paulo",
])
const TIMEZONE_ALIASES = new Map([
  ["Brazil/Acre", "America/Rio_Branco"],
  ["Brazil/DeNoronha", "America/Noronha"],
  ["Brazil/East", "America/Sao_Paulo"],
  ["Brazil/West", "America/Manaus"],
])
const MODULE_ORDER = [
  "administrative",
  "financial",
  "certificates",
] as const

function isValidCnpj(value: string): boolean {
  if (!/^\d{14}$/u.test(value) || /^(\d)\1{13}$/u.test(value)) return false
  const calculate = (length: 12 | 13): number => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = weights.reduce(
      (total, weight, index) => total + Number(value[index]) * weight,
      0,
    )
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }
  return calculate(12) === Number(value[12]) && calculate(13) === Number(value[13])
}

const cnpjSchema = z
  .string()
  .transform((value) => value.replace(/\D/gu, ""))
  .refine(isValidCnpj, "CNPJ inválido.")

const timezoneSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z_]+(?:\/[A-Za-z_]+)+$/u)
  .transform((value, context) => {
    const canonical = TIMEZONE_ALIASES.get(value) ?? value
    if (!CANONICAL_TIMEZONES.has(canonical)) {
      context.addIssue({ code: "custom", message: "Fuso horário inválido." })
      return z.NEVER
    }
    return canonical
  })

const modulesSchema = z
  .array(z.enum(MODULE_ORDER))
  .max(3)
  .transform((modules) =>
    MODULE_ORDER.filter((module) => modules.includes(module)),
  )

const emailSchema = z.string().trim().toLowerCase().email().max(254)
const legalNameSchema = z.string().trim().min(2).max(160)
const tradeNameSchema = z.string().trim().min(2).max(180)
const phoneSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}, z.string().min(8).max(32).nullable())

export const createCompanySchema = z
  .object({
    legalName: legalNameSchema,
    tradeName: tradeNameSchema,
    cnpj: cnpjSchema,
    contactEmail: emailSchema,
    contactPhone: phoneSchema,
    timezone: timezoneSchema,
    firstAdmin: z
      .object({
        displayName: z.string().trim().min(2).max(120),
        email: emailSchema,
        temporaryPassword: z.string().min(1).max(128),
        modules: modulesSchema,
      })
      .strict(),
  })
  .strict()

export const updateCompanySchema = z
  .object({
    legalName: legalNameSchema,
    tradeName: tradeNameSchema,
    contactEmail: emailSchema,
    contactPhone: phoneSchema,
    timezone: timezoneSchema,
    version: z.int().positive(),
  })
  .strict()

export const companyListFiltersSchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    status: z.enum(["active", "archived"]).optional(),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()

export type CreateCompanyInput = z.infer<typeof createCompanySchema>
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>
export type CompanyListFilters = z.infer<typeof companyListFiltersSchema>
