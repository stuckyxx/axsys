import "server-only"

import { ApiError } from "@/lib/http/api-error"
import { toMoney } from "@/lib/money/money"
import { createServerSupabase } from "@/lib/supabase/server"
import { z } from "@/lib/validation/zod"
import type { AccessContext } from "@/modules/auth/domain/access-context"

type CompanyContext = Extract<AccessContext, { kind: "company" }>

const CLIENT_COLUMNS = [
  "id",
  "legal_name",
  "trade_name",
  "cnpj_normalized",
  "segment",
  "email",
  "phone",
  "address_street",
  "address_number",
  "address_complement",
  "address_neighborhood",
  "municipality",
  "state",
  "postal_code",
  "archived_at",
  "version",
  "created_at",
  "updated_at",
].join(",")

const clientRowSchema = z
  .object({
    id: z.uuid(),
    legal_name: z.string().min(2).max(200),
    trade_name: z.string().min(2).max(200).nullable(),
    cnpj_normalized: z.string().regex(/^\d{14}$/u),
    segment: z.string().min(2).max(80),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address_street: z.string().nullable(),
    address_number: z.string().nullable(),
    address_complement: z.string().nullable(),
    address_neighborhood: z.string().nullable(),
    municipality: z.string().min(2).max(120),
    state: z.string().regex(/^[A-Z]{2}$/u),
    postal_code: z.string().regex(/^\d{8}$/u).nullable(),
    archived_at: z.iso.datetime({ offset: true }).nullable(),
    version: z.int().positive(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict()

const clientCursorSchema = z
  .object({ legalName: z.string().min(2).max(200), id: z.uuid() })
  .strict()

const aggregateRowSchema = z
  .object({
    record_count: z.coerce.number().int().nonnegative(),
    total: z.number().nullable(),
  })
  .strict()

const recentProposalSchema = z
  .object({
    id: z.uuid(),
    number: z.number().int().positive(),
    issued_on: z.string(),
    status: z.enum(["draft", "sent", "approved", "rejected"]),
    total: z.number().nonnegative(),
  })
  .strict()

const recentContractSchema = z
  .object({
    id: z.uuid(),
    number: z.string(),
    object: z.string(),
    starts_on: z.string(),
    ends_on: z.string(),
    amount: z.number().nonnegative(),
    closed_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()

export type ClientDTO = Readonly<{
  id: string
  legalName: string
  tradeName: string | null
  cnpj: string
  segment: string
  email: string | null
  phone: string | null
  address: Readonly<{
    street: string | null
    number: string | null
    complement: string | null
    neighborhood: string | null
    municipality: string
    state: string
    postalCode: string | null
  }>
  archivedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}>

export type ClientListItemDTO = ClientDTO &
  Readonly<{ proposalCount: number; contractCount: number }>

export type ClientDetailDTO = Readonly<{
  client: ClientDTO
  aggregates: Readonly<{
    proposalCount: number
    proposalTotal: string
    contractCount: number
    contractTotal: string
  }>
  recentProposals: readonly Readonly<{
    id: string
    number: number
    issuedOn: string
    status: "draft" | "sent" | "approved" | "rejected"
    total: string
  }>[]
  recentContracts: readonly Readonly<{
    id: string
    number: string
    object: string
    startsOn: string
    endsOn: string
    amount: string
    closedAt: string | null
  }>[]
}>

function mapClient(row: z.infer<typeof clientRowSchema>): ClientDTO {
  return {
    id: row.id,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    cnpj: row.cnpj_normalized,
    segment: row.segment,
    email: row.email,
    phone: row.phone,
    address: {
      street: row.address_street,
      number: row.address_number,
      complement: row.address_complement,
      neighborhood: row.address_neighborhood,
      municipality: row.municipality,
      state: row.state,
      postalCode: row.postal_code,
    },
    archivedAt: row.archived_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function encodeCursor(value: z.infer<typeof clientCursorSchema>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

function decodeCursor(value: string): z.infer<typeof clientCursorSchema> {
  try {
    return clientCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    )
  } catch {
    throw new ApiError("INVALID_CURSOR", 422, "Cursor inválido.")
  }
}

function quotedFilterValue(value: string): string {
  const likeLiteral = value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
  return `"${likeLiteral.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

export function buildClientPrefixFilter(search: string): string {
  const normalized = search.trim().toLocaleLowerCase("pt-BR")
  const pattern = quotedFilterValue(`${normalized}*`)
  const filters = [
    `legal_name.ilike.${pattern}`,
    `trade_name.ilike.${pattern}`,
  ]
  const digits = normalized.replace(/\D/gu, "")
  if (digits.length > 0) filters.push(`cnpj_normalized.like.${digits}*`)
  return filters.join(",")
}

function cursorFilter(cursor: z.infer<typeof clientCursorSchema>): string {
  const legalName = quotedFilterValue(cursor.legalName)
  return `legal_name.gt.${legalName},and(legal_name.eq.${legalName},id.gt.${cursor.id})`
}

export async function listClients(input: Readonly<{
  context: CompanyContext
  q?: string
  segment?: string
  archived?: boolean
  cursor?: string
  limit: number
}>): Promise<Readonly<{ items: readonly ClientListItemDTO[]; nextCursor: string | null }>> {
  const supabase = await createServerSupabase()
  const cursor = input.cursor ? decodeCursor(input.cursor) : null
  let query = supabase
    .from("clients")
    .select(`${CLIENT_COLUMNS},proposals(count),contracts(count)`)
    .eq("company_id", input.context.companyId)
    .order("legal_name", { ascending: true })
    .order("id", { ascending: true })
    .limit(input.limit + 1)

  if (input.segment) query = query.eq("segment", input.segment)
  if (input.archived === true) query = query.not("archived_at", "is", null)
  if (input.archived === false) query = query.is("archived_at", null)

  const searchFilter = input.q ? buildClientPrefixFilter(input.q) : null
  const afterFilter = cursor ? cursorFilter(cursor) : null
  if (searchFilter && afterFilter) {
    query = query.or(`and(or(${searchFilter}),or(${afterFilter}))`)
  } else if (searchFilter) {
    query = query.or(searchFilter)
  } else if (afterFilter) {
    query = query.or(afterFilter)
  }

  const { data, error } = await query
  if (error) throw new Error("Client list unavailable")

  const rows = z
    .array(
      clientRowSchema.extend({
        proposals: z.array(z.object({ count: z.number().int().nonnegative() }).strict()),
        contracts: z.array(z.object({ count: z.number().int().nonnegative() }).strict()),
      }),
    )
    .parse(data)
  const page = rows.slice(0, input.limit)
  const items = page.map((row) => ({
    ...mapClient(row),
    proposalCount: row.proposals[0]?.count ?? 0,
    contractCount: row.contracts[0]?.count ?? 0,
  }))
  const last = page.at(-1)
  return {
    items,
    nextCursor:
      rows.length > input.limit && last
        ? encodeCursor({ legalName: last.legal_name, id: last.id })
        : null,
  }
}

export async function getClientDetail(input: Readonly<{
  context: CompanyContext
  clientId: string
}>): Promise<ClientDetailDTO> {
  const supabase = await createServerSupabase()
  const clientResult = await supabase
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("company_id", input.context.companyId)
    .eq("id", input.clientId)
    .maybeSingle()
  if (clientResult.error) throw new Error("Client detail unavailable")
  if (!clientResult.data) {
    throw new ApiError("CLIENT_NOT_FOUND", 404, "Cliente não encontrado.")
  }
  const client = mapClient(clientRowSchema.parse(clientResult.data))

  const [proposalAggregate, proposalRecent, contractAggregate, contractRecent] =
    await Promise.all([
      supabase
        .from("proposal_client_aggregates")
        .select("record_count,total")
        .eq("company_id", input.context.companyId)
        .eq("client_id", input.clientId)
        .maybeSingle(),
      supabase
        .from("proposals")
        .select("id,number,issued_on,status,total")
        .eq("company_id", input.context.companyId)
        .eq("client_id", input.clientId)
        .order("issued_on", { ascending: false })
        .order("id", { ascending: false })
        .limit(5),
      supabase
        .from("contract_client_aggregates")
        .select("record_count,total")
        .eq("company_id", input.context.companyId)
        .eq("client_id", input.clientId)
        .maybeSingle(),
      supabase
        .from("contracts")
        .select("id,number,object,starts_on,ends_on,amount,closed_at")
        .eq("company_id", input.context.companyId)
        .eq("client_id", input.clientId)
        .order("ends_on", { ascending: false })
        .order("id", { ascending: false })
        .limit(5),
    ])

  if (
    proposalAggregate.error ||
    proposalRecent.error ||
    contractAggregate.error ||
    contractRecent.error
  ) {
    throw new Error("Client aggregates unavailable")
  }
  const proposalTotals = aggregateRowSchema.parse(
    proposalAggregate.data ?? { record_count: 0, total: null },
  )
  const contractTotals = aggregateRowSchema.parse(
    contractAggregate.data ?? { record_count: 0, total: null },
  )

  return {
    client,
    aggregates: {
      proposalCount: proposalTotals.record_count,
      proposalTotal: toMoney(proposalTotals.total ?? 0),
      contractCount: contractTotals.record_count,
      contractTotal: toMoney(contractTotals.total ?? 0),
    },
    recentProposals: recentProposalSchema.array().parse(proposalRecent.data).map((row) => ({
      id: row.id,
      number: row.number,
      issuedOn: row.issued_on,
      status: row.status,
      total: toMoney(row.total),
    })),
    recentContracts: recentContractSchema.array().parse(contractRecent.data).map((row) => ({
      id: row.id,
      number: row.number,
      object: row.object,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      amount: toMoney(row.amount),
      closedAt: row.closed_at,
    })),
  }
}
