import "server-only"

import Decimal from "decimal.js"

import { bffDb } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import {
  calculateProductTotal,
  calculateProposalTotal,
  calculateServiceTotal,
} from "@/lib/money/money"
import { createServerSupabase } from "@/lib/supabase/server"
import { z } from "@/lib/validation/zod"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import type {
  ProposalCreateInput,
  ProposalLineInput,
} from "@/modules/proposals/schemas/proposal-input"

type CompanyContext = Extract<AccessContext, { kind: "company" }>
type ProposalStatus = "draft" | "sent" | "approved" | "rejected"

const numericSchema = z.union([z.string(), z.number()])
const timestampSchema = z.iso.datetime({ offset: true })

const proposalRowSchema = z
  .object({
    id: z.uuid(),
    client_id: z.uuid(),
    segment: z.string().min(2).max(80),
    number: z.int().positive(),
    issued_on: z.iso.date(),
    status: z.enum(["draft", "sent", "approved", "rejected"]),
    total: numericSchema,
    sent_at: timestampSchema.nullable(),
    version: z.int().positive(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
    clients: z
      .object({ legal_name: z.string(), trade_name: z.string().nullable() })
      .strict(),
  })
  .strict()

const proposalItemRowSchema = z
  .object({
    id: z.uuid(),
    catalog_item_id: z.uuid(),
    item_kind: z.enum(["service", "product"]),
    position: z.int().positive(),
    description_snapshot: z.string().min(2).max(2_000),
    months: z.int().positive().nullable(),
    monthly_amount: numericSchema.nullable(),
    quantity: numericSchema.nullable(),
    unit_amount: numericSchema.nullable(),
    line_total: numericSchema,
  })
  .strict()

const cursorSchema = z
  .object({ issuedOn: z.iso.date(), id: z.uuid() })
  .strict()

export type ProposalDTO = Readonly<{
  id: string
  clientId: string
  clientName: string
  segment: string
  number: number
  issuedOn: string
  status: ProposalStatus
  total: string
  sentAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}>

export type ProposalItemDTO = Readonly<{
  id: string
  catalogItemId: string
  itemKind: "service" | "product"
  position: number
  description: string
  months: number | null
  monthlyAmount: string | null
  quantity: string | null
  unitAmount: string | null
  lineTotal: string
}>

export type ProposalDetailDTO = Readonly<{
  proposal: ProposalDTO
  items: readonly ProposalItemDTO[]
}>

export type ProposalListItemDTO = ProposalDTO & Readonly<{ itemCount: number }>

const PROPOSAL_COLUMNS = [
  "id",
  "client_id",
  "segment",
  "number",
  "issued_on",
  "status",
  "total",
  "sent_at",
  "version",
  "created_at",
  "updated_at",
  "clients!proposals_client_segment_fk(legal_name,trade_name)",
].join(",")

const PROPOSAL_ITEM_COLUMNS = [
  "id",
  "catalog_item_id",
  "item_kind",
  "position",
  "description_snapshot",
  "months",
  "monthly_amount",
  "quantity",
  "unit_amount",
  "line_total",
].join(",")

function decimal(value: string | number, places: number): string {
  const parsed = new Decimal(String(value))
  if (!parsed.isFinite() || parsed.isNegative()) throw new Error("INVALID_DB_DECIMAL")
  return parsed.toFixed(places)
}

function mapProposal(row: z.infer<typeof proposalRowSchema>): ProposalDTO {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.clients.trade_name ?? row.clients.legal_name,
    segment: row.segment,
    number: row.number,
    issuedOn: row.issued_on,
    status: row.status,
    total: decimal(row.total, 2),
    sentAt: row.sent_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapProposalItem(row: z.infer<typeof proposalItemRowSchema>): ProposalItemDTO {
  return {
    id: row.id,
    catalogItemId: row.catalog_item_id,
    itemKind: row.item_kind,
    position: row.position,
    description: row.description_snapshot,
    months: row.months,
    monthlyAmount:
      row.monthly_amount === null ? null : decimal(row.monthly_amount, 2),
    quantity: row.quantity === null ? null : decimal(row.quantity, 3),
    unitAmount: row.unit_amount === null ? null : decimal(row.unit_amount, 2),
    lineTotal: decimal(row.line_total, 2),
  }
}

function encodeCursor(value: z.infer<typeof cursorSchema>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

function decodeCursor(value: string): z.infer<typeof cursorSchema> {
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    )
  } catch {
    throw new ApiError("INVALID_CURSOR", 422, "Cursor inválido.")
  }
}

function escapedPrefix(value: string): string {
  return value
    .trim()
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
}

function lineTotal(line: ProposalLineInput): string {
  return line.kind === "service"
    ? calculateServiceTotal(line.months, line.monthlyAmount)
    : calculateProductTotal(line.quantity, line.unitAmount)
}

export function assertProposalTotal(detail: ProposalDetailDTO): void {
  const expected = calculateProposalTotal(detail.items.map((item) => item.lineTotal))
  if (expected !== detail.proposal.total) {
    throw new ApiError(
      "INTERNAL_TOTAL_MISMATCH",
      503,
      "Os totais da proposta não puderam ser confirmados.",
    )
  }
}

export async function listProposals(input: Readonly<{
  context: CompanyContext
  q?: string
  clientId?: string
  segment?: string
  status?: ProposalStatus
  issuedFrom?: string
  issuedTo?: string
  cursor?: string
  limit: number
}>): Promise<Readonly<{ items: readonly ProposalListItemDTO[]; nextCursor: string | null }>> {
  const supabase = await createServerSupabase()
  const cursor = input.cursor ? decodeCursor(input.cursor) : null
  let matchingClientIds: string[] | null = null

  if (input.q && !/^\d{1,18}$/u.test(input.q)) {
    const prefix = `${escapedPrefix(input.q)}%`
    const { data, error } = await supabase
      .from("clients")
      .select("id")
      .eq("company_id", input.context.companyId)
      .or(`legal_name.ilike.${prefix},trade_name.ilike.${prefix}`)
      .limit(100)
    if (error) throw new Error("Proposal client search unavailable")
    matchingClientIds = z.array(z.object({ id: z.uuid() }).strict()).parse(data).map((row) => row.id)
    if (matchingClientIds.length === 0) return { items: [], nextCursor: null }
  }

  let query = supabase
    .from("proposals")
    .select(`${PROPOSAL_COLUMNS},proposal_items(count)`)
    .eq("company_id", input.context.companyId)
    .order("issued_on", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.limit + 1)

  if (input.clientId) query = query.eq("client_id", input.clientId)
  if (input.segment) query = query.eq("segment", input.segment)
  if (input.status) query = query.eq("status", input.status)
  if (input.issuedFrom) query = query.gte("issued_on", input.issuedFrom)
  if (input.issuedTo) query = query.lte("issued_on", input.issuedTo)
  if (input.q && /^\d{1,18}$/u.test(input.q)) {
    const number = Number(input.q)
    if (!Number.isSafeInteger(number) || number <= 0) return { items: [], nextCursor: null }
    query = query.eq("number", number)
  } else if (matchingClientIds) {
    query = query.in("client_id", matchingClientIds)
  }
  if (cursor) {
    query = query.or(
      `issued_on.lt.${cursor.issuedOn},and(issued_on.eq.${cursor.issuedOn},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await query
  if (error) throw new Error("Proposal list unavailable")
  const rows = z
    .array(
      proposalRowSchema.extend({
        proposal_items: z.array(
          z.object({ count: z.number().int().nonnegative() }).strict(),
        ),
      }),
    )
    .parse(data)
  const page = rows.slice(0, input.limit)
  const items = page.map((row) => ({
    ...mapProposal(row),
    itemCount: row.proposal_items[0]?.count ?? 0,
  }))
  const last = page.at(-1)
  return {
    items,
    nextCursor:
      rows.length > input.limit && last
        ? encodeCursor({ issuedOn: last.issued_on, id: last.id })
        : null,
  }
}

export async function getProposalDetail(input: Readonly<{
  context: CompanyContext
  proposalId: string
}>): Promise<ProposalDetailDTO> {
  const supabase = await createServerSupabase()
  const [{ data: proposalData, error: proposalError }, { data: itemData, error: itemError }] =
    await Promise.all([
      supabase
        .from("proposals")
        .select(PROPOSAL_COLUMNS)
        .eq("company_id", input.context.companyId)
        .eq("id", input.proposalId)
        .maybeSingle(),
      supabase
        .from("proposal_items")
        .select(PROPOSAL_ITEM_COLUMNS)
        .eq("company_id", input.context.companyId)
        .eq("proposal_id", input.proposalId)
        .order("position", { ascending: true }),
    ])
  if (proposalError || itemError) throw new Error("Proposal detail unavailable")
  if (!proposalData) {
    throw new ApiError("PROPOSAL_NOT_FOUND", 404, "Proposta não encontrada.")
  }
  const detail = {
    proposal: mapProposal(proposalRowSchema.parse(proposalData)),
    items: z.array(proposalItemRowSchema).parse(itemData).map(mapProposalItem),
  }
  assertProposalTotal(detail)
  return detail
}

export async function createProposalRecord(input: Readonly<{
  context: CompanyContext
  input: ProposalCreateInput
  correlationId: string
}>): Promise<ProposalDetailDTO> {
  const created = await bffDb.createProposal({
    actorUserId: input.context.userId,
    sessionId: input.context.sessionId,
    clientId: input.input.clientId,
    segment: input.input.segment,
    issuedOn: input.input.issuedOn,
    items: input.input.items,
    correlationId: input.correlationId,
  })
  const detail = await getProposalDetail({
    context: input.context,
    proposalId: created.record.proposal.id,
  })
  const inputTotal = calculateProposalTotal(input.input.items.map(lineTotal))
  if (inputTotal !== detail.proposal.total) {
    throw new ApiError(
      "INTERNAL_TOTAL_MISMATCH",
      503,
      "Os totais da proposta não puderam ser confirmados.",
    )
  }
  return detail
}

export async function updateProposalDetails(input: Readonly<{
  context: CompanyContext
  proposalId: string
  version: number
  clientId: string
  segment: string
  issuedOn: string
  correlationId: string
}>): Promise<ProposalDetailDTO> {
  await bffDb.updateDraftProposal({
    actorUserId: input.context.userId,
    sessionId: input.context.sessionId,
    proposalId: input.proposalId,
    expectedVersion: input.version,
    input: {
      clientId: input.clientId,
      segment: input.segment,
      issuedOn: input.issuedOn,
    },
    correlationId: input.correlationId,
  })
  return getProposalDetail({ context: input.context, proposalId: input.proposalId })
}

export async function replaceProposalItems(input: Readonly<{
  context: CompanyContext
  proposalId: string
  version: number
  items: readonly ProposalLineInput[]
  correlationId: string
}>): Promise<ProposalDetailDTO> {
  await bffDb.saveProposalItems({
    actorUserId: input.context.userId,
    sessionId: input.context.sessionId,
    proposalId: input.proposalId,
    expectedVersion: input.version,
    items: input.items,
    correlationId: input.correlationId,
  })
  const detail = await getProposalDetail({ context: input.context, proposalId: input.proposalId })
  const inputTotal = calculateProposalTotal(input.items.map(lineTotal))
  if (inputTotal !== detail.proposal.total) {
    throw new ApiError(
      "INTERNAL_TOTAL_MISMATCH",
      503,
      "Os totais da proposta não puderam ser confirmados.",
    )
  }
  return detail
}

export function transitionProposalRecord(input: Readonly<{
  context: CompanyContext
  proposalId: string
  expectedVersion: number
  nextStatus: ProposalStatus
  correlationId: string
}>) {
  return bffDb.transitionProposalStatus({
    actorUserId: input.context.userId,
    sessionId: input.context.sessionId,
    proposalId: input.proposalId,
    expectedVersion: input.expectedVersion,
    nextStatus: input.nextStatus,
    correlationId: input.correlationId,
  })
}

export function deleteProposalRecord(input: Readonly<{
  context: CompanyContext
  proposalId: string
  version: number
  correlationId: string
}>) {
  return bffDb.deleteDraftProposal({
    actorUserId: input.context.userId,
    sessionId: input.context.sessionId,
    proposalId: input.proposalId,
    expectedVersion: input.version,
    correlationId: input.correlationId,
  })
}

export async function proposalHasDocuments(input: Readonly<{
  context: CompanyContext
  proposalId: string
}>): Promise<boolean> {
  const supabase = await createServerSupabase()
  const { count, error } = await supabase
    .from("generated_documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", input.context.companyId)
    .eq("proposal_id", input.proposalId)
    .eq("kind", "proposal")
  if (error) throw new Error("Proposal document state unavailable")
  return (count ?? 0) > 0
}

export async function listProposalSelectors(input: Readonly<{
  context: CompanyContext
  segment: string
}>) {
  const supabase = await createServerSupabase()
  const [clients, catalog] = await Promise.all([
    supabase
      .from("clients")
      .select("id,legal_name,trade_name")
      .eq("company_id", input.context.companyId)
      .eq("segment", input.segment)
      .is("archived_at", null)
      .order("legal_name", { ascending: true })
      .limit(100),
    supabase
      .from("catalog_items")
      .select("id,item_kind,name,description")
      .eq("company_id", input.context.companyId)
      .eq("segment", input.segment)
      .is("archived_at", null)
      .order("name", { ascending: true })
      .limit(100),
  ])
  if (clients.error || catalog.error) throw new Error("Proposal selectors unavailable")
  return {
    clients: z
      .array(
        z
          .object({ id: z.uuid(), legal_name: z.string(), trade_name: z.string().nullable() })
          .strict(),
      )
      .parse(clients.data)
      .map((row) => ({ id: row.id, name: row.trade_name ?? row.legal_name })),
    catalogItems: z
      .array(
        z
          .object({
            id: z.uuid(),
            item_kind: z.enum(["service", "product"]),
            name: z.string(),
            description: z.string(),
          })
          .strict(),
      )
      .parse(catalog.data)
      .map((row) => ({
        id: row.id,
        itemKind: row.item_kind,
        name: row.name,
        description: row.description,
      })),
  }
}
