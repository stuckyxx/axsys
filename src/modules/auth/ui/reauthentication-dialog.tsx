"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const GENERIC_ERROR = "Não foi possível confirmar sua senha. Tente novamente."

type ReauthenticationDialogProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmed: () => Promise<void> | void
}>

function readErrorMessage(body: unknown): string {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return GENERIC_ERROR
  }
  const { error } = body
  if (
    typeof error !== "object" ||
    error === null ||
    !("message" in error) ||
    typeof error.message !== "string" ||
    error.message.length === 0 ||
    error.message.length > 240
  ) {
    return GENERIC_ERROR
  }
  return error.message
}

export function ReauthenticationDialog({
  open,
  onOpenChange,
  onConfirmed,
}: ReauthenticationDialogProps) {
  const router = useRouter()
  const requestController = useRef<AbortController | null>(null)
  const inFlight = useRef(false)
  const [password, setPassword] = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(
    () => () => {
      requestController.current?.abort()
      requestController.current = null
      inFlight.current = false
    },
    [],
  )

  function close(): void {
    requestController.current?.abort()
    requestController.current = null
    inFlight.current = false
    setPassword("")
    setErrorMessage(null)
    setPending(false)
    onOpenChange(false)
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) {
      if (!pending) close()
      return
    }
    onOpenChange(true)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || pending || password.length === 0) return

    inFlight.current = true
    const controller = new AbortController()
    requestController.current?.abort()
    requestController.current = controller
    setPending(true)
    setErrorMessage(null)

    try {
      const csrfResponse = await fetch("/api/auth/csrf", {
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: controller.signal,
      })
      const csrfBody = (await csrfResponse.json()) as unknown
      const csrfToken =
        typeof csrfBody === "object" &&
        csrfBody !== null &&
        "token" in csrfBody &&
        typeof csrfBody.token === "string" &&
        csrfBody.token.length > 0 &&
        csrfBody.token === csrfBody.token.trim()
          ? csrfBody.token
          : null
      if (!csrfResponse.ok || csrfToken === null) throw new Error(GENERIC_ERROR)

      const response = await fetch("/api/auth/reauthenticate", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ password }),
        signal: controller.signal,
      })
      const body = (await response.json()) as unknown
      if (!response.ok) {
        setPassword("")
        setErrorMessage(readErrorMessage(body))
        return
      }

      router.refresh()
      await onConfirmed()
      close()
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      setPassword("")
      setErrorMessage(GENERIC_ERROR)
    } finally {
      inFlight.current = false
      if (!controller.signal.aborted) {
        requestController.current = null
        setPending(false)
      }
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0.1_0.018_252/0.7)] backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/80 bg-popover p-6 text-popover-foreground shadow-[0_24px_80px_-28px_oklch(0.08_0.02_252/0.7)] outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 sm:p-7"
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (pending) event.preventDefault()
          }}
        >
          <div className="mb-6 space-y-2">
            <DialogPrimitive.Title className="text-lg font-semibold tracking-tight text-foreground">
              Confirme sua senha
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="max-w-[42ch] text-sm leading-relaxed text-muted-foreground">
              Esta ação exige uma confirmação recente da sua identidade.
            </DialogPrimitive.Description>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="reauthentication-password">Senha atual</Label>
              <Input
                id="reauthentication-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                disabled={pending}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={errorMessage !== null}
                aria-describedby={
                  errorMessage ? "reauthentication-error" : undefined
                }
              />
              {errorMessage ? (
                <p
                  id="reauthentication-error"
                  role="alert"
                  className="text-sm leading-relaxed text-destructive"
                >
                  {errorMessage}
                </p>
              ) : (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  A senha é usada somente nesta confirmação.
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={close}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending || password.length === 0}>
                {pending ? "Confirmando..." : "Confirmar"}
              </Button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
