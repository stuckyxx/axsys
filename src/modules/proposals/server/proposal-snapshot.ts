import "server-only"

import { z } from "@/lib/validation/zod"

const moneySchema = z.string().regex(/^\d{1,12}\.\d{2}$/u)
const quantitySchema = z.string().regex(/^\d{1,9}(?:\.\d{1,3})?$/u)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const nullableText = z.string().nullable()

const addressSchema = z
  .object({
    street: nullableText,
    number: nullableText,
    complement: nullableText,
    neighborhood: nullableText,
    municipality: z.string().min(2).max(120),
    state: z.string().regex(/^[A-Z]{2}$/u),
    postalCode: z.string().regex(/^\d{8}$/u).nullable(),
  })
  .strict()

const commonItemShape = {
  catalogItemId: z.uuid(),
  position: z.int().positive(),
  description: z.string().min(2).max(2_000),
  lineTotal: moneySchema,
} as const

const serviceItemSchema = z
  .object({
    ...commonItemShape,
    itemKind: z.literal("service"),
    months: z.int().positive(),
    monthlyAmount: moneySchema,
    quantity: z.null(),
    unitAmount: z.null(),
  })
  .strict()

const productItemSchema = z
  .object({
    ...commonItemShape,
    itemKind: z.literal("product"),
    months: z.null(),
    monthlyAmount: z.null(),
    quantity: quantitySchema,
    unitAmount: moneySchema,
  })
  .strict()

export const proposalDocumentSnapshotSchema = z
  .object({
    templateVersion: z.literal("proposal-v1"),
    generatedAt: z.iso.datetime({ offset: true }),
    proposal: z
      .object({
        number: z.int().positive(),
        status: z.enum(["draft", "sent", "approved", "rejected"]),
        issuedOn: z.iso.date(),
        total: moneySchema,
      })
      .strict(),
    company: z
      .object({
        legalName: z.string().min(2).max(200),
        tradeName: z.string().min(2).max(200).nullable(),
        cnpj: z.string().regex(/^\d{14}$/u),
        consolidatedAddress: z.string().nullable(),
        representative: z
          .object({
            name: z.string().min(2).max(160).nullable(),
            role: z.string().min(2).max(120).nullable(),
          })
          .strict(),
        branding: z
          .object({
            letterheadSha256: sha256Schema.nullable(),
            signatureSha256: sha256Schema.nullable(),
          })
          .strict(),
      })
      .strict(),
    client: z
      .object({
        legalName: z.string().min(2).max(200),
        tradeName: z.string().min(2).max(200).nullable(),
        cnpj: z.string().regex(/^\d{14}$/u),
        email: z.email().max(254).nullable(),
        phone: z.string().nullable(),
        address: addressSchema,
      })
      .strict(),
    items: z
      .array(z.discriminatedUnion("itemKind", [serviceItemSchema, productItemSchema]))
      .min(1)
      .max(100),
    author: z
      .object({
        displayName: z.string().min(1).max(120),
        email: z.email().max(254),
      })
      .strict(),
  })
  .strict()

export type ProposalDocumentSnapshot = z.infer<
  typeof proposalDocumentSnapshotSchema
>

export type ProposalSnapshotSource = Readonly<{
  proposal: ProposalDocumentSnapshot["proposal"]
  items: readonly Readonly<{
    catalogItemId: string
    itemKind: "service" | "product"
    position: number
    descriptionSnapshot: string
    months: number | null
    monthlyAmount: string | null
    quantity: string | null
    unitAmount: string | null
    lineTotal: string
  }>[]
  client: Readonly<{
    legalName: string
    tradeName: string | null
    cnpj: string
    email: string | null
    phone: string | null
    address: ProposalDocumentSnapshot["client"]["address"]
  }>
  company: Readonly<{
    legalName: string
    tradeName: string | null
    cnpj: string
    consolidatedAddress: string | null
    representativeName: string | null
    representativeRole: string | null
    letterheadSha256: string | null
    signatureSha256: string | null
  }>
  author: ProposalDocumentSnapshot["author"]
  templateVersion: "proposal-v1"
  generatedAt: string
}>

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

export function buildProposalDocumentSnapshot(
  source: ProposalSnapshotSource,
): ProposalDocumentSnapshot {
  const candidate = {
    templateVersion: source.templateVersion,
    generatedAt: source.generatedAt,
    proposal: {
      number: source.proposal.number,
      status: source.proposal.status,
      issuedOn: source.proposal.issuedOn,
      total: source.proposal.total,
    },
    company: {
      legalName: source.company.legalName,
      tradeName: source.company.tradeName,
      cnpj: source.company.cnpj,
      consolidatedAddress: source.company.consolidatedAddress,
      representative: {
        name: source.company.representativeName,
        role: source.company.representativeRole,
      },
      branding: {
        letterheadSha256: source.company.letterheadSha256,
        signatureSha256: source.company.signatureSha256,
      },
    },
    client: {
      legalName: source.client.legalName,
      tradeName: source.client.tradeName,
      cnpj: source.client.cnpj,
      email: source.client.email,
      phone: source.client.phone,
      address: {
        street: source.client.address.street,
        number: source.client.address.number,
        complement: source.client.address.complement,
        neighborhood: source.client.address.neighborhood,
        municipality: source.client.address.municipality,
        state: source.client.address.state,
        postalCode: source.client.address.postalCode,
      },
    },
    items: source.items.map((item) => ({
      catalogItemId: item.catalogItemId,
      itemKind: item.itemKind,
      position: item.position,
      description: item.descriptionSnapshot,
      months: item.months,
      monthlyAmount: item.monthlyAmount,
      quantity: item.quantity,
      unitAmount: item.unitAmount,
      lineTotal: item.lineTotal,
    })),
    author: {
      displayName: source.author.displayName,
      email: source.author.email,
    },
  }
  return deepFreeze(proposalDocumentSnapshotSchema.parse(candidate))
}
