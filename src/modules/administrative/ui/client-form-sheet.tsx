"use client"

import { WarningCircleIcon, XIcon } from "@phosphor-icons/react"
import {
  cloneElement,
  useId,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { ClientDTO } from "@/modules/administrative/server/client-repository"

type ClientFormSheetProps = Readonly<{
  client: ClientDTO | null
  onClose: () => void
  onSaved: (client: ClientDTO, created: boolean) => void
  open: boolean
}>

type FormValues = {
  addressComplement: string
  addressNeighborhood: string
  addressNumber: string
  addressStreet: string
  cnpj: string
  email: string
  legalName: string
  municipality: string
  phone: string
  postalCode: string
  segment: string
  state: string
  tradeName: string
}

type ErrorEnvelope = Readonly<{
  error?: Readonly<{
    code?: string
    correlationId?: string
    fieldErrors?: Readonly<Record<string, readonly string[]>>
    message?: string
  }>
}>

const EMPTY_VALUES: FormValues = {
  addressComplement: "",
  addressNeighborhood: "",
  addressNumber: "",
  addressStreet: "",
  cnpj: "",
  email: "",
  legalName: "",
  municipality: "",
  phone: "",
  postalCode: "",
  segment: "",
  state: "",
  tradeName: "",
}

function valuesFrom(client: ClientDTO | null): FormValues {
  if (!client) return { ...EMPTY_VALUES }
  return {
    addressComplement: client.address.complement ?? "",
    addressNeighborhood: client.address.neighborhood ?? "",
    addressNumber: client.address.number ?? "",
    addressStreet: client.address.street ?? "",
    cnpj: client.cnpj,
    email: client.email ?? "",
    legalName: client.legalName,
    municipality: client.address.municipality,
    phone: client.phone ?? "",
    postalCode: client.address.postalCode ?? "",
    segment: client.segment,
    state: client.address.state,
    tradeName: client.tradeName ?? "",
  }
}

async function csrfToken(signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/auth/csrf", {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    signal,
  })
  if (!response.ok) throw new Error("csrf")
  const body = (await response.json()) as { token?: unknown }
  if (typeof body.token !== "string") throw new Error("csrf")
  return body.token
}

function mutationBody(values: FormValues, version?: number) {
  const nullable = (value: string) => value.trim() || null
  return {
    legalName: values.legalName,
    tradeName: nullable(values.tradeName),
    cnpj: values.cnpj,
    segment: values.segment,
    email: nullable(values.email),
    phone: nullable(values.phone),
    addressStreet: nullable(values.addressStreet),
    addressNumber: nullable(values.addressNumber),
    addressComplement: nullable(values.addressComplement),
    addressNeighborhood: nullable(values.addressNeighborhood),
    municipality: values.municipality,
    state: values.state,
    postalCode: nullable(values.postalCode),
    ...(version === undefined ? {} : { version }),
  }
}

