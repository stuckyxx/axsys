import "server-only"

import { ApiError } from "@/lib/http/api-error"
import { createServerSupabase } from "@/lib/supabase/server"
import { z } from "@/lib/validation/zod"
import type { AccessContext } from "@/modules/auth/domain/access-context"

type CompanyContext = Extract<AccessContext, { kind: "company" }>

const CATALOG_COLUMNS = [
  "id",
  "item_kind",
  "segment",
  "name",
  "description",
  "archived_at",
  "version",
  "created_at",
  "updated_at",
].join(",")

const rowSchema = z
  .object({
    id: z.uuid(),
    item_kind: z.enum(["service", "product"]),
    segment: z.string().min(2).max(80),
    name: z.string().min(2).max(160),
    description: z.string().min(2).max(2000),
    archived_at: z.iso.datetime({ offset: true }).nullable(),
    version: z.int().positive(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict()

const cursorSchema = z.object({ name: z.string().min(2).max(160), id: z.uuid() }).strict()

export type CatalogItemDTO = Readonly<{
  id: string
  itemKind: "service" | "product"
  segment: string
  name: string
  description: string
  archivedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}>

export type CatalogListItemDTO = CatalogItemDTO & Readonly<{ proposalCount: number }>

function mapRow(row: z.infer<typeof rowSchema>): CatalogItemDTO {
  return {
    id: row.id,
    itemKind: row.item_kind,
    segment: row.segment,
    name: row.name,
    description: row.description,
    archivedAt: row.archived_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
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

function encodeCursor(value: z.infer<typeof cursorSchema>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

function quotedValue(value: string, prefix: boolean): string {
  const escaped = value
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
  return `"${escaped}${prefix ? "*" : ""}"`
}

export async function listCatalogItems(input: Readonly<{
  context: CompanyContext
  q?: string
  segment?: string
  itemKind?: "service" | "product"
  archived?: boolean
  cursor?: string
  limit: number
}>): Promise<Readonly<{ items: readonly CatalogListItemDTO[]; nextCursor: string | null }>> {
  const supabase = await createServerSupabase()
  const cursor = input.cursor ? decodeCursor(input.cursor) : null
  let query = supabase
    .from("catalog_items")
    .select(`${CATALOG_COLUMNS},proposal_items(count)`)
    .eq("company_id", input.context.companyId)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(input.limit + 1)

  if (input.segment) query = query.eq("segment", input.segment)
  if (input.itemKind) query = query.eq("item_kind", input.itemKind)
  if (input.archived === true) query = query.not("archived_at", "is", null)
  if (input.archived === false) query = query.is("archived_at", null)
  const search = input.q ? `name.ilike.${quotedValue(input.q, true)}` : null
  const after = cursor
    ? `name.gt.${quotedValue(cursor.name, false)},and(name.eq.${quotedValue(cursor.name, false)},id.gt.${cursor.id})`
    : null
  if (search && after) query = query.or(`and(or(${search}),or(${after}))`)
  else if (search) query = query.or(search)
  else if (after) query = query.or(after)

  const { data, error } = await query
  if (error) throw new Error("Catalog list unavailable")
  const rows = z
    .array(
      rowSchema.extend({
        proposal_items: z.array(
          z.object({ count: z.number().int().nonnegative() }).strict(),
        ),
      }),
    )
    .parse(data)
  const page = rows.slice(0, input.limit)
  const items = page.map((row) => ({
    ...mapRow(row),
    proposalCount: row.proposal_items[0]?.count ?? 0,
  }))
  const last = page.at(-1)
  return {
    items,
    nextCursor:
      rows.length > input.limit && last
        ? encodeCursor({ name: last.name, id: last.id })
        : null,
  }
}

export async function getCatalogItem(input: Readonly<{
  context: CompanyContext
  itemId: string
}>): Promise<CatalogItemDTO> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from("catalog_items")
    .select(CATALOG_COLUMNS)
    .eq("company_id", input.context.companyId)
    .eq("id", input.itemId)
    .maybeSingle()
  if (error) throw new Error("Catalog item unavailable")
  if (!data) throw new ApiError("CATALOG_ITEM_NOT_FOUND", 404, "Item não encontrado.")
  return mapRow(rowSchema.parse(data))
}
