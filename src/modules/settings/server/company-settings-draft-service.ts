import "server-only"

import { bffDb } from "@/lib/db/bff"
import type { AccessContext } from "@/modules/auth/domain/access-context"
import { companySettingsDraftRequestSchema } from "@/modules/settings/schemas/company-settings-schemas"
import { companySettingsAccess } from "@/modules/settings/server/company-settings-access"
import { encryptedSettingsPayload, mapCompanySettingsError } from "@/modules/settings/server/company-settings-service"
import { ApiError } from "@/lib/http/api-error"

type CompanyContext = Extract<AccessContext, { kind: "company" }>
function assertEdit(context: CompanyContext) {
  if (companySettingsAccess(context) !== "edit") throw new ApiError("FORBIDDEN", 403, "Operação não autorizada.")
}

export async function getCompanySettingsDraft(context: CompanyContext) {
  assertEdit(context)
  try {
    const draft = await bffDb.getOwnCompanySettingsDraft({ actorUserId: context.userId, sessionId: context.sessionId })
    if (!draft) return null
    const { payload, ...metadata } = draft
    return {
      ...metadata,
      payload: {
        representativeName: payload.representativeName, representativeRole: payload.representativeRole,
        representativeDocumentAction: payload.representativeDocumentAction,
        representativeDocumentLast4: payload.representativeDocumentLast4,
        taxRate: payload.taxRate, addressStreet: payload.addressStreet,
        addressNumber: payload.addressNumber, addressComplement: payload.addressComplement,
        addressNeighborhood: payload.addressNeighborhood, addressCity: payload.addressCity,
        addressState: payload.addressState, addressPostalCode: payload.addressPostalCode,
        letterheadFileId: payload.letterheadFileId, signatureFileId: payload.signatureFileId,
      },
    }
  } catch (error) { return mapCompanySettingsError(error) }
}

export async function upsertCompanySettingsDraft(input: {
  context: CompanyContext
  body: unknown
  correlationId: string
}) {
  assertEdit(input.context)
  const parsed = companySettingsDraftRequestSchema.parse(input.body)
  const { baseVersion, expectedDraftVersion, ...settings } = parsed
  try {
    const payload = encryptedSettingsPayload(input.context, { ...settings, version: baseVersion })
    const result = await bffDb.upsertOwnCompanySettingsDraft({ actorUserId: input.context.userId, sessionId: input.context.sessionId, payload, baseVersion, expectedDraftVersion, correlationId: input.correlationId })
    return { baseVersion: result.baseVersion, version: result.version, updatedAt: result.updatedAt }
  } catch (error) { return mapCompanySettingsError(error) }
}

export async function deleteCompanySettingsDraft(context: CompanyContext) {
  assertEdit(context)
  try { return { deleted: await bffDb.deleteOwnCompanySettingsDraft({ actorUserId: context.userId, sessionId: context.sessionId }) } }
  catch (error) { return mapCompanySettingsError(error) }
}
