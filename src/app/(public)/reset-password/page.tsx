import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { createServerSupabase } from "@/lib/supabase/server"
import { AuthShell } from "@/modules/auth/ui/auth-shell"
import { PasswordForm } from "@/modules/auth/ui/password-form"

export const metadata: Metadata = { title: "Definir nova senha" }

function hasRecoveryAmr(claims: unknown): boolean {
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) {
    return false
  }

  const amr = (claims as Record<string, unknown>).amr
  if (!Array.isArray(amr)) return false

  return amr.some((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return false
    }
    const { method, timestamp } = entry as Record<string, unknown>
    return (
      method === "recovery" &&
      Number.isSafeInteger(timestamp) &&
      (timestamp as number) > 0
    )
  })
}

export default async function ResetPasswordPage() {
  let recoveryVerified = false
  try {
    const client = await createServerSupabase()
    const claimsResult = await client.auth.getClaims()
    recoveryVerified =
      claimsResult.error === null && hasRecoveryAmr(claimsResult.data?.claims)
  } catch {
    recoveryVerified = false
  }

  if (!recoveryVerified) redirect("/forgot-password")

  return (
    <AuthShell
      title="Defina uma nova senha"
      description="Escolha uma senha exclusiva para concluir a recuperação do seu acesso."
    >
      <PasswordForm mode="recovery" />
    </AuthShell>
  )
}
