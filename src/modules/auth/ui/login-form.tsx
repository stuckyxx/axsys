"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import type { z } from "zod"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { loginSchema } from "@/modules/auth/schemas/auth-schemas"
import { useSecureMutation } from "@/modules/auth/ui/use-secure-mutation"

type LoginFormValues = z.input<typeof loginSchema>
type LoginPayload = z.output<typeof loginSchema>

const ALLOWED_REDIRECTS = new Set([
  "/platform",
  "/app/dashboard",
  "/change-password",
])
const INVALID_RESPONSE_ERROR = "Não foi possível concluir o acesso."

function loginErrorMessage(
  field: "email" | "password",
  type: string | undefined,
  message: unknown,
): string {
  if (type === "server" && typeof message === "string") return message
  return field === "email" ? "Informe um e-mail válido." : "Informe sua senha."
}

export function LoginForm() {
  const router = useRouter()
  const [responseError, setResponseError] = useState<string | null>(null)
  const { submit, pending, error, fieldErrors } =
    useSecureMutation<LoginPayload>("/api/auth/login")
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginFormValues, unknown, LoginPayload>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", rememberMe: false },
    shouldFocusError: true,
  })

  useEffect(() => {
    const fields = ["email", "password"] as const
    let shouldFocus = true
    for (const field of fields) {
      const message = fieldErrors[field]?.[0]
      if (!message) continue
      setError(field, { type: "server", message }, { shouldFocus })
      shouldFocus = false
    }
  }, [fieldErrors, setError])

  async function onSubmit(values: LoginPayload): Promise<void> {
    setResponseError(null)
    const result = await submit<{ redirectTo?: unknown }>(values)
    if (result === null) return

    const redirectTo = result.data?.redirectTo
    if (typeof redirectTo !== "string" || !ALLOWED_REDIRECTS.has(redirectTo)) {
      setResponseError(INVALID_RESPONSE_ERROR)
      return
    }
    router.replace(redirectTo)
  }

  const emailError = errors.email
    ? loginErrorMessage("email", errors.email.type, errors.email.message)
    : null
  const passwordError = errors.password
    ? loginErrorMessage("password", errors.password.type, errors.password.message)
    : null

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit(onSubmit)}>
      {error || responseError ? (
        <Alert variant="destructive" className="px-3.5 py-3">
          <AlertDescription>{responseError ?? error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="login-email">E-mail</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          className="h-11 px-3.5"
          disabled={pending}
          aria-invalid={emailError !== null}
          aria-describedby={emailError ? "login-email-error" : undefined}
          {...register("email")}
        />
        {emailError ? (
          <p
            id="login-email-error"
            role="alert"
            className="text-sm leading-5 text-destructive"
          >
            {emailError}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="login-password">Senha</Label>
          <Link
            href="/forgot-password"
            className="inline-flex min-h-11 items-center text-xs font-medium text-primary underline-offset-4 transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:underline focus-visible:rounded-sm"
          >
            Esqueci minha senha
          </Link>
        </div>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          className="h-11 px-3.5"
          disabled={pending}
          aria-invalid={passwordError !== null}
          aria-describedby={passwordError ? "login-password-error" : undefined}
          {...register("password")}
        />
        {passwordError ? (
          <p
            id="login-password-error"
            role="alert"
            className="text-sm leading-5 text-destructive"
          >
            {passwordError}
          </p>
        ) : null}
      </div>

      <Controller
        name="rememberMe"
        control={control}
        render={({ field }) => (
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox
              id="login-remember-me"
              checked={field.value ?? false}
              disabled={pending}
              onBlur={field.onBlur}
              onCheckedChange={(checked) => field.onChange(checked === true)}
              ref={field.ref}
            />
            <Label
              htmlFor="login-remember-me"
              className="min-h-11 cursor-pointer text-sm font-normal text-muted-foreground"
            >
              Manter conectado
            </Label>
          </div>
        )}
      />

      <Button
        type="submit"
        size="lg"
        className="h-11 w-full rounded-xl px-5 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        disabled={pending}
      >
        {pending ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  )
}
