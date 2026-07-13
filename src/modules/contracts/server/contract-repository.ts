import "server-only"

import Decimal from "decimal.js"

import { bffDb } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import { createServerSupabase } from "@/lib/supabase/server"
import { z } from "@/lib/validation/zod"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import {
  decodeContractCursor,
  encodeContractCursor,
} from "@/modules/contracts/domain/contract-cursor"
import type {
  ContractCreateInput,
  ContractUpdateInput,
} from "@/modules/contracts/schemas/contract-input"

type CompanyContext = Extract<AccessContext, { kind: "company" }>
type ContractStatus = "closed" | "expired" | "expiring" | "active"

const timestamp = z.iso.datetime({ offset: true })
const numeric = z.union([z.string(), z.number()])
const rowSchema = z
  .object({
    id: z.uuid(),
    client_id: z.uuid(),
    number: z.string(),
    object: z.string(),
    starts_on: z.iso.date(),
    ends_on: z.iso.date(),
    amount: numeric,
    closed_at: timestamp.nullable(),
    close_reason: z.string().nullable(),
    version: z.int().positive(),
    created_at: timestamp,
    updated_at: timestamp,
    clients: z
      .object({ legal_name: z.string(), trade_name: z.string().nullable() })
      .strict(),
  })
  .strict()

const COLUMNS = [
  "id",
  "client_id",
  "number",
  "object",
  "starts_on",
  "ends_on",
  "amount",
  "closed_at",
  "close_reason",
  "version",
  "created_at",
  "updated_at",
  "clients!contracts_client_fk(legal_name,trade_name)",
].join(",")
const SEARCH_COLUMNS = [
  "id",
  "client_id",
  "number",
  "object",
  "starts_on",
  "ends_on",
  "amount",
  "closed_at",
  "close_reason",
  "version",
  "created_at",
  "updated_at",
  "client_legal_name",
  "client_trade_name",
].join(",")

const searchRowSchema = rowSchema
  .omit({ clients: true })
  .extend({
    client_legal_name: z.string(),
    client_trade_name: z.string().nullable(),
  })
  .strict()

export type ContractRawDTO = Readonly<{
  id: string
  clientId: string
  clientName: string
  number: string
  object: string
  startsOn: string
  endsOn: string
  amount: string
  closedAt: string | null
  closeReason: string | null
  version: number
  createdAt: string
  updatedAt: string
}>

type ContractMutationRecord = Awaited<
  ReturnType<typeof bffDb.createContract>
>["record"]

function mapRow(row: z.infer<typeof rowSchema>): ContractRawDTO {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.clients.trade_name ?? row.clients.legal_name,
    number: row.number,
    object: row.object,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    amount: new Decimal(String(row.amount)).toFixed(2),
    closedAt: row.closed_at,
    closeReason: row.close_reason,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSearchRow(row: z.infer<typeof searchRowSchema>): ContractRawDTO {
  return mapRow({
    ...row,
    clients: {
      legal_name: row.client_legal_name,
      trade_name: row.client_trade_name,
    },
  })
}

function mapMutationRecord(
  record: ContractMutationRecord,
  clientName: string,
): ContractRawDTO {
  return {
    ...record,
    clientName,
    amount: new Decimal(record.amount).toFixed(2),
  }
}

function prefixPattern(value: string): string {
  const escaped = value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
    .replaceAll("*", "\\*")
  return `${escaped}%`
}

async function getContractClientName(
  context: CompanyContext,
  clientId: string,
): Promise<string> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from("clients")
    .select("legal_name,trade_name")
    .eq("company_id", context.companyId)
    .eq("id", clientId)
    .maybeSingle()
  if (error) throw new Error("Contract client unavailable")
  if (!data) throw new ApiError("CLIENT_NOT_FOUND", 404, "Cliente não encontrado.")
  const client = z
    .object({ legal_name: z.string(), trade_name: z.string().nullable() })
    .strict()
    .parse(data)
  return client.trade_name ?? client.legal_name
}

