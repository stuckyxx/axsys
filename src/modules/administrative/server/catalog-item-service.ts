import "server-only"

import { bffDb } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import {
  catalogItemCreateSchema,
  catalogItemUpdateSchema,
  type CatalogItemCreateInput,
  type CatalogItemUpdateInput,
} from "@/modules/administrative/schemas/catalog-item-input"
import {
  getCatalogItem as readCatalogItem,
  listCatalogItems as readCatalogItems,
} from "@/modules/administrative/server/catalog-item-repository"

type CompanyContext = Extract<AccessContext, { kind: "company" }>

function errorToken(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  const value = error as Record<string, unknown>
  return typeof value.message === "string"
    ? value.message
    : typeof value.code === "string"
      ? value.code
      : null
}

function mapCatalogError(error: unknown): never {
  const token = errorToken(error)
  if (
    token === "AXSYS_CATALOG_ITEM_NOT_FOUND" ||
    token === "AXSYS_ADMINISTRATIVE_CATALOG_NOT_FOUND"
  ) {
    throw new ApiError("CATALOG_ITEM_NOT_FOUND", 404, "Item não encontrado.")
  }
  if (
    token === "AXSYS_CATALOG_ITEM_VERSION_CONFLICT" ||
    token === "AXSYS_VERSION_CONFLICT"
  ) {
    throw new ApiError(
      "VERSION_CONFLICT",
      409,
      "O item foi alterado por outra sessão.",
    )
  }
  if (
    token === "AXSYS_CATALOG_ITEM_IN_USE" ||
    token === "AXSYS_RESOURCE_IN_USE" ||
    token === "23503"
  ) {
    throw new ApiError(
      "RESOURCE_IN_USE",
      409,
      "O item possui vínculos e não pode ser excluído.",
    )
  }
  if (token === "23505" || token === "AXSYS_CATALOG_ITEM_CONFLICT") {
    throw new ApiError(
      "CATALOG_ITEM_CONFLICT",
      409,
      "Já existe um item ativo com este nome no segmento.",
    )
  }
  throw error
}

function identity(context: CompanyContext) {
  return { actorUserId: context.userId, sessionId: context.sessionId }
}

export function listCatalogItems(input: Readonly<{
  context: CompanyContext
  q?: string
  segment?: string
  itemKind?: "service" | "product"
  archived?: boolean
  cursor?: string
  limit: number
}>) {
  return readCatalogItems(input)
}

export function getCatalogItem(input: Readonly<{
  context: CompanyContext
  itemId: string
}>) {
  return readCatalogItem(input)
}

export async function createCatalogItem(input: Readonly<{
  context: CompanyContext
  input: CatalogItemCreateInput
  correlationId: string
}>) {
  try {
    return await bffDb.createCatalogItem({
      ...identity(input.context),
      input: catalogItemCreateSchema.parse(input.input),
      correlationId: input.correlationId,
    })
  } catch (error) {
    return mapCatalogError(error)
  }
}

export async function updateCatalogItem(input: Readonly<{
  context: CompanyContext
  itemId: string
  input: CatalogItemUpdateInput
  correlationId: string
}>) {
  const { version, ...record } = catalogItemUpdateSchema.parse(input.input)
  try {
    return await bffDb.updateCatalogItem({
      ...identity(input.context),
      itemId: input.itemId,
      expectedVersion: version,
      input: record,
      correlationId: input.correlationId,
    })
  } catch (error) {
    return mapCatalogError(error)
  }
}

type CatalogCasInput = Readonly<{
  context: CompanyContext
  itemId: string
  version: number
  correlationId: string
}>

async function catalogCas(
  operation: "archive" | "restore" | "delete",
  input: CatalogCasInput,
) {
  const command = {
    ...identity(input.context),
    itemId: input.itemId,
    expectedVersion: input.version,
    correlationId: input.correlationId,
  }
  try {
    if (operation === "archive") return await bffDb.archiveCatalogItem(command)
    if (operation === "restore") return await bffDb.restoreCatalogItem(command)
    return await bffDb.deleteCatalogItem(command)
  } catch (error) {
    return mapCatalogError(error)
  }
}

export function archiveCatalogItem(input: CatalogCasInput) {
  return catalogCas("archive", input)
}

export function restoreCatalogItem(input: CatalogCasInput) {
  return catalogCas("restore", input)
}

export function deleteCatalogItem(input: CatalogCasInput) {
  return catalogCas("delete", input)
}
