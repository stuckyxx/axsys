import "server-only"

import { z } from "zod"

const bffDatabaseUrlSchema = z.url().refine((value) => {
  try {
    const url = new URL(value)
    return (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      url.username === "axsys_bff"
    )
  } catch {
    return false
  }
})

const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20),
  BFF_DATABASE_URL: bffDatabaseUrlSchema,
  APP_ORIGIN: z.url(),
  CSRF_SECRET: z.string().min(32),
  SECURITY_HASH_PEPPER: z.string().min(32),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
})

export function getServerEnv() {
  const parsed = serverEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    throw new Error("Invalid server environment")
  }
  return parsed.data
}
