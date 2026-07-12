import { z } from "@/lib/validation/zod"

const BRAZILIAN_STATES = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT",
  "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO",
  "RR", "SC", "SP", "SE", "TO",
])

function nullableText(maxLength: number) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value
    const trimmed = value.trim()
    return trimmed.length === 0 ? null : trimmed
  }, z.string().max(maxLength).nullable())
}

function digits(value: unknown): unknown {
  return typeof value === "string" ? value.replace(/\D/gu, "") : value
}

function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/u.test(value) || /^(\d)\1{10}$/u.test(value)) return false
  const calculate = (length: number): number => {
    let sum = 0
    for (let index = 0; index < length; index += 1) {
      sum += Number(value[index]) * (length + 1 - index)
    }
    const remainder = (sum * 10) % 11
    return remainder === 10 ? 0 : remainder
  }
  return calculate(9) === Number(value[9]) && calculate(10) === Number(value[10])
}

const representativeDocumentSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === "") return null
    return digits(value)
  },
  z.string().refine(isValidCpf, "CPF inválido.").nullable(),
)

const stateSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value
  const normalized = value.trim().toUpperCase()
  return normalized.length === 0 ? null : normalized
}, z.string().length(2).refine((value) => BRAZILIAN_STATES.has(value)).nullable())

const postalCodeSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === "") return null
    return digits(value)
  },
  z.string().regex(/^\d{8}$/u).nullable(),
)

const editableCompanySettingsShape = {
  representativeName: nullableText(160),
  representativeRole: nullableText(120),
  representativeDocument: representativeDocumentSchema,
  taxRate: z.number().min(0).max(100).multipleOf(0.01),
  addressStreet: nullableText(180),
  addressNumber: nullableText(30),
  addressComplement: nullableText(120),
  addressNeighborhood: nullableText(120),
  addressCity: nullableText(120),
  addressState: stateSchema,
  addressPostalCode: postalCodeSchema,
  letterheadFileId: z.uuid().nullable(),
  signatureFileId: z.uuid().nullable(),
} as const

export const companySettingsSchema = z
  .object({
    ...editableCompanySettingsShape,
    version: z.int().positive(),
  })
  .strict()

export const companySettingsDraftSchema = z
  .object({
    ...editableCompanySettingsShape,
    baseVersion: z.int().positive(),
  })
  .strict()

export const companySettingsDtoSchema = z
  .object({
    representativeName: z.string().nullable(),
    representativeRole: z.string().nullable(),
    representativeDocumentLast4: z.string().regex(/^\d{4}$/u).nullable(),
    taxRate: z.number().min(0).max(100),
    addressStreet: z.string().nullable(),
    addressNumber: z.string().nullable(),
    addressComplement: z.string().nullable(),
    addressNeighborhood: z.string().nullable(),
    addressCity: z.string().nullable(),
    addressState: z.string().length(2).nullable(),
    addressPostalCode: z.string().regex(/^\d{8}$/u).nullable(),
    consolidatedAddress: z.string().nullable(),
    letterheadFileId: z.uuid().nullable(),
    signatureFileId: z.uuid().nullable(),
    version: z.int().positive(),
    updatedAt: z.iso.datetime(),
  })
  .strict()

export type CompanySettingsInput = z.infer<typeof companySettingsSchema>
export type CompanySettingsDraftInput = z.infer<
  typeof companySettingsDraftSchema
>

type AddressPreviewInput = Readonly<{
  street: string | null
  number: string | null
  complement: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  postalCode: string | null
}>

export function formatCompanyAddressPreview(input: AddressPreviewInput): string {
  const streetLine = [input.street, input.number].filter(Boolean).join(", ")
  const locality =
    input.city && input.state
      ? `${input.city}/${input.state}`
      : (input.city ?? input.state ?? "")
  const postalCode = input.postalCode
    ? `CEP ${input.postalCode.slice(0, 5)}-${input.postalCode.slice(5)}`
    : ""
  return [streetLine, input.complement, input.neighborhood, locality, postalCode]
    .filter(Boolean)
    .join(" · ")
}
