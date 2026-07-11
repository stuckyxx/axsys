import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getAccessContext } from "@/modules/auth/server/get-access-context"
import { AuthShell } from "@/modules/auth/ui/auth-shell"
import { LoginForm } from "@/modules/auth/ui/login-form"

export const metadata: Metadata = { title: "Entrar" }

export default async function LoginPage() {
  const resolution = await getAccessContext()
  if (resolution.status === "password_change") redirect("/change-password")
  if (resolution.status === "authenticated") {
    redirect(
      resolution.context.kind === "platform" ? "/platform" : "/app/dashboard",
    )
  }

  return (
    <AuthShell
      title="Acesse sua conta"
      description="Use o e-mail e a senha fornecidos pelo administrador responsável."
    >
      <LoginForm />
    </AuthShell>
  )
}
