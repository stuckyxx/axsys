import "server-only"

import { bffDb } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import {
  clientCreateSchema,
  clientUpdateSchema,
  type ClientCreateInput,
  type ClientUpdateInput,
} from "@/modules/administrative/schemas/client-input"
import {
  getClientDetail as readClientDetail,
  listClients as readClients,
} from "@/modules/administrative/server/client-repository"

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

function mapClientError(error: unknown): never {
  const token = errorToken(error)
  if (
    token === "AXSYS_CLIENT_NOT_FOUND" ||
    token === "AXSYS_ADMINISTRATIVE_CLIENT_NOT_FOUND"
  ) {
    throw new ApiError("CLIENT_NOT_FOUND", 404, "Cliente não encontrado.")
  }
  if (
    token === "AXSYS_CLIENT_VERSION_CONFLICT" ||
    token === "AXSYS_VERSION_CONFLICT"
  ) {
    throw new ApiError(
      "VERSION_CONFLICT",
      409,
      "O cliente foi alterado por outra sessão.",
    )
  }
  if (
    token === "AXSYS_CLIENT_IN_USE" ||
    token === "AXSYS_RESOURCE_IN_USE" ||
    token === "23503"
  ) {
    throw new ApiError(
      "RESOURCE_IN_USE",
      409,
      "O cliente possui vínculos e não pode ser excluído.",
    )
  }
  if (token === "23505" || token === "AXSYS_CLIENT_CONFLICT") {
    throw new ApiError(
      "CLIENT_CONFLICT",
      409,
      "Já existe um cliente com o CNPJ informado.",
    )
  }
  throw error
}

function identity(context: CompanyContext) {
  return { actorUserId: context.userId, sessionId: context.sessionId }
}

export function listClients(input: Readonly<{
  context: CompanyContext
  q?: string
  segment?: string
  archived?: boolean
  cursor?: string
  limit: number
}>) {
  return readClients(input)
}

export function getClientDetail(input: Readonly<{
  context: CompanyContext
  clientId: string
}>) {
  return readClientDetail(input)
}

export async function createClient(input: Readonly<{
  context: CompanyContext
  input: ClientCreateInput
  correlationId: string
}>) {
  const parsed = clientCreateSchema.parse(input.input)
  try {
    return await bffDb.createClient({
      ...identity(input.context),
      input: parsed,
      correlationId: input.correlationId,
    })
  } catch (error) {
    return mapClientError(error)
  }
}

export async function updateClient(input: Readonly<{
  context: CompanyContext
  clientId: string
  input: ClientUpdateInput
  correlationId: string
}>) {
  const { version, ...record } = clientUpdateSchema.parse(input.input)
  try {
    return await bffDb.updateClient({
      ...identity(input.context),
      clientId: input.clientId,
      expectedVersion: version,
      input: record,
      correlationId: input.correlationId,
    })
  } catch (error) {
    return mapClientError(error)
  }
}

type ClientCasInput = Readonly<{
  context: CompanyContext
  clientId: string
  version: number
  correlationId: string
}>

async function clientCas(
  operation: "archive" | "restore" | "delete",
  input: ClientCasInput,
) {
  const command = {
    ...identity(input.context),
    clientId: input.clientId,
    expectedVersion: input.version,
    correlationId: input.correlationId,
  }
  try {
    if (operation === "archive") return await bffDb.archiveClient(command)
    if (operation === "restore") return await bffDb.restoreClient(command)
    return await bffDb.deleteClient(command)
  } catch (error) {
    return mapClientError(error)
  }
}

export function archiveClient(input: ClientCasInput) {
  return clientCas("archive", input)
}

export function restoreClient(input: ClientCasInput) {
  return clientCas("restore", input)
}

export function deleteClient(input: ClientCasInput) {
  return clientCas("delete", input)
}