export function ClientFormSheet({ client, onClose, onSaved, open }: ClientFormSheetProps) {
  const formId = useId()
  const errorSummary = useRef<HTMLDivElement>(null)
  const conflictPanel = useRef<HTMLElement>(null)
  const [values, setValues] = useState<FormValues>(() => valuesFrom(client))
  const [version, setVersion] = useState(client?.version)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, readonly string[]>>>({})
  const [conflict, setConflict] = useState<Readonly<{ current: ClientDTO; local: FormValues }> | null>(null)

  const update = (field: keyof FormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => {
      if (!(field in current)) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  async function readCurrent(signal: AbortSignal): Promise<ClientDTO | null> {
    if (!client) return null
    const response = await fetch(`/api/administrative/clients/${client.id}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    })
    if (!response.ok) return null
    const detail = (await response.json()) as { client?: ClientDTO }
    return detail.client ?? null
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const controller = new AbortController()
    setPending(true)
    setError(null)
    setFieldErrors({})
    try {
      const token = await csrfToken(controller.signal)
      const editing = client !== null
      const response = await fetch(
        editing ? `/api/administrative/clients/${client.id}` : "/api/administrative/clients",
        {
          method: editing ? "PATCH" : "POST",
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "x-csrf-token": token,
          },
          body: JSON.stringify(mutationBody(values, editing ? version : undefined)),
        },
      )
      const body = (await response.json()) as ErrorEnvelope & { record?: ClientDTO }
      if (!response.ok) {
        if (response.status === 409 && body.error?.code === "VERSION_CONFLICT") {
          const current = await readCurrent(controller.signal)
          if (current) {
            setConflict({ current, local: { ...values } })
            setVersion(current.version)
            requestAnimationFrame(() => conflictPanel.current?.focus())
            return
          }
        }
        setFieldErrors(body.error?.fieldErrors ?? {})
        setError(body.error?.message ?? "Não foi possível salvar o cliente.")
        requestAnimationFrame(() => errorSummary.current?.focus())
        return
      }
      if (!body.record) throw new Error("record")
      onSaved(body.record, !editing)
      onClose()
    } catch {
      setError("Não foi possível salvar o cliente. Verifique a conexão e tente novamente.")
      requestAnimationFrame(() => errorSummary.current?.focus())
    } finally {
      setPending(false)
    }
  }

  const title = client ? "Editar cliente" : "Novo cliente"
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next && !pending) onClose() }}>
      <SheetContent
        className="flex h-dvh w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onEscapeKeyDown={(event) => { if (pending) event.preventDefault() }}
        onPointerDownOutside={(event) => { if (pending) event.preventDefault() }}
        showCloseButton={false}
        side="right"
      >
        <SheetHeader className="relative shrink-0 border-b border-border px-5 py-5 pr-16 sm:px-7">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {client ? "Revise os dados cadastrais e salve a nova versão." : "Informe os dados essenciais do órgão ou entidade pública."}
          </SheetDescription>
          <Button
            aria-label="Fechar formulário"
            className="absolute right-3 top-3 size-11"
            disabled={pending}
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <XIcon aria-hidden />
          </Button>
        </SheetHeader>
        <form className="flex min-h-0 flex-1 flex-col" id={formId} onSubmit={submit}>
          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-5 py-6 sm:px-7">
            <div
              aria-live="polite"
              className="min-h-0 text-sm"
              ref={errorSummary}
              tabIndex={-1}
            >
              {error ? <p className="border-l-2 border-destructive pl-3 text-destructive" role="alert">{error}</p> : null}
            </div>
            {conflict ? (
              <ConflictComparison
                conflict={conflict}
                onReview={() => setConflict(null)}
                onUseCurrent={() => {
                  setValues(valuesFrom(conflict.current))
                  setVersion(conflict.current.version)
                  setConflict(null)
                }}
                panelRef={conflictPanel}
              />
            ) : null}
            <fieldset className="space-y-5" disabled={pending}>
              <legend className="mb-5 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Identificação</legend>
              <FormField error={fieldErrors.legalName?.[0]} id="client-legal-name" label="Razão social" required>
                <Input autoFocus id="client-legal-name" maxLength={200} minLength={2} onChange={(event) => update("legalName", event.target.value)} required value={values.legalName} />
              </FormField>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField error={fieldErrors.tradeName?.[0]} id="client-trade-name" label="Nome fantasia">
                  <Input id="client-trade-name" maxLength={200} onChange={(event) => update("tradeName", event.target.value)} value={values.tradeName} />
                </FormField>
                <FormField error={fieldErrors.cnpj?.[0]} id="client-cnpj" label="CNPJ" required>
                  <Input id="client-cnpj" inputMode="numeric" onChange={(event) => update("cnpj", event.target.value)} required value={values.cnpj} />
                </FormField>
              </div>
              <FormField error={fieldErrors.segment?.[0]} id="client-form-segment" label="Segmento" required>
                <Input id="client-form-segment" maxLength={80} minLength={2} onChange={(event) => update("segment", event.target.value)} required value={values.segment} />
              </FormField>
            </fieldset>
            <fieldset className="space-y-5 border-t border-border pt-7" disabled={pending}>
              <legend className="mb-5 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Contato</legend>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField error={fieldErrors.email?.[0]} id="client-email" label="E-mail">
                  <Input id="client-email" maxLength={254} onChange={(event) => update("email", event.target.value)} type="email" value={values.email} />
                </FormField>
                <FormField error={fieldErrors.phone?.[0]} id="client-phone" label="Telefone">
                  <Input id="client-phone" maxLength={40} onChange={(event) => update("phone", event.target.value)} type="tel" value={values.phone} />
                </FormField>
              </div>
            </fieldset>
            <fieldset className="space-y-5 border-t border-border pt-7" disabled={pending}>
              <legend className="mb-5 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Endereço</legend>
              <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_9rem]">
                <FormField id="client-street" label="Logradouro"><Input id="client-street" maxLength={180} onChange={(event) => update("addressStreet", event.target.value)} value={values.addressStreet} /></FormField>
                <FormField id="client-number" label="Número"><Input id="client-number" maxLength={40} onChange={(event) => update("addressNumber", event.target.value)} value={values.addressNumber} /></FormField>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField id="client-complement" label="Complemento"><Input id="client-complement" maxLength={160} onChange={(event) => update("addressComplement", event.target.value)} value={values.addressComplement} /></FormField>
                <FormField id="client-neighborhood" label="Bairro"><Input id="client-neighborhood" maxLength={120} onChange={(event) => update("addressNeighborhood", event.target.value)} value={values.addressNeighborhood} /></FormField>
              </div>
              <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_6rem_10rem]">
                <FormField error={fieldErrors.municipality?.[0]} id="client-municipality" label="Município" required><Input id="client-municipality" maxLength={120} minLength={2} onChange={(event) => update("municipality", event.target.value)} required value={values.municipality} /></FormField>
                <FormField error={fieldErrors.state?.[0]} id="client-state" label="UF" required><Input id="client-state" maxLength={2} minLength={2} onChange={(event) => update("state", event.target.value.toUpperCase())} required value={values.state} /></FormField>
                <FormField error={fieldErrors.postalCode?.[0]} id="client-postal-code" label="CEP"><Input id="client-postal-code" inputMode="numeric" onChange={(event) => update("postalCode", event.target.value)} value={values.postalCode} /></FormField>
              </div>
            </fieldset>
          </div>
          <footer className="sticky bottom-0 flex shrink-0 items-center justify-end gap-2 border-t border-border bg-background/95 px-5 py-4 backdrop-blur sm:px-7">
            <Button className="min-h-11" disabled={pending} onClick={onClose} type="button" variant="ghost">Cancelar</Button>
            <Button className="min-h-11" disabled={pending} type="submit">
              {pending ? "Salvando..." : client ? "Salvar alterações" : "Criar cliente"}
            </Button>
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function FormField({ children, error, id, label, required = false }: Readonly<{
  children: ReactElement<{ "aria-describedby"?: string }>
  error?: string
  id: string
  label: string
  required?: boolean
}>) {
  const errorId = `${id}-error`
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}{required ? <span aria-hidden> *</span> : null}</Label>
      {cloneElement(children, { "aria-describedby": error ? errorId : undefined })}
      {error ? <p className="text-xs text-destructive" id={errorId}>{error}</p> : null}
    </div>
  )
}

function ConflictComparison({ conflict, onReview, onUseCurrent, panelRef }: Readonly<{
  conflict: Readonly<{ current: ClientDTO; local: FormValues }>
  onReview: () => void
  onUseCurrent: () => void
  panelRef: RefObject<HTMLElement | null>
}>) {
  return (
    <section
      aria-label="Conflito de edição"
      className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="flex gap-3">
        <WarningCircleIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0">
          <h3 className="font-semibold">Este cliente mudou em outra sessão</h3>
          <p className="mt-1 text-sm text-muted-foreground">Sua edição foi preservada. Compare os valores antes de continuar.</p>
        </div>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-3"><dt className="text-xs text-muted-foreground">Sua versão</dt><dd className="mt-1 break-words">{conflict.local.tradeName || "Sem nome fantasia"}</dd></div>
        <div className="rounded-lg border border-border bg-background p-3"><dt className="text-xs text-muted-foreground">Versão atual</dt><dd className="mt-1 break-words">{conflict.current.tradeName || "Sem nome fantasia"}</dd></div>
      </dl>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button className="min-h-11" onClick={onUseCurrent} type="button" variant="outline">Usar versão atual</Button>
        <Button className="min-h-11" onClick={onReview} type="button">Revisar e tentar novamente</Button>
      </div>
    </section>
  )
}
