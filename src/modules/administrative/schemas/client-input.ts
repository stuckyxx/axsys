import { z } from "@/lib/validation/zod"
import {
  isValidCnpj,
  normalizeCnpj,
} from "@/modules/administrative/domain/cnpj"

function trimmedText(min: number, max: number) {
  return z.string().trim().min(min).max(max)
}

function nullableTrimmedText(max: number) {
  return z.preprocess((value) => {
    if (value === undefined || value === null) return null
    if (typeof value !== "string") return value
    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
  }, z.string().max(max).nullable())
}

const cnpjSchema = z.string().transform(normalizeCnpj).refine(isValidCnpj, {
  message: "CNPJ inválido.",
})

const stateSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/u)

const postalCodeSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") return value
  const digits = value.replace(/\D/gu, "")
  return digits.length === 0 ? null : digits
}, z.string().regex(/^\d{8}$/u).nullable())

const emailSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") return value
  const normalized = value.trim().toLowerCase()
  return normalized.length === 0 ? null : normalized
}, z.email().max(254).nullable())

const clientShape = {
  legalName: trimmedText(2, 200),
  tradeName: nullableTrimmedText(200).refine(
    (value) => value === null || value.length >= 2,
    "Nome fantasia deve ter pelo menos 2 caracteres.",
  ),
  cnpj: cnpjSchema,
  segment: trimmedText(2, 80),
  email: emailSchema,
  phone: nullableTrimmedText(40),
  addressStreet: nullableTrimmedText(180),
  addressNumber: nullableTrimmedText(40),
  addressComplement: nullableTrimmedText(160),
  addressNeighborhood: nullableTrimmedText(120),
  municipality: trimmedText(2, 120),
  state: stateSchema,
  postalCode: postalCodeSchema,
} as const

export const clientCreateSchema = z.object(clientShape).strict()

export const clientUpdateSchema = z
  .object({ ...clientShape, version: z.int().positive() })
  .strict()

export type ClientCreateInput = z.infer<typeof clientCreateSchema>
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>
