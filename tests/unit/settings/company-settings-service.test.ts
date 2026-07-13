import { afterEach, describe, expect, it, vi } from "vitest"

import { createCompanyContext } from "../../helpers/auth"
import { encryptedSettingsPayload, safeSettings } from "@/modules/settings/server/company-settings-service"

afterEach(() => vi.unstubAllEnvs())

const input = {
  representativeName: "Maria Silva", representativeRole: "Diretora",
  representativeDocument: "52998224725", taxRate: 5,
  addressStreet: "Rua Central", addressNumber: "100", addressComplement: null,
  addressNeighborhood: "Centro", addressCity: "Fortaleza", addressState: "CE",
  addressPostalCode: "60000000", letterheadFileId: null, signatureFileId: null,
  version: 2,
}

describe("company settings service safety", () => {
  it("encrypts CPF with company-scoped AAD and never places plaintext in the DB payload", () => {
    vi.stubEnv("PII_ENCRYPTION_KEY_V1_BASE64", Buffer.alloc(32, 7).toString("base64"))
    const payload = encryptedSettingsPayload(createCompanyContext(), input)

    expect(payload.representativeDocumentAction).toBe("replace")
    expect(payload.representativeDocumentLast4).toBe("4725")
    expect(payload.representativeDocumentCiphertext).not.toContain("52998224725")
    expect(JSON.stringify(payload)).not.toContain("52998224725")
  })

  it("preserves the existing encrypted CPF when no replacement is submitted", () => {
    const payload = encryptedSettingsPayload(createCompanyContext(), {
      ...input,
      representativeDocument: null,
    })
    expect(payload).toMatchObject({
      representativeDocumentAction: "preserve",
      representativeDocumentCiphertext: null,
      representativeDocumentIv: null,
      representativeDocumentTag: null,
      representativeDocumentLast4: null,
    })
  })

  it("exposes only the masked last four digits to application consumers", () => {
    const safe = safeSettings({
      companyId: createCompanyContext().companyId,
      representativeName: null, representativeRole: null,
      maskedRepresentativeDocument: "••••4725", taxRate: 0,
      addressStreet: null, addressNumber: null, addressComplement: null,
      addressNeighborhood: null, addressCity: null, addressState: null,
      addressPostalCode: null, consolidatedAddress: null,
      letterheadFileId: null, signatureFileId: null, version: 1,
      updatedAt: "2026-07-12T20:00:00.000Z", canEdit: true, banks: [],
    })
    expect(safe.representativeDocumentLast4).toBe("4725")
    expect(JSON.stringify(safe)).not.toContain("52998224725")
  })
})
