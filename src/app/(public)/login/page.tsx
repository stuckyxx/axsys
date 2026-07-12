import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AuthShell } from "@/modules/auth/ui/auth-shell"
import { LoginForm } from "@/modules/auth/ui/login-form"
import { getAccessContext } from "@/modules/auth/server/get-access-context"

export const metadata: Metadata = { title: "Entrar" }

export default async function LoginPage() {
  const resolution = await getAccessContext()
  if (resolution.status === "authenticated") {
    redirect(
      resolution.context.kind === "platform" ? "/platform" : "/app/dashboard",
    )
  }
  if (resolution.status === "password_change") redirect("/change-password")

  return (
    <AuthShell
      title="Acesse sua conta"
      description="Use o e-mail e a senha fornecidos pelo administrador responsável."
    >
      <LoginForm />
    </AuthShell>
  )
}
