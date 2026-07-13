import { forbidden } from "next/navigation"

import { requireCompanyContext } from "@/modules/auth/server/guards"
import { companySettingsAccess } from "@/modules/settings/server/company-settings-access"
import { getCompanySettingsDraft } from "@/modules/settings/server/company-settings-draft-service"
import { getCompanySettings } from "@/modules/settings/server/company-settings-service"
import { CompanySettingsForm } from "@/modules/settings/ui/company-settings-form"

export const dynamic = "force-dynamic"

export default async function CompanySettingsPage() {
  const context = await requireCompanyContext()
  const access = companySettingsAccess(context)
  if (access === "forbidden") forbidden()
  const settings = await getCompanySettings(context)
  const draft = access === "edit" ? await getCompanySettingsDraft(context) : null
  const safe = {
    representativeName: settings.representativeName,
    representativeRole: settings.representativeRole,
    representativeDocumentLast4: settings.representativeDocumentLast4,
    taxRate: settings.taxRate,
    addressStreet: settings.addressStreet,
    addressNumber: settings.addressNumber,
    addressComplement: settings.addressComplement,
    addressNeighborhood: settings.addressNeighborhood,
    addressCity: settings.addressCity,
    addressState: settings.addressState,
    addressPostalCode: settings.addressPostalCode,
    consolidatedAddress: settings.consolidatedAddress,
    letterheadFileId: settings.letterheadFileId,
    signatureFileId: settings.signatureFileId,
    version: settings.version,
    updatedAt: settings.updatedAt,
  }

  return (
    <CompanySettingsForm
      access={access}
      banks={settings.banks}
      initialDraft={draft}
      initialSettings={safe}
    />
  )
}
