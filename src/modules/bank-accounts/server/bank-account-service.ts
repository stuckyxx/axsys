import "server-only"

import { randomUUID } from "node:crypto"

import {
  bffDb,
  type BankAccountSummarySnapshot,
} from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import { createServerSupabase } from "@/lib/supabase/server"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import {
  archiveBankAccountSchema,
  createBankAccountSchema,
  updateBankAccountSchema,
  type CreateBankAccountInput,
  type BankAccountArchiveReasonCode,
  type UpdateBankAccountInput,
} from "@/modules/bank-accounts/schemas/bank-account-schemas"
import {
  encryptBankAccount,
  type BankKeyring,
} from "@/modules/bank-accounts/server/bank-account-crypto"
import { z } from "@/lib/validation/zod"

export type BankAccountSummary = Readonly<BankAccountSummarySnapshot>
type PlatformContext = Extract<AccessContext, { kind: "platform" }>
type CompanyContext = Extract<AccessContext, { kind: "company" }>
type EncryptedBankAccount = ReturnType<typeof encryptBankAccount>

type UpsertRepositoryInput = Readonly<{
  actorUserId: string
  sessionId: string
  companyId: string
  bankAccountId: string
  correlationId: string
  bankCode: string
  bankName: string
  accountType: "checking" | "savings" | "payment"
  holderName: string
  makeDefault: boolean
  expectedVersion: number | null
  encrypted: EncryptedBankAccount
}>

export type BankAccountServiceDependencies = Readonly<{
  repository: Readonly<{
    list(input: { actorUserId: string; sessionId: string; companyId: string }): Promise<BankAccountSummary[]>
    upsert(input: UpsertRepositoryInput): Promise<BankAccountSummary>
    setDefault(input: {
      actorUserId: string
      sessionId: string
      companyId: string
      bankAccountId: string
      expectedVersion: number
      correlationId: string
    }): Promise<BankAccountSummary>
    archive(input: {
      actorUserId: string
      sessionId: string
      companyId: string
      bankAccountId: string
      replacementDefaultId: string | null
      reasonCode: BankAccountArchiveReasonCode
      expectedVersion: number
      correlationId: string
    }): Promise<BankAccountSummary>
  }>
  uuid(): string
  keyring?: BankKeyring
}>

const authenticatedSummarySchema = z
  .object({
    id: z.uuid(), company_id: z.uuid(), bank_code: z.string(), bank_name: z.string(),
    masked_branch: z.string().regex(/^(?:\d{4}|•\d{3}|••\d{2}|•••\d)$/u),
    masked_account: z.string().regex(/^(?:\d{4}|•\d{3}|••\d{2}|•••\d)$/u),
    account_type: z.enum(["checking", "savings", "payment"]),
    holder_name: z.string(),
    masked_holder_document: z.string().regex(/^••••\d{1,4}$/u).nullable(),
    status: z.literal("active"), is_default: z.boolean(), version: z.int().positive(),
    created_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }),
  })
  .strict()

function errorToken(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  const value = error as Record<string, unknown>
  return typeof value.message === "string" ? value.message : typeof value.code === "string" ? value.code : null
}

function mapBankError(error: unknown): never {
  const token = errorToken(error)
  if (token === "AXSYS_COMPANY_NOT_FOUND" || token === "AXSYS_BANK_ACCOUNT_NOT_FOUND") {
    throw new ApiError("BANK_ACCOUNT_NOT_FOUND", 404, "Conta bancária não encontrada.")
  }
  if (token === "AXSYS_BANK_ACCOUNT_VERSION_CONFLICT") {
    throw new ApiError("VERSION_CONFLICT", 409, "A conta bancária foi alterada por outra sessão.")
  }
  if (token === "AXSYS_REPLACEMENT_DEFAULT_REQUIRED") {
    throw new ApiError("REPLACEMENT_DEFAULT_REQUIRED", 409, "Selecione uma conta padrão substituta.")
  }
  if (token === "AXSYS_REPLACEMENT_DEFAULT_INVALID") {
    throw new ApiError("REPLACEMENT_DEFAULT_INVALID", 422, "Conta padrão substituta inválida.")
  }
  throw error
}

function repository(): BankAccountServiceDependencies["repository"] {
  return {
    list: bffDb.listPlatformBankAccounts,
    async upsert(input) {
      return bffDb.upsertBankAccount({
        actorUserId: input.actorUserId, sessionId: input.sessionId,
        companyId: input.companyId, bankAccountId: input.bankAccountId,
        bankCode: input.bankCode, bankName: input.bankName,
        branch: input.encrypted.branch, branchLast4: input.encrypted.branchLast4,
        account: input.encrypted.account, accountLast4: input.encrypted.accountLast4,
        accountType: input.accountType, holderName: input.holderName,
        holderDocument: input.encrypted.holderDocument,
        holderDocumentLast4: input.encrypted.holderDocumentLast4,
        makeDefault: input.makeDefault, expectedVersion: input.expectedVersion,
        correlationId: input.correlationId,
      })
    },
    setDefault: bffDb.setDefaultBankAccount,
    archive: bffDb.archiveBankAccount,
  }
}

function defaults(): BankAccountServiceDependencies {
  return { repository: repository(), uuid: randomUUID }
}

type UpsertCommand = Readonly<{
  actorUserId: string; sessionId: string; companyId: string; bankAccountId?: string
  correlationId: string; input: CreateBankAccountInput | UpdateBankAccountInput
}>

