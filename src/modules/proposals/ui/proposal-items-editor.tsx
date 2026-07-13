"use client"

import {
  ArrowDownIcon,
  ArrowUpIcon,
  PackageIcon,
  PlusIcon,
  TrashIcon,
  WrenchIcon,
} from "@phosphor-icons/react"
import { useState } from "react"
import { useFieldArray, useFormContext } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  calculateProductTotal,
  calculateProposalTotal,
  calculateServiceTotal,
} from "@/lib/money/money"

export type ProposalCatalogOption = Readonly<{
  description: string
  id: string
  itemKind: "product" | "service"
  name: string
}>

export type ProposalEditorLine = {
  catalogItemId: string
  description: string
  kind: "product" | "service"
  monthlyAmount: string
  months: string
  quantity: string
  unitAmount: string
}

export type ProposalFormValues = {
  clientId: string
  issuedOn: string
  items: ProposalEditorLine[]
  segment: string
}

export function proposalPreviewTotal(lines: readonly ProposalEditorLine[]): string {
  try {
    return calculateProposalTotal(
      lines.map((line) =>
        line.kind === "service"
          ? calculateServiceTotal(Number(line.months), line.monthlyAmount)
          : calculateProductTotal(line.quantity, line.unitAmount),
      ),
    )
  } catch {
    return "0.00"
  }
}

export function ProposalItemsEditor({
  catalogItems,
}: Readonly<{ catalogItems: readonly ProposalCatalogOption[] }>) {
  const {
    control,
    formState: { errors },
    register,
    setValue,
    watch,
  } = useFormContext<ProposalFormValues>()
  const { append, fields, move, remove } = useFieldArray({ control, name: "items" })
  const lines = watch("items")
  const [announcement, setAnnouncement] = useState("")

  const add = (kind: ProposalEditorLine["kind"]) => {
    append({
      catalogItemId: "",
      description: "",
      kind,
      monthlyAmount: "",
      months: "",
      quantity: "",
      unitAmount: "",
    })
    setAnnouncement(`${kind === "service" ? "Serviço" : "Produto"} adicionado.`)
  }

  return (
    <section aria-labelledby="proposal-items-title" className="space-y-5 border-t border-border pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight" id="proposal-items-title">Itens da proposta</h2>
          <p className="mt-1 text-sm text-muted-foreground">A descrição selecionada será preservada como histórico.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" onClick={() => add("service")} type="button" variant="outline">
            <WrenchIcon aria-hidden />Adicionar serviço
          </Button>
          <Button className="min-h-11" onClick={() => add("product")} type="button" variant="outline">
            <PackageIcon aria-hidden />Adicionar produto
          </Button>
        </div>
      </div>
      <p aria-live="polite" className="sr-only">{announcement}</p>
      {fields.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          Adicione ao menos um serviço ou produto.
        </div>
      ) : (
        <div className="space-y-4">
          {fields.map((field, index) => {
            const line = lines[index] ?? field
            const options = catalogItems.filter((item) => item.itemKind === line.kind)
            const lineError = errors.items?.[index]
            const lineTotal = proposalPreviewTotal([line])
            return (
              <fieldset
                aria-label={`Item ${index + 1} — ${line.kind === "service" ? "Serviço" : "Produto"}`}
                className="rounded-2xl border border-border bg-card p-4 sm:p-5"
                key={field.id}
              >
                <legend className="px-2 text-sm font-semibold">
                  Item {index + 1} · {line.kind === "service" ? "Serviço" : "Produto"}
                </legend>
                <input type="hidden" {...register(`items.${index}.kind`)} />
                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="space-y-2 lg:col-span-2">
                    <Label htmlFor={`proposal-item-${index}`}>Item do catálogo</Label>
                    <select
                      className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      id={`proposal-item-${index}`}
                      value={line.catalogItemId}
                      {...register(`items.${index}.catalogItemId`, {
                        required: "Selecione um item.",
                        onChange: (event) => {
                          const selected = catalogItems.find(({ id }) => id === event.target.value)
                          if (selected) {
                            setValue(`items.${index}.description`, selected.description, {
                              shouldDirty: true,
                            })
                          }
                        },
                      })}
                    >
                      <option value="">Selecione</option>
                      {options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    {lineError?.catalogItemId?.message ? <p className="text-xs text-destructive">{lineError.catalogItemId.message}</p> : null}
                  </div>
                  <div className="space-y-2 lg:col-span-2">
                    <Label htmlFor={`proposal-description-${index}`}>Descrição preservada</Label>
                    <textarea
                      className="min-h-24 w-full resize-y rounded-lg border border-input bg-background p-3 text-sm"
                      id={`proposal-description-${index}`}
                      maxLength={2000}
                      {...register(`items.${index}.description`, {
                        minLength: { value: 2, message: "Informe a descrição." },
                        required: "Informe a descrição.",
                      })}
                    />
                  </div>
                  {line.kind === "service" ? (
                    <>
                      <EditorInput id={`proposal-months-${index}`} label="Meses" inputProps={{ min: 1, step: 1, type: "number", ...register(`items.${index}.months`, { required: true }) }} />
                      <EditorInput id={`proposal-monthly-${index}`} label="Valor mensal" inputProps={{ inputMode: "decimal", placeholder: "0.00", ...register(`items.${index}.monthlyAmount`, { required: true }) }} />
                    </>
                  ) : (
                    <>
                      <EditorInput id={`proposal-quantity-${index}`} label="Quantidade" inputProps={{ inputMode: "decimal", placeholder: "1", ...register(`items.${index}.quantity`, { required: true }) }} />
                      <EditorInput id={`proposal-unit-${index}`} label="Valor unitário" inputProps={{ inputMode: "decimal", placeholder: "0.00", ...register(`items.${index}.unitAmount`, { required: true }) }} />
                    </>
                  )}
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <p className="text-sm">Subtotal: <strong>R$ {lineTotal}</strong></p>
                  <div className="flex gap-1">
                    <Button aria-label={`Mover item ${index + 1} para cima`} className="size-11" disabled={index === 0} onClick={() => move(index, index - 1)} size="icon" type="button" variant="ghost"><ArrowUpIcon aria-hidden /></Button>
                    <Button aria-label={`Mover item ${index + 1} para baixo`} className="size-11" disabled={index === fields.length - 1} onClick={() => move(index, index + 1)} size="icon" type="button" variant="ghost"><ArrowDownIcon aria-hidden /></Button>
                    <Button aria-label={`Remover item ${index + 1}`} className="size-11 text-destructive hover:text-destructive" onClick={() => { remove(index); setAnnouncement(`Item ${index + 1} removido.`) }} size="icon" type="button" variant="ghost"><TrashIcon aria-hidden /></Button>
                  </div>
                </div>
              </fieldset>
            )
          })}
        </div>
      )}
      <Button className="min-h-11" onClick={() => add("service")} type="button" variant="ghost">
        <PlusIcon aria-hidden />Adicionar outro item
      </Button>
    </section>
  )
}

function EditorInput({
  id,
  inputProps,
  label,
}: Readonly<{
  id: string
  inputProps: React.ComponentProps<typeof Input>
  label: string
}>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input className="min-h-11" id={id} {...inputProps} />
    </div>
  )
}
