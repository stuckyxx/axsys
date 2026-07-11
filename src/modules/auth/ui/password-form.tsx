"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import type { z } from "zod"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { changePasswordSchema } from "@/modules/auth/schemas/auth-schemas"
import { useSecureMutation } from "@/modules/auth/ui/use-secure-mutation"

type PasswordValues = z.infer<typeof changePasswordSchema>
type PasswordFormProps = Readonly<{ mode: "temporary" | "recovery" }>

function passwordFieldMessage(
  field: "password" | "confirmation",
  type: string | undefined,
  message: unknown,
): string {
  if (type === "server" && typeof message === "string") return message
  if (field === "confirmation" && typeof message === "string") return message
  return field === "password"
    ? "Informe uma nova senha."
    : "Confirme a nova senha."
}

export function PasswordForm({ mode }: PasswordFormProps) {
  const router = useRouter()
  const endpoint =
    mode === "temporary"
      ? "/api/auth/change-password"
      : "/api/auth/reset-password"
  const { submit, pending, error, fieldErrors } =
    useSecureMutation<PasswordValues>(endpoint)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<PasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { password: "", confirmation: "" },
    shouldFocusError: true,
  })

  useEffect(() => {
    const fields = ["password", "confirmation"] as const
    let shouldFocus = true
    for (const field of fields) {
      const message = fieldErrors[field]?.[0]
      if (!message) continue
      setError(field, { type: "server", message }, { shouldFocus })
      shouldFocus = false
    }
  }, [fieldErrors, setError])

  async function onSubmit(values: PasswordValues): Promise<void> {
    const result = await submit<unknown>(values)
    if (result !== null) router.replace("/login")
  }

  const passwordError = errors.password
    ? passwordFieldMessage(
        "password",
        errors.password.type,
        errors.password.message,
      )
    : null
  const confirmationError = errors.confirmation
    ? passwordFieldMessage(
        "confirmation",
        errors.confirmation.type,
        errors.confirmation.message,
      )
    : null

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit(onSubmit)}>
      {error ? (
        <Alert variant="destructive" className="px-3.5 py-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor={`${mode}-new-password`}>Nova senha</Label>
        <Input
          id={`${mode}-new-password`}
          type="password"
          autoComplete="new-password"
          className="h-11 px-3.5"
          disabled={pending}
          aria-invalid={passwordError !== null}
          aria-describedby={
            passwordError ? `${mode}-password-error` : `${mode}-password-help`
          }
          {...register("password")}
        />
        {passwordError ? (
          <p
            id={`${mode}-password-error`}
            role="alert"
            className="text-sm leading-5 text-destructive"
          >
            {passwordError}
          </p>
        ) : (
          <p
            id={`${mode}-password-help`}
            className="text-xs leading-5 text-muted-foreground"
          >
            Use ao menos 12 caracteres e no máximo 72 bytes UTF-8.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${mode}-password-confirmation`}>
          Confirmar nova senha
        </Label>
        <Input
          id={`${mode}-password-confirmation`}
          type="password"
          autoComplete="new-password"
          className="h-11 px-3.5"
          disabled={pending}
          aria-invalid={confirmationError !== null}
          aria-describedby={
            confirmationError ? `${mode}-confirmation-error` : undefined
          }
          {...register("confirmation")}
        />
        {confirmationError ? (
          <p
            id={`${mode}-confirmation-error`}
            role="alert"
            className="text-sm leading-5 text-destructive"
          >
            {confirmationError}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        size="lg"
        className="h-11 w-full rounded-xl px-5 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        disabled={pending}
      >
        {pending ? "Salvando..." : "Salvar nova senha"}
      </Button>
    </form>
  )
}