function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00.000Z`)
  instant.setUTCDate(instant.getUTCDate() + days)
  return instant.toISOString().slice(0, 10)
}

export async function getCompanyTimezone(
  context: CompanyContext,
): Promise<string> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", context.companyId)
    .maybeSingle()
  if (error || !data) throw new Error("Company timezone unavailable")
  return z
    .object({ timezone: z.string().min(1).max(255) })
    .strict()
    .parse(data).timezone
}

export async function listContractRows(
  input: Readonly<{
    context: CompanyContext
    today: string
    q?: string
    clientId?: string
    status?: ContractStatus
    cursor?: string
    limit: number
  }>,
): Promise<
  Readonly<{ items: readonly ContractRawDTO[]; nextCursor: string | null }>
> {
  const supabase = await createServerSupabase()
  const cursor = input.cursor ? decodeContractCursor(input.cursor) : null
  const cutoff = addDays(input.today, 45)
  const buildQuery = (columns: string) => {
    let query = supabase
      .from("contracts")
      .select(columns)
      .eq("company_id", input.context.companyId)
      .order("ends_on", { ascending: true })
      .order("id", { ascending: true })
      .limit(input.limit + 1)
    if (input.clientId) query = query.eq("client_id", input.clientId)
    if (input.status === "closed") query = query.not("closed_at", "is", null)
    if (input.status === "expired")
      query = query.is("closed_at", null).lt("ends_on", input.today)
    if (input.status === "expiring")
      query = query
        .is("closed_at", null)
        .gte("ends_on", input.today)
        .lte("ends_on", cutoff)
    if (input.status === "active")
      query = query.is("closed_at", null).gt("ends_on", cutoff)
    if (cursor)
      query = query.or(
        `ends_on.gt.${cursor.endsOn},and(ends_on.eq.${cursor.endsOn},id.gt.${cursor.id})`,
      )
    return query
  }

  let rows: z.infer<typeof rowSchema>[]
  if (!input.q) {
    const result = await buildQuery(COLUMNS)
    if (result.error) throw new Error("Contract list unavailable")
    rows = z.array(rowSchema).parse(result.data)
  } else {
    const prefix = prefixPattern(input.q)
    const buildSearchQuery = () => {
      let query = supabase
        .from("contract_search_rows")
        .select(SEARCH_COLUMNS)
        .eq("company_id", input.context.companyId)
        .order("ends_on", { ascending: true })
        .order("id", { ascending: true })
        .limit(input.limit + 1)
      if (input.clientId) query = query.eq("client_id", input.clientId)
      if (input.status === "closed")
        query = query.not("closed_at", "is", null)
      if (input.status === "expired")
        query = query.is("closed_at", null).lt("ends_on", input.today)
      if (input.status === "expiring")
        query = query
          .is("closed_at", null)
          .gte("ends_on", input.today)
          .lte("ends_on", cutoff)
      if (input.status === "active")
        query = query.is("closed_at", null).gt("ends_on", cutoff)
      if (cursor)
        query = query.or(
          `ends_on.gt.${cursor.endsOn},and(ends_on.eq.${cursor.endsOn},id.gt.${cursor.id})`,
        )
      return query
    }
    const results = await Promise.all([
      buildSearchQuery().like("number_prefix", prefix),
      buildSearchQuery().like("object_prefix", prefix),
      buildSearchQuery().like("client_legal_name_prefix", prefix),
      buildSearchQuery().like("client_trade_name_prefix", prefix),
    ])
    if (results.some(({ error }) => error))
      throw new Error("Contract list unavailable")
    const merged = new Map<string, z.infer<typeof searchRowSchema>>()
    for (const result of results) {
      for (const row of z.array(searchRowSchema).parse(result.data)) {
        merged.set(row.id, row)
      }
    }
    const searchRows = [...merged.values()]
      .sort(
        (left, right) =>
          left.ends_on.localeCompare(right.ends_on) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, input.limit + 1)
    const page = searchRows.slice(0, input.limit)
    const last = page.at(-1)
    return {
      items: page.map(mapSearchRow),
      nextCursor:
        searchRows.length > input.limit && last
          ? encodeContractCursor({ endsOn: last.ends_on, id: last.id })
          : null,
    }
  }
  const page = rows.slice(0, input.limit)
  const last = page.at(-1)
  return {
    items: page.map(mapRow),
    nextCursor:
      rows.length > input.limit && last
        ? encodeContractCursor({ endsOn: last.ends_on, id: last.id })
        : null,
  }
}

export async function getContractRow(
  input: Readonly<{ context: CompanyContext; contractId: string }>,
): Promise<ContractRawDTO> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from("contracts")
    .select(COLUMNS)
    .eq("company_id", input.context.companyId)
    .eq("id", input.contractId)
    .maybeSingle()
  if (error) throw new Error("Contract unavailable")
  if (!data)
    throw new ApiError("CONTRACT_NOT_FOUND", 404, "Contrato não encontrado.")
  return mapRow(rowSchema.parse(data))
}

export async function contractHasAttachments(
  input: Readonly<{
    context: CompanyContext
    contractId: string
  }>,
): Promise<boolean> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from("contract_attachments")
    .select("id")
    .eq("company_id", input.context.companyId)
    .eq("contract_id", input.contractId)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error("Contract link state unavailable")
  return data !== null
}

export async function createContractRecord(
  input: Readonly<{
    context: CompanyContext
    input: ContractCreateInput
    correlationId: string
  }>,
) {
  const clientName = await getContractClientName(
    input.context,
    input.input.clientId,
  )
  const result = await bffDb.createContract({
    actorUserId: input.context.userId,
    sessionId: input.context.sessionId,
    input: input.input,
    correlationId: input.correlationId,
  })
  return {
    record: mapMutationRecord(result.record, clientName),
    scopes: result.scopes,
  }
}
export async function updateContractRecord(
  input: Readonly<{
    context: CompanyContext
    contractId: string
    input: ContractUpdateInput
    correlationId: string
  }>,
) {
  const clientName = await getContractClientName(
    input.context,
    input.input.clientId,
  )
  const { version, ...payload } = input.input
  const result = await bffDb.updateContract({
    actorUserId: input.context.userId,
    sessionId: input.context.sessionId,
    contractId: input.contractId,
    expectedVersion: version,
    input: payload,
    correlationId: input.correlationId,
  })
  return {
    record: mapMutationRecord(result.record, clientName),
    scopes: result.scopes,
  }
}
export async function closeContractRecord(
  input: Readonly<{
    context: CompanyContext
    contractId: string
    version: number
    reason: string
    correlationId: string
  }>,
) {
  const current = await getContractRow({
    context: input.context,
    contractId: input.contractId,
  })
  const result = await bffDb.closeContract({
    actorUserId: input.context.userId,
    sessionId: input.context.sessionId,
    contractId: input.contractId,
    expectedVersion: input.version,
    reason: input.reason,
    correlationId: input.correlationId,
  })
  return {
    record: mapMutationRecord(result.record, current.clientName),
    scopes: result.scopes,
  }
}
export function deleteContractRecord(
  input: Readonly<{
    context: CompanyContext
    contractId: string
    version: number
    correlationId: string
  }>,
) {
  return bffDb.deleteContract({
    actorUserId: input.context.userId,
    sessionId: input.context.sessionId,
    contractId: input.contractId,
    expectedVersion: input.version,
    correlationId: input.correlationId,
  })
}
