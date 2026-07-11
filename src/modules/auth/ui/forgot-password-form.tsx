"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import type { z } from "zod"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { forgotPasswordSchema } from "@/modules/auth/schemas/auth-schemas"
import { useSecureMutation } from "@/modules/auth/ui/use-secure-mutation"

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>

const NEUTRAL_MESSAGE =
  "Se o e-mail estiver cadastrado, enviaremos as instruções."
const UNEXPECTED_RESPONSE = "Não foi possível iniciar a recuperação."

export function ForgotPasswordForm() {
  const [complete, setComplete] = useState(false)
  const [responseError, setResponseError] = useState<string | null>(null)
  const { submit, pending, error, fieldErrors } =
    useSecureMutation<ForgotPasswordValues>("/api/auth/forgot-password")
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
    shouldFocusError: true,
  })

  useEffect(() => {
    const message = fieldErrors.email?.[0]
    if (message) {
      setError("email", { type: "server", message }, { shouldFocus: true })
    }
  }, [fieldErrors, setError])

  async function onSubmit(values: ForgotPasswordValues): Promise<void> {
    setResponseError(null)
    const result = await submit<unknown>(values)
    if (result === null) return
    if (result.status !== 202) {
      setResponseError(UNEXPECTED_RESPONSE)
      return
    }
    setComplete(true)
  }

  if (complete) {
    return (
      <div className="space-y-5">
        <Alert role="status" className="px-4 py-4">
          <AlertTitle>Verifique seu e-mail</AlertTitle>
          <AlertDescription className="mt-1 leading-6">
            {NEUTRAL_MESSAGE}
          </AlertDescription>
        </Alert>
        <Button
          asChild
          variant="outline"
          size="lg"
          className="h-11 w-full rounded-xl px-5 transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        >
          <Link href="/login">Voltar para o login</Link>
        </Button>
      </div>
    )
  }

  const emailError = errors.email
    ? errors.email.type === "server" && typeof errors.email.message === "string"
      ? errors.email.message
      : "Informe um e-mail válido."
    : null

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit(onSubmit)}>
      {error || responseError ? (
        <Alert variant="destructive" className="px-3.5 py-3">
          <AlertDescription>{responseError ?? error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="forgot-password-email">E-mail</Label>
        <Input
          id="forgot-password-email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          className="h-11 px-3.5"
          disabled={pending}
          aria-invalid={emailError !== null}
          aria-describedby={
            emailError ? "forgot-password-email-error" : "forgot-password-help"
          }
          {...register("email")}
        />
        {emailError ? (
          <p
            id="forgot-password-email-error"
            role="alert"
            className="text-sm leading-5 text-destructive"
          >
            {emailError}
          </p>
        ) : (
          <p
            id="forgot-password-help"
            className="text-xs leading-5 text-muted-foreground"
          >
            Use o e-mail associado à sua conta.
          </p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        className="h-11 w-full rounded-xl px-5 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        disabled={pending}
      >
        {pending ? "Enviando..." : "Enviar instruções"}
      </Button>

      <Link
        href="/login"
        className="inline-flex min-h-11 w-full items-center justify-center text-sm font-medium text-muted-foreground underline-offset-4 transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:text-foreground hover:underline focus-visible:rounded-sm"
      >
        Voltar para o login
      </Link>
    </form>
  )
}
