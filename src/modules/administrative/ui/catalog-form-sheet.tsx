"use client"

import {
  PackageIcon,
  WarningCircleIcon,
  WrenchIcon,
  XIcon,
} from "@phosphor-icons/react"
import {
  cloneElement,
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
import type { CatalogItemDTO } from "@/modules/administrative/server/catalog-item-repository"

type CatalogFormSheetProps = Readonly<{
  item: CatalogItemDTO | null
  onClose: () => void
  onSaved: (item: CatalogItemDTO, created: boolean) => void
}>

type FormValues = {
  description: string
  itemKind: "product" | "service"
  name: string
  segment: string
}

type ErrorEnvelope = Readonly<{
  error?: Readonly<{
    code?: string
    fieldErrors?: Readonly<Record<string, readonly string[]>>
    message?: string
  }>
}>

function valuesFrom(item: CatalogItemDTO | null): FormValues {
  return item
    ? {
        description: item.description,
        itemKind: item.itemKind,
        name: item.name,
        segment: item.segment,
      }
    : { description: "", itemKind: "service", name: "", segment: "" }
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

export function CatalogFormSheet({ item, onClose, onSaved }: CatalogFormSheetProps) {
  const [values, setValues] = useState<FormValues>(() => valuesFrom(item))
  const [version, setVersion] = useState(item?.version)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, readonly string[]>>>({})
  const [conflict, setConflict] = useState<Readonly<{ current: CatalogItemDTO; local: FormValues }> | null>(null)
  const errorSummary = useRef<HTMLDivElement>(null)
  const conflictPanel = useRef<HTMLElement>(null)

  function update<Key extends keyof FormValues>(key: Key, value: FormValues[Key]) {
    setValues((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  async function currentItem(signal: AbortSignal): Promise<CatalogItemDTO | null> {
    if (!item) return null
    const response = await fetch(`/api/administrative/catalog-items/${item.id}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    })
    if (!response.ok) return null
    return (await response.json()) as CatalogItemDTO
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
      const editing = item !== null
      const response = await fetch(
        editing
          ? `/api/administrative/catalog-items/${item.id}`
          : "/api/administrative/catalog-items",
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
          body: JSON.stringify({
            ...values,
            ...(editing ? { version } : {}),
          }),
        },
      )
      const body = (await response.json()) as ErrorEnvelope & {
        record?: CatalogItemDTO
      }
      if (!response.ok) {
        if (response.status === 409 && body.error?.code === "VERSION_CONFLICT") {
          const current = await currentItem(controller.signal)
          if (current) {
            setConflict({ current, local: { ...values } })
            setVersion(current.version)
            requestAnimationFrame(() => conflictPanel.current?.focus())
            return
          }
        }
        setFieldErrors(body.error?.fieldErrors ?? {})
        setError(body.error?.message ?? "Não foi possível salvar o item.")
        requestAnimationFrame(() => errorSummary.current?.focus())
        return
      }
      if (!body.record) throw new Error("record")
      onSaved(body.record, !editing)
      onClose()
    } catch {
      setError("Não foi possível salvar o item. Verifique a conexão e tente novamente.")
      requestAnimationFrame(() => errorSummary.current?.focus())
    } finally {
      setPending(false)
    }
  }

  const editing = item !== null
  return (
    <Sheet open onOpenChange={(open) => { if (!open && !pending) onClose() }}>
      <SheetContent
        className="flex h-dvh w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        onEscapeKeyDown={(event) => { if (pending) event.preventDefault() }}
        onPointerDownOutside={(event) => { if (pending) event.preventDefault() }}
        showCloseButton={false}
        side="right"
      >
        <SheetHeader className="relative shrink-0 border-b border-border px-5 py-5 pr-16 sm:px-7">
          <SheetTitle>{editing ? "Editar item do catálogo" : "Novo item do catálogo"}</SheetTitle>
          <SheetDescription>
            Defina o tipo, o segmento e o texto que será usado ao montar propostas.
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
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-6 sm:px-7">
            <div aria-live="polite" ref={errorSummary} tabIndex={-1}>
              {error ? (
                <p className="border-l-2 border-destructive pl-3 text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            {conflict ? (
              <CatalogConflict
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
            <fieldset disabled={pending}>
              <legend className="text-sm font-medium">Tipo de item</legend>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <KindChoice
                  checked={values.itemKind === "service"}
                  icon={<WrenchIcon aria-hidden />}
                  label="Serviço"
                  onChange={() => update("itemKind", "service")}
                  value="service"
                />
                <KindChoice
                  checked={values.itemKind === "product"}
                  icon={<PackageIcon aria-hidden />}
                  label="Produto"
                  onChange={() => update("itemKind", "product")}
                  value="product"
                />
              </div>
            </fieldset>
            <fieldset className="space-y-5 border-t border-border pt-7" disabled={pending}>
              <legend className="mb-5 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Informações comerciais
              </legend>
              <FormField error={fieldErrors.name?.[0]} id="catalog-name" label="Nome">
                <Input
                  autoFocus
                  id="catalog-name"
                  maxLength={160}
                  minLength={2}
                  onChange={(event) => update("name", event.target.value)}
                  required
                  value={values.name}
                />
              </FormField>
              <FormField error={fieldErrors.segment?.[0]} id="catalog-segment" label="Segmento">
                <Input
                  id="catalog-segment"
                  maxLength={80}
                  minLength={2}
                  onChange={(event) => update("segment", event.target.value)}
                  required
                  value={values.segment}
                />
              </FormField>
              <FormField error={fieldErrors.description?.[0]} id="catalog-description" label="Descrição">
                <textarea
                  aria-describedby={fieldErrors.description?.[0] ? "catalog-description-error" : undefined}
                  className="min-h-40 w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  id="catalog-description"
                  maxLength={2000}
                  minLength={2}
                  onChange={(event) => update("description", event.target.value)}
                  required
                  value={values.description}
                />
              </FormField>
            </fieldset>
          </div>
          <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2 border-t border-border bg-background/95 px-5 py-4 backdrop-blur sm:px-7">
            <Button className="min-h-11" disabled={pending} onClick={onClose} type="button" variant="ghost">
              Cancelar
            </Button>
            <Button className="min-h-11" disabled={pending} type="submit">
              {pending ? "Salvando..." : editing ? "Salvar alterações" : "Criar item"}
            </Button>
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function KindChoice({ checked, icon, label, onChange, value }: Readonly<{
  checked: boolean
  icon: React.ReactNode
  label: string
  onChange: () => void
  value: string
}>) {
  return (
    <label className="flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border border-border px-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
      <input
        checked={checked}
        className="size-4 accent-primary"
        name="itemKind"
        onChange={onChange}
        type="radio"
        value={value}
      />
      <span aria-hidden className="text-primary">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
    </label>
  )
}

function FormField({ children, error, id, label }: Readonly<{
  children: ReactElement<{ "aria-describedby"?: string }>
  error?: string
  id: string
  label: string
}>) {
  const errorId = `${id}-error`
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, { "aria-describedby": error ? errorId : undefined })}
      {error ? <p className="text-xs text-destructive" id={errorId}>{error}</p> : null}
    </div>
  )
}

function CatalogConflict({ conflict, onReview, onUseCurrent, panelRef }: Readonly<{
  conflict: Readonly<{ current: CatalogItemDTO; local: FormValues }>
  onReview: () => void
  onUseCurrent: () => void
  panelRef: RefObject<HTMLElement | null>
}>) {
  return (
    <section
      aria-label="Conflito de edição do catálogo"
      className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="flex gap-3">
        <WarningCircleIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <h3 className="font-semibold">Este item mudou em outra sessão</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Sua descrição local foi preservada para comparação.
          </p>
        </div>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-3">
          <dt className="text-xs text-muted-foreground">Sua versão</dt>
          <dd className="mt-1 break-words">{conflict.local.description}</dd>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <dt className="text-xs text-muted-foreground">Versão atual</dt>
          <dd className="mt-1 break-words">{conflict.current.description}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button className="min-h-11" onClick={onUseCurrent} type="button" variant="outline">
          Usar versão atual
        </Button>
        <Button className="min-h-11" onClick={onReview} type="button">
          Revisar e tentar novamente
        </Button>
      </div>
    </section>
  )
}
