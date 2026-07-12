"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import * as tus from "tus-js-client"

import type {
  EnabledImagePurpose,
  FileObject,
} from "@/modules/files/domain/file-types"

export type ResumableUploadState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "validating" }>
  | Readonly<{ kind: "uploading"; progress: number }>
  | Readonly<{ kind: "quarantined" }>
  | Readonly<{ kind: "scanning" }>
  | Readonly<{ kind: "ready"; file: FileObject }>
  | Readonly<{ kind: "failed"; code: string }>

type UploadHandshake = Readonly<{
  intentId: string
  endpoint: string
  bucket: "axsys-quarantine"
  path: string
  token: string
  uploadAuthorizationExpiresAt: string
  finalizeBefore: string
  maxBytes: number
  allowedMimeTypes: readonly string[]
}>

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isHandshake(value: unknown): value is UploadHandshake {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  const expected = [
    "allowedMimeTypes",
    "bucket",
    "endpoint",
    "finalizeBefore",
    "intentId",
    "maxBytes",
    "path",
    "token",
    "uploadAuthorizationExpiresAt",
  ]
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    UUID.test(value.intentId as string) &&
    value.bucket === "axsys-quarantine" &&
    typeof value.endpoint === "string" &&
    typeof value.path === "string" &&
    typeof value.token === "string" &&
    (value.token as string).length > 0 &&
    Number.isSafeInteger(value.maxBytes) &&
    (value.maxBytes as number) > 0 &&
    Array.isArray(value.allowedMimeTypes) &&
    value.allowedMimeTypes.every((mime) => typeof mime === "string") &&
    Number.isFinite(Date.parse(value.uploadAuthorizationExpiresAt as string)) &&
    Number.isFinite(Date.parse(value.finalizeBefore as string))
  )
}

async function csrfToken(signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/auth/csrf", {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  })
  const body = (await response.json().catch(() => null)) as unknown
  if (
    !response.ok ||
    !isRecord(body) ||
    typeof body.token !== "string" ||
    body.token.length < 1 ||
    body.token.length > 4_096
  ) {
    throw new Error("CSRF_UNAVAILABLE")
  }
  return body.token
}

export function useResumableUpload() {
  const [state, setState] = useState<ResumableUploadState>({ kind: "idle" })
  const mounted = useRef(true)
  const uploadRef = useRef<tus.Upload | null>(null)
  const requestRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    requestRef.current?.abort()
    requestRef.current = null
    void uploadRef.current?.abort().catch(() => undefined)
    uploadRef.current = null
    if (mounted.current) setState({ kind: "idle" })
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestRef.current?.abort()
      void uploadRef.current?.abort().catch(() => undefined)
      requestRef.current = null
      uploadRef.current = null
    }
  }, [])

  const start = useCallback(
    async (file: File, purpose: EnabledImagePurpose): Promise<void> => {
      cancel()
      const controller = new AbortController()
      requestRef.current = controller
      setState({ kind: "validating" })
      try {
        const token = await csrfToken(controller.signal)
        const handshakeResponse = await fetch("/api/files/uploads", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": token,
          },
          body: JSON.stringify({
            purpose,
            targetResourceId: null,
            declaredName: file.name,
            declaredMime: file.type,
            declaredSize: file.size,
          }),
          signal: controller.signal,
        })
        const rawHandshake = (await handshakeResponse.json().catch(() => null)) as unknown
        if (!handshakeResponse.ok || !isHandshake(rawHandshake)) {
          throw new Error("UPLOAD_HANDSHAKE_FAILED")
        }
        const handshake = rawHandshake
        if (
          file.size > handshake.maxBytes ||
          !handshake.allowedMimeTypes.includes(file.type)
        ) {
          throw new Error("UPLOAD_FILE_INVALID")
        }

        const finalize = async () => {
          if (!mounted.current) return
          setState({ kind: "quarantined" })
          setState({ kind: "scanning" })
          const response = await fetch(
            `/api/files/uploads/${encodeURIComponent(handshake.intentId)}/finalize`,
            {
              method: "POST",
              cache: "no-store",
              credentials: "same-origin",
              headers: { "x-csrf-token": token },
              signal: controller.signal,
            },
          )
          const body = (await response.json().catch(() => null)) as unknown
          if (!response.ok || !isRecord(body) || body.status !== "ready") {
            throw new Error("UPLOAD_FINALIZE_FAILED")
          }
          if (mounted.current) {
            setState({ kind: "ready", file: body as FileObject })
          }
        }

        const upload = new tus.Upload(file, {
          endpoint: handshake.endpoint,
          retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
          headers: { "x-signature": handshake.token, "x-upsert": "false" },
          chunkSize: 6 * 1024 * 1024,
          uploadDataDuringCreation: true,
          storeFingerprintForResuming: false,
          removeFingerprintOnSuccess: true,
          // tus-js-client accepts null at runtime to disable URL persistence;
          // its current declaration omits that documented sentinel.
          urlStorage: null as never,
          metadata: {
            bucketName: handshake.bucket,
            objectName: handshake.path,
            contentType: file.type,
            cacheControl: "0",
          },
          onProgress(bytesUploaded, bytesTotal) {
            if (!mounted.current) return
            const progress =
              bytesTotal > 0
                ? Math.min(100, Math.round((bytesUploaded / bytesTotal) * 100))
                : 0
            setState({ kind: "uploading", progress })
          },
          onError() {
            if (mounted.current) {
              setState({ kind: "failed", code: "UPLOAD_TRANSFER_FAILED" })
            }
          },
          onSuccess() {
            void finalize().catch((error: unknown) => {
              if (mounted.current && !(error instanceof DOMException && error.name === "AbortError")) {
                setState({ kind: "failed", code: "UPLOAD_FINALIZE_FAILED" })
              }
            })
          },
        })
        uploadRef.current = upload
        setState({ kind: "uploading", progress: 0 })
        upload.start()
      } catch (error) {
        if (
          mounted.current &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setState({
            kind: "failed",
            code: error instanceof Error ? error.message : "UPLOAD_FAILED",
          })
        }
      }
    },
    [cancel],
  )

  const retry = useCallback(() => {
    if (uploadRef.current === null) return
    setState({ kind: "uploading", progress: 0 })
    uploadRef.current.start()
  }, [])

  return { state, start, cancel, retry } as const
}
