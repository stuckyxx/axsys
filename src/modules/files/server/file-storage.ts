import "server-only"

import { getPublicEnv } from "@/lib/env/public"
import { getServerEnv } from "@/lib/env/server"
import { getAdminSupabase } from "@/lib/supabase/admin"
import type { CreateUploadIntentDependencies } from "@/modules/files/server/create-upload-intent"
import type { FileFinalizationStorage } from "@/modules/files/server/finalize-upload-intent"

type UploadCapabilityStorage = CreateUploadIntentDependencies["storage"]

export type PrivateDownloadStorage = Readonly<{
  downloadPrivate(
    path: string,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>>
}>

export type GeneratedDocumentStorage = Readonly<{
  uploadPdf(path: string, bytes: Buffer): Promise<void>
  removePrivate(path: string): Promise<void>
}>

const STORAGE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const PRIVATE_DOWNLOAD_FAILURE = "Private download unavailable"

export function createPrivateDownloadStorage(input: {
  baseUrl: string
  secretKey: string
  fetchImplementation?: typeof fetch
}): PrivateDownloadStorage {
  const fetchImplementation = input.fetchImplementation ?? fetch
  return Object.freeze({
    async downloadPrivate(path, signal) {
      const segments = path.split("/")
      if (
        segments.length < 3 ||
        segments.length > 6 ||
        !segments.every((segment) => STORAGE_PATH_SEGMENT.test(segment))
      ) {
        throw new Error(PRIVATE_DOWNLOAD_FAILURE)
      }
      const encodedPath = segments.map(encodeURIComponent).join("/")
      let response: Response
      try {
        response = await fetchImplementation(
          `${input.baseUrl.replace(/\/$/u, "")}/storage/v1/object/authenticated/axsys-private/${encodedPath}`,
          {
            cache: "no-store",
            redirect: "error",
            signal,
            headers: {
              apikey: input.secretKey,
              Authorization: `Bearer ${input.secretKey}`,
            },
          },
        )
      } catch {
        throw new Error(PRIVATE_DOWNLOAD_FAILURE)
      }
      if (!response.ok || response.body === null) {
        try {
          await response.body?.cancel()
        } catch {
          // The normalized failure never depends on Storage response details.
        }
        throw new Error(PRIVATE_DOWNLOAD_FAILURE)
      }
      return response.body
    },
  })
}

export function getPrivateDownloadStorage(): PrivateDownloadStorage {
  return createPrivateDownloadStorage({
    baseUrl: getPublicEnv().NEXT_PUBLIC_SUPABASE_URL,
    secretKey: getServerEnv().SUPABASE_SECRET_KEY,
  })
}

export function getResumableUploadEndpoint(): string {
  return `${getPublicEnv().NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/u, "")}/storage/v1/upload/resumable`
}

export function getUploadCapabilityStorage(): UploadCapabilityStorage {
  return Object.freeze({
    async createSignedUploadCapability({ bucket, path, upsert }) {
      const result = await getAdminSupabase()
        .storage.from(bucket)
        .createSignedUploadUrl(path, { upsert })
      if (result.error !== null || typeof result.data?.token !== "string") {
        throw new Error("Upload capability unavailable")
      }
      return Object.freeze({ token: result.data.token })
    },
  })
}

export function getFileFinalizationStorage(): FileFinalizationStorage {
  const admin = getAdminSupabase()
  return Object.freeze({
    async downloadQuarantine(path) {
      const result = await admin.storage.from("axsys-quarantine").download(path)
      if (result.error !== null || result.data === null) {
        throw new Error("Quarantine download unavailable")
      }
      return Buffer.from(await result.data.arrayBuffer())
    },

    async uploadPrivate({ path, bytes, contentType, upsert }) {
      const result = await admin.storage.from("axsys-private").upload(path, bytes, {
        cacheControl: "0",
        contentType,
        upsert,
      })
      if (result.error !== null) throw new Error("Private upload unavailable")
    },

    async removePrivate(path) {
      const result = await admin.storage.from("axsys-private").remove([path])
      if (result.error !== null) throw new Error("Private removal unavailable")
    },

    async removeQuarantine(path) {
      const result = await admin.storage.from("axsys-quarantine").remove([path])
      if (result.error !== null) throw new Error("Quarantine removal unavailable")
    },
  })
}

export function getGeneratedDocumentStorage(): GeneratedDocumentStorage {
  const admin = getAdminSupabase()
  return Object.freeze({
    async uploadPdf(path, bytes) {
      const result = await admin.storage.from("axsys-private").upload(path, bytes, {
        cacheControl: "0",
        contentType: "application/pdf",
        upsert: false,
      })
      if (result.error !== null) throw new Error("Document upload unavailable")
    },
    async removePrivate(path) {
      const result = await admin.storage.from("axsys-private").remove([path])
      if (result.error !== null) throw new Error("Document removal unavailable")
    },
  })
}
