import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { loadEnvFile } from "node:process"
import { pathToFileURL } from "node:url"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import postgres from "postgres"
import { z } from "zod"

import type { Database } from "../src/lib/supabase/database.types"
import { validatePassword } from "../src/modules/auth/domain/password-policy"

const BOOTSTRAP_FAILURE = "Local super-admin bootstrap failed"
const INVALID_ENVIRONMENT = "Invalid local bootstrap environment"
const DISPLAY_NAME = "Administrador da Plataforma"
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])
const emailSchema = z.string().trim().toLowerCase().email().max(254)
const userIdSchema = z.uuid()

type BootstrapIdentityInput = Readonly<{
  databaseUrl: string
  displayName: string
  email: string
  userId: string
}>

type BootstrapEnvironment = Readonly<Record<string, string | undefined>>

export type BootstrapRuntime = Readonly<{
  createAuthUser(input: Readonly<{ email: string; password: string }>): Promise<string>
  deleteAuthUser(userId: string): Promise<void>
  insertPlatformIdentity(input: BootstrapIdentityInput): Promise<void>
  validatePassword(password: string): Promise<void>
}>

type BootstrapRuntimeConfiguration = Readonly<{
  secretKey: string
  supabaseUrl: string
}>

export type BootstrapRuntimeFactory = (
  configuration: BootstrapRuntimeConfiguration,
) => BootstrapRuntime

class BootstrapConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BootstrapConfigurationError"
  }
}

function requiredEnvironment(
  environment: BootstrapEnvironment,
  key:
    | "AXSYS_BOOTSTRAP_SUPER_ADMIN_EMAIL"
    | "AXSYS_BOOTSTRAP_SUPER_ADMIN_PASSWORD"
    | "DATABASE_URL"
    | "NEXT_PUBLIC_SUPABASE_URL"
    | "SUPABASE_SECRET_KEY",
): string {
  const value = environment[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new BootstrapConfigurationError(
      `Missing required local bootstrap environment: ${key}`,
    )
  }
  return value
}

function validateLocalDatabaseUrl(value: string): string {
  try {
    const url = new URL(value)
    if (
      (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
      url.username !== "postgres" ||
      !LOCAL_HOSTS.has(url.hostname) ||
      url.port !== "54322" ||
      url.pathname !== "/postgres" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error(INVALID_ENVIRONMENT)
    }
    return url.toString()
  } catch {
    throw new BootstrapConfigurationError(INVALID_ENVIRONMENT)
  }
}

function validateLocalSupabaseUrl(value: string): string {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "http:" ||
      !LOCAL_HOSTS.has(url.hostname) ||
      url.port !== "54321" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error(INVALID_ENVIRONMENT)
    }
    return url.origin
  } catch {
    throw new BootstrapConfigurationError(INVALID_ENVIRONMENT)
  }
}

const createRealRuntime: BootstrapRuntimeFactory = ({
  secretKey,
  supabaseUrl,
}) => {
  let adminClient: SupabaseClient<Database> | null = null
  const getAdminClient = (): SupabaseClient<Database> => {
    adminClient ??= createClient<Database>(supabaseUrl, secretKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, cache: "no-store", redirect: "error" }),
      },
    })
    return adminClient
  }

  return {
    validatePassword,
    async createAuthUser({ email, password }) {
      const result = await getAdminClient().auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (result.error !== null || result.data.user === null) {
        throw new Error(BOOTSTRAP_FAILURE)
      }
      return result.data.user.id
    },
    async deleteAuthUser(userId) {
      const result = await getAdminClient().auth.admin.deleteUser(userId)
      if (result.error !== null) throw new Error(BOOTSTRAP_FAILURE)
    },
    async insertPlatformIdentity({
      databaseUrl,
      displayName,
      email,
      userId,
    }) {
      const sql = postgres(databaseUrl, {
        max: 1,
        prepare: false,
        connect_timeout: 5,
        idle_timeout: 5,
      })
      try {
        await sql.begin(async (transaction) => {
          const [identity] = await transaction<[{ isPostgres: boolean }]>`
            select current_user = 'postgres' as "isPostgres"
          `
          if (identity?.isPostgres !== true) throw new Error(BOOTSTRAP_FAILURE)

          await transaction`
            insert into public.profiles (
              user_id,
              email,
              display_name,
              preferred_theme,
              must_change_password,
              temporary_password_expires_at,
              password_changed_at,
              is_active,
              version
            ) values (
              ${userId}::uuid,
              ${email},
              ${displayName},
              'dark'::public.theme_preference,
              false,
              null,
              clock_timestamp(),
              true,
              1
            )
          `
          await transaction`
            insert into public.platform_roles (
              user_id,
              role,
              is_active,
              created_by
            ) values (
              ${userId}::uuid,
              'super_admin'::public.platform_role,
              true,
              ${userId}::uuid
            )
          `
        })
      } finally {
        await sql.end()
      }
    },
  }
}

