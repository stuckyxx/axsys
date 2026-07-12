import "server-only"

import { getPublicEnv } from "@/lib/env/public"
import { getAdminSupabase } from "@/lib/supabase/admin"
import type { CreateUploadIntentDependencies } from "@/modules/files/server/create-upload-intent"
import type { FileFinalizationStorage } from "@/modules/files/server/finalize-upload-intent"

type UploadCapabilityStorage = CreateUploadIntentDependencies["storage"]

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
