import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { chmodSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import postgres from "postgres"

type CanonicalEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: string
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string
  SUPABASE_SECRET_KEY: string
  DATABASE_URL: string
  BFF_DATABASE_URL: string
  APP_ORIGIN: string
  TRUST_PROXY: "true" | "false"
}

type SupabaseStatus = {
  apiUrl: string
  publishableKey: string
  secretKey: string
  databaseUrl: string
}

const APPLICATION_SECRET_KEYS = ["CSRF_SECRET", "SECURITY_HASH_PEPPER"] as const
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/u

function decodeEnvValue(rawValue: string): string {
  const value = rawValue.trim()
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }
  return value
}

export function parseEnv(text: string): Record<string, string> {
  const values = new Map<string, string>()
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/u)
    if (match) {
      values.set(match[1], decodeEnvValue(match[2]))
    }
  }
  return Object.fromEntries(values)
}

export function parseSupabaseStatus(text: string): SupabaseStatus {
  const status = parseEnv(text)
  const apiUrl = status.API_URL
  const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY
  const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY
  const databaseUrl = status.DB_URL

  if (!apiUrl || !publishableKey || !secretKey || !databaseUrl) {
    throw new Error("Supabase status did not return required local credentials")
  }

  return { apiUrl, publishableKey, secretKey, databaseUrl }
}

function serializeEnvironment(values: Readonly<Record<string, string>>): string {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n")}\n`
}

export function buildLocalEnvironment(input: {
  existingText: string
  canonical: CanonicalEnvironment
  generateSecret: () => string
}): string {
  const existing = parseEnv(input.existingText)
  const ownedKeys = new Set<string>([
    ...Object.keys(input.canonical),
    ...APPLICATION_SECRET_KEYS,
  ])
  const merged: Record<string, string> = { ...input.canonical }

  for (const key of APPLICATION_SECRET_KEYS) {
    merged[key] = existing[key] || input.generateSecret()
  }

  for (const [key, value] of Object.entries(existing)) {
    if (!ownedKeys.has(key)) {
      merged[key] = value
    }
  }

  return serializeEnvironment(merged)
}

export function writePrivateEnvFile(path: string, contents: string): void {
  try {
    chmodSync(path, 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
  }
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o600 })
  chmodSync(path, 0o600)
}

export function formatProvisioningFailure(error: unknown): string {
  void error
  return "Local environment provisioning failed.\n"
}

export async function provisionLocalEnvironment(): Promise<void> {
  const statusText = execFileSync("npx", ["supabase", "status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  const status = parseSupabaseStatus(statusText)
  const bffPassword = randomBytes(32).toString("base64url")
  if (!BASE64URL_32_BYTES.test(bffPassword)) {
    throw new Error("Generated BFF credential has an invalid format")
  }

  const adminSql = postgres(status.databaseUrl, { max: 1, prepare: false })
  try {
    // PostgreSQL utility statements do not accept bind parameters. This value is generated
    // locally and constrained to the base64url alphabet before reaching the static statement.
    await adminSql.unsafe(`alter role axsys_bff password '${bffPassword}'`)
  } finally {
    await adminSql.end()
  }

  const bffUrl = new URL(status.databaseUrl)
  if (bffUrl.protocol !== "postgres:" && bffUrl.protocol !== "postgresql:") {
    throw new Error("Supabase status returned an invalid database URL")
  }
  bffUrl.username = "axsys_bff"
  bffUrl.password = bffPassword

  let existingText = ""
  try {
    existingText = readFileSync(".env.local", "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
  }

  const output = buildLocalEnvironment({
    existingText,
    canonical: {
      NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.publishableKey,
      SUPABASE_SECRET_KEY: status.secretKey,
      DATABASE_URL: status.databaseUrl,
      BFF_DATABASE_URL: bffUrl.toString(),
      APP_ORIGIN: "http://127.0.0.1:3000",
      TRUST_PROXY: "false",
    },
    generateSecret: () => randomBytes(32).toString("base64url"),
  })

  writePrivateEnvFile(".env.local", output)
}

const entryPoint = process.argv[1]
if (entryPoint && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  provisionLocalEnvironment()
    .then(() => {
      process.stdout.write("Local environment provisioned without printing secrets.\n")
    })
    .catch((error: unknown) => {
      process.stderr.write(formatProvisioningFailure(error))
      process.exitCode = 1
    })
}
