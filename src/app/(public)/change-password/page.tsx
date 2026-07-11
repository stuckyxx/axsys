import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { getAccessContext } from "@/modules/auth/server/get-access-context"
import { AuthShell } from "@/modules/auth/ui/auth-shell"
import { PasswordForm } from "@/modules/auth/ui/password-form"

export const metadata: Metadata = { title: "Trocar senha provisória" }

export default async function ChangePasswordPage() {
  const resolution = await getAccessContext()
  if (resolution.status === "anonymous") redirect("/login")
  if (resolution.status === "authenticated") {
    redirect(
      resolution.context.kind === "platform" ? "/platform" : "/app/dashboard",
    )
  }

  if (resolution.expired) {
    return (
      <AuthShell
        title="Recupere seu acesso"
        description="A credencial provisória precisa ser substituída antes de acessar o sistema."
      >
        <div className="space-y-5">
          <Alert variant="destructive" className="px-4 py-4">
            <AlertTitle>A senha provisória não está mais disponível.</AlertTitle>
            <AlertDescription className="mt-1 leading-6">
              Solicite instruções por e-mail para definir uma nova senha.
            </AlertDescription>
          </Alert>
          <Button
            asChild
            size="lg"
            className="h-11 w-full rounded-xl px-5 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          >
            <Link href="/forgot-password">Recuperar acesso</Link>
          </Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Crie sua senha definitiva"
      description="Por segurança, substitua a senha provisória antes de continuar."
    >
      <PasswordForm mode="temporary" />
    </AuthShell>
  )
}
