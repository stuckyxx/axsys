import "server-only"

import {
  bffDb,
  type CompanySettingsDraftPayload,
  type CompanySettingsSnapshot,
} from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import { companySettingsSchema, type CompanySettingsInput } from "@/modules/settings/schemas/company-settings-schemas"
import { companySettingsAccess } from "@/modules/settings/server/company-settings-access"
import { encryptRepresentativeDocument } from "@/modules/settings/server/company-settings-crypto"

type CompanyContext = Extract<AccessContext, { kind: "company" }>

export class CompanySettingsVersionConflictError extends Error {
  constructor(readonly current: Awaited<ReturnType<typeof getCompanySettings>>) {
    super("Company settings version conflict")
    this.name = "CompanySettingsVersionConflictError"
  }
}

function errorToken(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  const value = error as Record<string, unknown>
  return typeof value.message === "string" ? value.message : typeof value.code === "string" ? value.code : null
}

export function mapCompanySettingsError(error: unknown): never {
  const token = errorToken(error)
  if (token === "AXSYS_SETTINGS_VERSION_CONFLICT") {
    throw new ApiError("VERSION_CONFLICT", 409, "As configurações foram alteradas por outra sessão.")
  }
  if (token === "AXSYS_DRAFT_VERSION_CONFLICT") {
    throw new ApiError("DRAFT_VERSION_CONFLICT", 409, "O rascunho foi alterado por outra sessão.")
  }
  if (
    token === "AXSYS_SETTINGS_FORBIDDEN" ||
    token === "AXSYS_COMPANY_SETTINGS_READ_REQUIRED" ||
    token === "AXSYS_COMPANY_SETTINGS_WRITE_REQUIRED"
  ) {
    throw new ApiError("FORBIDDEN", 403, "Operação não autorizada.")
  }
  if (token === "AXSYS_COMPANY_ARCHIVED") {
    throw new ApiError("COMPANY_ARCHIVED", 403, "Empresa arquivada.")
  }
  if (
    token === "AXSYS_INVALID_LETTERHEAD_FILE" ||
    token === "AXSYS_INVALID_SIGNATURE_FILE"
  ) {
    throw new ApiError("BRANDING_FILE_INVALID", 422, "Arquivo institucional inválido.")
  }
  if (
    token === "AXSYS_COMPANY_SETTINGS_INPUT_INVALID" ||
    token === "AXSYS_COMPANY_SETTINGS_DOCUMENT_INVALID" ||
    token === "AXSYS_COMPANY_SETTINGS_DRAFT_INVALID"
  ) {
    throw new ApiError("VALIDATION_FAILED", 422, "Revise os campos informados.")
  }
  if (token === "AXSYS_COMPANY_SETTINGS_NOT_FOUND") {
    throw new ApiError("SETTINGS_NOT_FOUND", 404, "Configurações não encontradas.")
  }
  throw error
}

function assertRead(context: CompanyContext) {
  if (companySettingsAccess(context) === "forbidden") {
    throw new ApiError("FORBIDDEN", 403, "Operação não autorizada.")
  }
}

function assertEdit(context: CompanyContext) {
  if (companySettingsAccess(context) !== "edit") {
    throw new ApiError("FORBIDDEN", 403, "Operação não autorizada.")
  }
}

export function safeSettings(snapshot: CompanySettingsSnapshot) {
  return {
    ...snapshot,
    representativeDocumentLast4:
      snapshot.maskedRepresentativeDocument?.slice(-4) ?? null,
  }
}

export async function getCompanySettings(context: CompanyContext) {
  assertRead(context)
  try {
    return safeSettings(await bffDb.getOwnCompanySettings({ actorUserId: context.userId, sessionId: context.sessionId }))
  } catch (error) { return mapCompanySettingsError(error) }
}

export function encryptedSettingsPayload(
  context: CompanyContext,
  raw: CompanySettingsInput,
): CompanySettingsDraftPayload {
  const input = companySettingsSchema.parse(raw)
  const action = input.representativeDocument ? "replace" : "preserve"
  const document = action === "replace"
    ? encryptRepresentativeDocument(context.companyId, input.representativeDocument)
    : null
  return {
    representativeName: input.representativeName,
    representativeRole: input.representativeRole,
    representativeDocumentAction: action,
    representativeDocumentCiphertext: document?.ciphertext ?? null,
    representativeDocumentIv: document?.iv ?? null,
    representativeDocumentTag: document?.tag ?? null,
    representativeDocumentKeyVersion: document?.keyVersion ?? null,
    representativeDocumentLast4: document?.last4 ?? null,
    taxRate: input.taxRate,
    addressStreet: input.addressStreet,
    addressNumber: input.addressNumber,
    addressComplement: input.addressComplement,
    addressNeighborhood: input.addressNeighborhood,
    addressCity: input.addressCity,
    addressState: input.addressState,
    addressPostalCode: input.addressPostalCode,
    letterheadFileId: input.letterheadFileId,
    signatureFileId: input.signatureFileId,
  }
}

export async function updateCompanySettings(input: {
  context: CompanyContext
  settings: CompanySettingsInput
  correlationId: string
}) {
  assertEdit(input.context)
  try {
    const payload = encryptedSettingsPayload(input.context, input.settings)
    return safeSettings(await bffDb.updateOwnCompanySettings({
      actorUserId: input.context.userId, sessionId: input.context.sessionId,
      payload, expectedVersion: input.settings.version, correlationId: input.correlationId,
    }))
  } catch (error) {
    if (errorToken(error) === "AXSYS_SETTINGS_VERSION_CONFLICT") {
      const current = await getCompanySettings(input.context)
      throw new CompanySettingsVersionConflictError(current)
    }
    return mapCompanySettingsError(error)
  }
}
