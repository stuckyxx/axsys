import "server-only"

import { withNoStore } from "@/lib/security/no-store"
import { consumeRateLimit } from "@/lib/security/rate-limit"

export async function enforceSettingsDraftRateLimit(
  key: string,
  correlationId: string,
): Promise<Response | null> {
  const decision = await consumeRateLimit("company-settings-draft", key)
  if (decision.allowed) return null
  return withNoStore(Response.json({ error: {
    code: "SETTINGS_DRAFT_RATE_LIMITED",
    message: "Muitas alterações de rascunho. Aguarde e tente novamente.",
    correlationId,
  } }, { status: 429 }))
}