export async function bootstrapLocalSuperAdmin(
  environment: BootstrapEnvironment = process.env,
  runtime?: BootstrapRuntime,
  runtimeFactory: BootstrapRuntimeFactory = createRealRuntime,
): Promise<string> {
  const rawEmail = requiredEnvironment(
    environment,
    "AXSYS_BOOTSTRAP_SUPER_ADMIN_EMAIL",
  )
  const password = requiredEnvironment(
    environment,
    "AXSYS_BOOTSTRAP_SUPER_ADMIN_PASSWORD",
  )
  const databaseUrl = validateLocalDatabaseUrl(
    requiredEnvironment(environment, "DATABASE_URL"),
  )
  const supabaseUrl = validateLocalSupabaseUrl(
    requiredEnvironment(environment, "NEXT_PUBLIC_SUPABASE_URL"),
  )
  const secretKey = requiredEnvironment(environment, "SUPABASE_SECRET_KEY")
  const activeRuntime =
    runtime ?? runtimeFactory(Object.freeze({ secretKey, supabaseUrl }))

  const parsedEmail = emailSchema.safeParse(rawEmail)
  if (!parsedEmail.success) {
    throw new BootstrapConfigurationError(INVALID_ENVIRONMENT)
  }

  try {
    await activeRuntime.validatePassword(password)
  } catch {
    throw new Error(BOOTSTRAP_FAILURE)
  }

  let userId: string
  try {
    userId = await activeRuntime.createAuthUser({
      email: parsedEmail.data,
      password,
    })
  } catch {
    throw new Error(BOOTSTRAP_FAILURE)
  }

  if (!userIdSchema.safeParse(userId).success) {
    try {
      await activeRuntime.deleteAuthUser(userId)
    } catch {
      // Compensation was attempted; the outward error remains credential-free.
    }
    throw new Error(BOOTSTRAP_FAILURE)
  }

  try {
    await activeRuntime.insertPlatformIdentity({
      databaseUrl,
      displayName: DISPLAY_NAME,
      email: parsedEmail.data,
      userId,
    })
  } catch {
    try {
      await activeRuntime.deleteAuthUser(userId)
    } catch {
      // Compensation was attempted; the outward error remains credential-free.
    }
    throw new Error(BOOTSTRAP_FAILURE)
  }

  return userId
}

export function formatBootstrapFailure(error: unknown): string {
  if (error instanceof BootstrapConfigurationError) {
    return `${error.message}.\n`
  }
  return `${BOOTSTRAP_FAILURE}.\n`
}

const entryPoint = process.argv[1]
if (entryPoint && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  const environmentPath = resolve(".env.local")
  if (existsSync(environmentPath)) loadEnvFile(environmentPath)

  bootstrapLocalSuperAdmin()
    .then((userId) => {
      process.stdout.write(`${userId}\n`)
    })
    .catch((error: unknown) => {
      process.stderr.write(formatBootstrapFailure(error))
      process.exitCode = 1
    })
}
