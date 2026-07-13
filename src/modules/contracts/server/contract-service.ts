import "server-only"

import { getCompanyLocalDate } from "@/lib/dates/company-local-date"
import { ApiError } from "@/lib/http/api-error"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import { deriveContractLifecycle } from "@/modules/contracts/domain/contract-lifecycle"
import {
  contractCreateSchema,
  contractUpdateSchema,
  type ContractCreateInput,
  type ContractUpdateInput,
} from "@/modules/contracts/schemas/contract-input"
import {
  closeContractRecord,
  contractHasAttachments,
  createContractRecord,
  deleteContractRecord,
  getCompanyTimezone,
  getContractRow,
  listContractRows,
  updateContractRecord,
  type ContractRawDTO,
} from "@/modules/contracts/server/contract-repository"

type CompanyContext = Extract<AccessContext, { kind: "company" }>
type Status = "closed" | "expired" | "expiring" | "active"
export type ContractClock = Readonly<{ now(): Date }>
const systemClock: ContractClock = { now: () => new Date() }

function tokens(error: unknown): readonly string[] {
  if (typeof error !== "object" || error === null) return []
  const value = error as Record<string, unknown>
  return [value.code, value.message].filter(
    (candidate): candidate is string => typeof candidate === "string",
  )
}
function mapError(error: unknown): never {
  if (error instanceof ApiError) throw error
  const values = tokens(error)
  const has = (needle: string) => values.some((value) => value.includes(needle))
  if (has("CONTRACT_NOT_FOUND"))
    throw new ApiError("CONTRACT_NOT_FOUND", 404, "Contrato não encontrado.")
  if (has("VERSION_CONFLICT") || values.includes("40001"))
    throw new ApiError(
      "VERSION_CONFLICT",
      409,
      "O contrato foi alterado por outra sessão.",
    )
  if (has("CONTRACT_CLIENT_NOT_FOUND"))
    throw new ApiError(
      "CONTRACT_REFERENCE_INVALID",
      422,
      "Cliente não disponível.",
    )
  if (values.includes("23505") || has("CONTRACT_NUMBER"))
    throw new ApiError(
      "CONTRACT_NUMBER_CONFLICT",
      409,
      "Já existe um contrato com este número.",
    )
  if (values.includes("23503") || has("RESOURCE_IN_USE"))
    throw new ApiError("RESOURCE_IN_USE", 409, "O contrato possui vínculos.")
  if (has("CONTRACT_INPUT") || has("CONTRACT_REASON"))
    throw new ApiError("VALIDATION_FAILED", 422, "Revise os dados do contrato.")
  throw error
}

function dto(raw: ContractRawDTO, timezone: string, today: string) {
  const closedOn = raw.closedAt
    ? getCompanyLocalDate(timezone, new Date(raw.closedAt))
    : null
  return {
    ...raw,
    closedOn,
    ...deriveContractLifecycle({
      startsOn: raw.startsOn,
      endsOn: raw.endsOn,
      today,
      closedOn,
    }),
  }
}
async function temporal(context: CompanyContext, clock: ContractClock) {
  const timezone = await getCompanyTimezone(context)
  const today = getCompanyLocalDate(timezone, clock.now())
  return { timezone, today }
}

export async function listContracts(
  input: Readonly<{
    context: CompanyContext
    q?: string
    clientId?: string
    status?: Status
    cursor?: string
    limit: number
    clock?: ContractClock
  }>,
) {
  const time = await temporal(input.context, input.clock ?? systemClock)
  const page = await listContractRows({ ...input, today: time.today })
  return {
    ...page,
    items: page.items.map((item) => dto(item, time.timezone, time.today)),
  }
}
export async function getContractDetail(
  input: Readonly<{
    context: CompanyContext
    contractId: string
    clock?: ContractClock
  }>,
) {
  const time = await temporal(input.context, input.clock ?? systemClock)
  return dto(await getContractRow(input), time.timezone, time.today)
}
export async function createContract(
  input: Readonly<{
    context: CompanyContext
    input: ContractCreateInput
    correlationId: string
    clock?: ContractClock
  }>,
) {
  const time = await temporal(input.context, input.clock ?? systemClock)
  try {
    const result = await createContractRecord({
      ...input,
      input: contractCreateSchema.parse(input.input),
    })
    return { ...result, record: dto(result.record, time.timezone, time.today) }
  } catch (error) {
    return mapError(error)
  }
}
export async function updateContract(
  input: Readonly<{
    context: CompanyContext
    contractId: string
    input: ContractUpdateInput
    correlationId: string
    clock?: ContractClock
  }>,
) {
  const time = await temporal(input.context, input.clock ?? systemClock)
  try {
    const result = await updateContractRecord({
      ...input,
      input: contractUpdateSchema.parse(input.input),
    })
    return { ...result, record: dto(result.record, time.timezone, time.today) }
  } catch (error) {
    return mapError(error)
  }
}
export async function closeContract(
  input: Readonly<{
    context: CompanyContext
    contractId: string
    version: number
    reason: string
    correlationId: string
    clock?: ContractClock
  }>,
) {
  const time = await temporal(input.context, input.clock ?? systemClock)
  try {
    const result = await closeContractRecord(input)
    return { ...result, record: dto(result.record, time.timezone, time.today) }
  } catch (error) {
    return mapError(error)
  }
}
export async function deleteContract(
  input: Readonly<{
    context: CompanyContext
    contractId: string
    version: number
    correlationId: string
  }>,
) {
  try {
    const current = await getContractRow(input)
    if (current.closedAt)
      throw new ApiError(
        "HISTORICAL_RESOURCE",
        409,
        "Contratos encerrados não podem ser excluídos.",
      )
    if (await contractHasAttachments(input)) {
      throw new ApiError("RESOURCE_IN_USE", 409, "O contrato possui vínculos.")
    }
    return await deleteContractRecord(input)
  } catch (error) {
    if (
      !(error instanceof ApiError) &&
      (tokens(error).includes("40001") ||
        tokens(error).some((value) => value.includes("VERSION_CONFLICT"))) &&
      (await contractHasAttachments(input))
    ) {
      throw new ApiError("RESOURCE_IN_USE", 409, "O contrato possui vínculos.")
    }
    return mapError(error)
  }
}