async function upsert(deps: BankAccountServiceDependencies, command: UpsertCommand, expectedVersion: number | null) {
  const input = expectedVersion === null
    ? createBankAccountSchema.parse(command.input)
    : updateBankAccountSchema.parse(command.input)
  const bankAccountId = command.bankAccountId ?? deps.uuid()
  const encrypted = encryptBankAccount({
    companyId: command.companyId, bankAccountId,
    branch: input.branch, account: input.account, holderDocument: input.holderDocument,
  }, deps.keyring)
  try {
    return await deps.repository.upsert({
      actorUserId: command.actorUserId, sessionId: command.sessionId,
      companyId: command.companyId, bankAccountId, correlationId: command.correlationId,
      bankCode: input.bankCode, bankName: input.bankName, accountType: input.accountType,
      holderName: input.holderName, makeDefault: input.makeDefault,
      expectedVersion, encrypted,
    })
  } catch (error) {
    return mapBankError(error)
  }
}

export function createBankAccount(deps: BankAccountServiceDependencies, command: UpsertCommand): Promise<BankAccountSummary>
export function createBankAccount(command: UpsertCommand): Promise<BankAccountSummary>
export function createBankAccount(first: BankAccountServiceDependencies | UpsertCommand, second?: UpsertCommand) {
  return second === undefined ? upsert(defaults(), first as UpsertCommand, null) : upsert(first as BankAccountServiceDependencies, second, null)
}

export function updateBankAccount(deps: BankAccountServiceDependencies, command: UpsertCommand & { bankAccountId: string }): Promise<BankAccountSummary>
export function updateBankAccount(command: UpsertCommand & { bankAccountId: string }): Promise<BankAccountSummary>
export function updateBankAccount(first: BankAccountServiceDependencies | (UpsertCommand & { bankAccountId: string }), second?: UpsertCommand & { bankAccountId: string }) {
  const command = second ?? (first as UpsertCommand & { bankAccountId: string })
  const version = updateBankAccountSchema.parse(command.input).version
  return upsert(second === undefined ? defaults() : first as BankAccountServiceDependencies, command, version)
}

type CasCommand = Readonly<{ actorUserId: string; sessionId: string; companyId: string; bankAccountId: string; version: number; correlationId: string }>
export function setDefaultBankAccount(deps: BankAccountServiceDependencies, command: CasCommand): Promise<BankAccountSummary>
export function setDefaultBankAccount(command: CasCommand): Promise<BankAccountSummary>
export async function setDefaultBankAccount(first: BankAccountServiceDependencies | CasCommand, second?: CasCommand) {
  const deps = second === undefined ? defaults() : first as BankAccountServiceDependencies
  const command = second ?? first as CasCommand
  try {
    return await deps.repository.setDefault({
      actorUserId: command.actorUserId,
      sessionId: command.sessionId,
      companyId: command.companyId,
      bankAccountId: command.bankAccountId,
      expectedVersion: z.int().positive().parse(command.version),
      correlationId: command.correlationId,
    })
  } catch (error) { return mapBankError(error) }
}

type ArchiveCommand = CasCommand & Readonly<{
  replacementDefaultId: string | null
  reasonCode: BankAccountArchiveReasonCode
}>
export function archiveBankAccount(deps: BankAccountServiceDependencies, command: ArchiveCommand): Promise<BankAccountSummary>
export function archiveBankAccount(command: ArchiveCommand): Promise<BankAccountSummary>
export async function archiveBankAccount(first: BankAccountServiceDependencies | ArchiveCommand, second?: ArchiveCommand) {
  const deps = second === undefined ? defaults() : first as BankAccountServiceDependencies
  const command = second ?? first as ArchiveCommand
  const parsed = archiveBankAccountSchema.parse({
    version: command.version,
    replacementDefaultId: command.replacementDefaultId,
    reasonCode: command.reasonCode,
  })
  try {
    return await deps.repository.archive({
      actorUserId: command.actorUserId,
      sessionId: command.sessionId,
      companyId: command.companyId,
      bankAccountId: command.bankAccountId,
      replacementDefaultId: parsed.replacementDefaultId,
      reasonCode: parsed.reasonCode,
      expectedVersion: parsed.version,
      correlationId: command.correlationId,
    })
  } catch (error) { return mapBankError(error) }
}

export async function listPlatformBankAccounts(input: { context: PlatformContext; companyId: string }): Promise<BankAccountSummary[]> {
  try {
    return await bffDb.listPlatformBankAccounts({ actorUserId: input.context.userId, sessionId: input.context.sessionId, companyId: input.companyId })
  } catch (error) { return mapBankError(error) }
}

export async function listCompanyBankAccounts(input: { context: CompanyContext }): Promise<BankAccountSummary[]> {
  if (input.context.role !== "company_admin" && !input.context.modules.includes("financial")) {
    throw new ApiError("MODULE_FORBIDDEN", 403, "Módulo não autorizado.")
  }
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from("company_bank_account_summaries").select("id,company_id,bank_code,bank_name,masked_branch,masked_account,account_type,holder_name,masked_holder_document,status,is_default,version,created_at,updated_at").eq("company_id", input.context.companyId).order("is_default", { ascending: false }).order("created_at", { ascending: true })
  if (error) throw new Error("Company bank accounts unavailable")
  return authenticatedSummarySchema.array().parse(data).map((row) => ({
    id: row.id, companyId: row.company_id, bankCode: row.bank_code, bankName: row.bank_name,
    maskedBranch: row.masked_branch, maskedAccount: row.masked_account, accountType: row.account_type,
    holderName: row.holder_name, maskedHolderDocument: row.masked_holder_document,
    status: row.status, isDefault: row.is_default, version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }))
}
