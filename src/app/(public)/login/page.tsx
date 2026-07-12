import type { Metadata } from "next"

import { AuthShell } from "@/modules/auth/ui/auth-shell"
import { LoginForm } from "@/modules/auth/ui/login-form"
import { LoginRedirectGuard } from "@/modules/auth/ui/login-redirect-guard"

export const metadata: Metadata = { title: "Entrar" }

export default function LoginPage() {
  return (
    <>
      <LoginRedirectGuard />
      <AuthShell
        title="Acesse sua conta"
        description="Use o e-mail e a senha fornecidos pelo administrador responsável."
      >
        <LoginForm />
      </AuthShell>
    </>
  )
}
