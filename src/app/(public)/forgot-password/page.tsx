import type { Metadata } from "next"

import { AuthShell } from "@/modules/auth/ui/auth-shell"
import { ForgotPasswordForm } from "@/modules/auth/ui/forgot-password-form"

export const metadata: Metadata = { title: "Recuperar acesso" }

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Recupere seu acesso"
      description="Informe seu e-mail. Se houver uma conta vinculada, enviaremos instruções seguras."
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
