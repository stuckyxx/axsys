"use client"

import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  UploadSimpleIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useEffect, useId, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import type {
  EnabledImagePurpose,
  FileObject,
} from "@/modules/files/domain/file-types"
import { useResumableUpload } from "@/modules/files/ui/use-resumable-upload"

type ImageUploadFieldProps = Readonly<{
  purpose: EnabledImagePurpose
  label: string
  description: string
  onReady?: (file: FileObject) => void
}>

export function ImageUploadField({
  purpose,
  label,
  description,
  onReady,
}: ImageUploadFieldProps) {
  const inputId = useId()
  const descriptionId = `${inputId}-description`
  const statusId = `${inputId}-status`
  const input = useRef<HTMLInputElement | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const { state, start, cancel, retry } = useResumableUpload()

  useEffect(() => {
    if (state.kind === "ready") onReady?.(state.file)
  }, [onReady, state])

  useEffect(() => () => {
    if (preview !== null) URL.revokeObjectURL(preview)
  }, [preview])

  const selectFile = (file: File | undefined) => {
    if (!file) return
    if (preview !== null) URL.revokeObjectURL(preview)
    setPreview(URL.createObjectURL(file))
    void start(file, purpose)
  }

  const busy = ["validating", "uploading", "quarantined", "scanning"].includes(
    state.kind,
  )

  return (
    <section className="space-y-3" aria-labelledby={`${inputId}-label`}>
      <div className="space-y-1">
        <label id={`${inputId}-label`} htmlFor={inputId} className="text-sm font-medium">
          {label}
        </label>
        <p id={descriptionId} className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          {description}
        </p>
      </div>

      <input
        ref={input}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-describedby={`${descriptionId} ${statusId}`}
        onChange={(event) => selectFile(event.currentTarget.files?.[0])}
      />

      <div
        className="grid min-h-40 grid-cols-[5rem_1fr] items-center gap-4 rounded-2xl border border-dashed border-border bg-card/45 p-4 transition-[border-color,background-color,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] focus-within:border-primary/60 sm:grid-cols-[6rem_1fr_auto] sm:p-5"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          selectFile(event.dataTransfer.files[0])
        }}
      >
        <button
          type="button"
          className="flex size-20 items-center justify-center overflow-hidden rounded-xl border bg-background text-muted-foreground transition-transform duration-300 active:scale-[0.98] sm:size-24"
          onClick={() => input.current?.click()}
          disabled={busy}
          aria-label={`Selecionar ${label.toLowerCase()}`}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- ephemeral local Object URL.
            <img src={preview} alt="Prévia local" className="size-full object-cover" />
          ) : (
            <UploadSimpleIcon size={28} weight="duotone" aria-hidden="true" />
          )}
        </button>

        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium">
            {state.kind === "ready"
              ? "Arquivo verificado"
              : busy
                ? "Processando com segurança"
                : "Arraste a imagem ou selecione no dispositivo"}
          </p>
          {state.kind === "uploading" ? (
            <div
              role="progressbar"
              aria-label="Progresso do upload"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state.progress}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full origin-left rounded-full bg-primary transition-transform duration-300"
                style={{ transform: `scaleX(${state.progress / 100})` }}
              />
            </div>
          ) : null}
          <p id={statusId} aria-live="polite" className="text-xs text-muted-foreground">
            {state.kind === "validating" && "Validando arquivo…"}
            {state.kind === "quarantined" && "Upload concluído; preparando análise…"}
            {state.kind === "scanning" && "Verificando conteúdo e removendo metadados…"}
            {state.kind === "ready" && "Imagem limpa, normalizada e pronta para uso."}
            {state.kind === "failed" && "Não foi possível concluir o upload."}
            {state.kind === "idle" && "PNG, JPG ou WebP · até 5 MiB."}
          </p>
        </div>

        <div className="col-span-2 flex gap-2 sm:col-span-1 sm:justify-end">
          {state.kind === "failed" ? (
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              <ArrowClockwiseIcon size={16} aria-hidden="true" />
              Tentar novamente
            </Button>
          ) : null}
          {busy ? (
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              <XIcon size={16} aria-hidden="true" />
              Cancelar
            </Button>
          ) : null}
          {state.kind === "ready" ? (
            <span className="inline-flex items-center gap-2 text-sm text-primary">
              <CheckCircleIcon size={18} weight="fill" aria-hidden="true" />
              Pronto
            </span>
          ) : null}
        </div>
      </div>
    </section>
  )
}
