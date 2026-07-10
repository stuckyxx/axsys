import "server-only"

import { z } from "zod"

const serverEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20),
  BFF_DATABASE_URL: z.url().startsWith("postgres"),
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
