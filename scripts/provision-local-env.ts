import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
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

export type ExistingEnvironment = {
  exists: boolean
  contents: string
  device?: number
  inode?: number
}

export type StagedEnvironment = {
  commit: () => void
  discard: () => void
}

export type ProvisionRuntime = {
  getStatusText: () => string
  generateSecret: () => string
  readEnvironment: (path: string) => ExistingEnvironment
  stageEnvironment: (
    path: string,
    contents: string,
    existing: ExistingEnvironment,
  ) => StagedEnvironment
  hardenPublicPrivileges: (databaseUrl: string) => Promise<void>
  setBffPassword: (
    databaseUrl: string,
    password: string | null,
    onApplied: () => void,
  ) => Promise<void>
}

const APPLICATION_SECRET_KEYS = ["CSRF_SECRET", "SECURITY_HASH_PEPPER"] as const
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/u
const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])
const PROVISIONING_FAILURE = "Local environment provisioning failed"
const PUBLIC_PRIVILEGE_HARDENING_SQL = `
revoke all privileges on all tables in schema public from public;
revoke all privileges on all sequences in schema public from public;
revoke all privileges on all functions in schema public from public;
revoke all privileges on all tables in schema public
  from anon, service_role;
revoke insert, update, delete, truncate, references, trigger, maintain
  on all tables in schema public
  from authenticated;
revoke all privileges on all sequences in schema public
  from anon, authenticated, service_role;
revoke all privileges on all functions in schema public
  from anon, authenticated, service_role;
revoke all privileges on all tables in schema public from axsys_bff;
revoke all privileges on all sequences in schema public from axsys_bff;
revoke all privileges on all functions in schema public from axsys_bff;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'private') then
    revoke all privileges on all functions in schema private
      from public;
    if to_regtype('private.auth_session_state') is not null then
      revoke all privileges on type private.auth_session_state
        from public, anon, authenticated, service_role, axsys_bff;
    end if;
  end if;
end
$$;

alter default privileges for role postgres
  revoke usage on types
  from public, anon, authenticated, service_role, axsys_bff;
alter default privileges for role supabase_admin
  revoke usage on types
  from public, anon, authenticated, service_role, axsys_bff;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated, service_role, axsys_bff;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated, service_role, axsys_bff;
alter default privileges for role postgres in schema public
  revoke all privileges on functions from anon, authenticated, service_role, axsys_bff;
alter default privileges for role postgres
  revoke all privileges on tables from anon, authenticated, service_role, axsys_bff;
alter default privileges for role postgres
  revoke all privileges on sequences from anon, authenticated, service_role, axsys_bff;
alter default privileges for role postgres
  revoke all privileges on functions from anon, authenticated, service_role, axsys_bff;
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public;
alter default privileges for role postgres in schema public
  revoke all privileges on functions from public;
alter default privileges for role postgres
  revoke all privileges on tables from public;
alter default privileges for role postgres
  revoke all privileges on sequences from public;
alter default privileges for role postgres
  revoke all privileges on functions from public;

alter default privileges for role supabase_admin in schema public
  revoke all privileges on tables from anon, authenticated, service_role, axsys_bff;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on sequences from anon, authenticated, service_role, axsys_bff;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on functions from anon, authenticated, service_role, axsys_bff;
alter default privileges for role supabase_admin
  revoke all privileges on tables from anon, authenticated, service_role, axsys_bff;
alter default privileges for role supabase_admin
  revoke all privileges on sequences from anon, authenticated, service_role, axsys_bff;
alter default privileges for role supabase_admin
  revoke all privileges on functions from anon, authenticated, service_role, axsys_bff;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on tables from public;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on sequences from public;
alter default privileges for role supabase_admin in schema public
  revoke all privileges on functions from public;
alter default privileges for role supabase_admin
  revoke all privileges on tables from public;
alter default privileges for role supabase_admin
  revoke all privileges on sequences from public;
alter default privileges for role supabase_admin
  revoke all privileges on functions from public;

do $$
begin
  if exists (
    select 1
    from pg_default_acl defaults
    cross join lateral aclexplode(defaults.defaclacl) grant_item
    join pg_roles owner_role on owner_role.oid = defaults.defaclrole
    join pg_roles grantee_role on grantee_role.oid = grant_item.grantee
    where defaults.defaclnamespace in (0, 'public'::regnamespace)
      and owner_role.rolname in ('postgres', 'supabase_admin')
      and grantee_role.rolname in ('anon', 'authenticated', 'service_role', 'axsys_bff')
      and defaults.defaclobjtype in ('r', 'S', 'f', 'T')
  ) then
    raise exception 'public default ACL assertion failed: unexpected API role grant';
  end if;

  if exists (
    select 1
    from pg_default_acl defaults
    cross join lateral aclexplode(defaults.defaclacl) grant_item
    join pg_roles owner_role on owner_role.oid = defaults.defaclrole
    where defaults.defaclnamespace in (0, 'public'::regnamespace)
      and owner_role.rolname in ('postgres', 'supabase_admin')
      and defaults.defaclobjtype in ('r', 'S', 'f', 'T')
      and grant_item.grantee = 0
  ) then
    raise exception 'public default ACL assertion failed: unexpected PUBLIC object grant';
  end if;

  if 2 <> (
    select count(*)
    from pg_default_acl defaults
    join pg_roles owner_role on owner_role.oid = defaults.defaclrole
    where defaults.defaclnamespace = 0
      and owner_role.rolname in ('postgres', 'supabase_admin')
      and defaults.defaclobjtype = 'f'
      and not exists (
        select 1
        from aclexplode(defaults.defaclacl) grant_item
        where grant_item.grantee = 0
      )
  ) then
    raise exception 'global default ACL assertion failed: PUBLIC function grant remains';
  end if;

  if 2 <> (
    select count(*)
    from pg_default_acl defaults
    join pg_roles owner_role on owner_role.oid = defaults.defaclrole
    where defaults.defaclnamespace = 0
      and owner_role.rolname in ('postgres', 'supabase_admin')
      and defaults.defaclobjtype = 'T'
      and not exists (
        select 1
        from aclexplode(defaults.defaclacl) grant_item
        left join pg_roles grantee_role on grantee_role.oid = grant_item.grantee
        where grant_item.grantee = 0
           or grantee_role.rolname in (
             'anon', 'authenticated', 'service_role', 'axsys_bff'
           )
      )
  ) then
    raise exception 'global type default ACL assertion failed';
  end if;
end
$$;
`

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

export function validateLocalDatabaseUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("Supabase status returned an invalid local database URL")
  }

  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    url.username !== "postgres" ||
    !LOCAL_DATABASE_HOSTS.has(url.hostname) ||
    url.port !== "54322" ||
    url.pathname !== "/postgres" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Supabase status returned an invalid local database URL")
  }
  return url
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

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT"
}

export function readPrivateEnvFile(path: string): ExistingEnvironment {
  let pathState: ReturnType<typeof lstatSync>
  try {
    pathState = lstatSync(path)
  } catch (error) {
    if (isMissingFile(error)) return { exists: false, contents: "" }
    throw error
  }

  if (pathState.isSymbolicLink() || !pathState.isFile()) {
    throw new Error("Environment destination must be a regular file")
  }

  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const descriptorState = fstatSync(descriptor)
    if (
      !descriptorState.isFile() ||
      descriptorState.dev !== pathState.dev ||
      descriptorState.ino !== pathState.ino
    ) {
      throw new Error("Environment destination changed during validation")
    }
    return {
      exists: true,
      contents: readFileSync(descriptor, "utf8"),
      device: descriptorState.dev,
      inode: descriptorState.ino,
    }
  } finally {
    closeSync(descriptor)
  }
}

function assertSameEnvironment(
  actual: ExistingEnvironment,
  expected: ExistingEnvironment,
): void {
  if (actual.exists !== expected.exists || actual.contents !== expected.contents) {
    throw new Error("Environment destination changed during staging")
  }
  if (
    expected.exists &&
    expected.device !== undefined &&
    expected.inode !== undefined &&
    (actual.device !== expected.device || actual.inode !== expected.inode)
  ) {
    throw new Error("Environment destination changed during staging")
  }
}

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
}

function createSyncedTemporaryFile(
  directory: string,
  targetName: string,
  contents: string,
): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const temporaryPath = join(
      directory,
      `.${targetName}.${randomBytes(12).toString("hex")}.tmp`,
    )
    let descriptor: number
    try {
      descriptor = openSync(
        temporaryPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue
      throw error
    }

    try {
      fchmodSync(descriptor, 0o600)
      writeFileSync(descriptor, contents, { encoding: "utf8" })
      fsyncSync(descriptor)
      return temporaryPath
    } catch (error) {
      removeIfPresent(temporaryPath)
      throw error
    } finally {
      closeSync(descriptor)
    }
  }
  throw new Error("Unable to reserve a private environment staging file")
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function restoreEnvironment(
  targetPath: string,
  existing: ExistingEnvironment,
): void {
  const directory = dirname(targetPath)
  if (!existing.exists) {
    removeIfPresent(targetPath)
    syncDirectory(directory)
    return
  }

  const recoveryPath = createSyncedTemporaryFile(
    directory,
    basename(targetPath),
    existing.contents,
  )
  try {
    renameSync(recoveryPath, targetPath)
    syncDirectory(directory)
  } catch (error) {
    removeIfPresent(recoveryPath)
    throw error
  }
}

export function stagePrivateEnvFile(
  path: string,
  contents: string,
  existing: ExistingEnvironment = readPrivateEnvFile(path),
  syncCommittedDirectory: (directory: string) => void = syncDirectory,
): StagedEnvironment {
  const targetPath = resolve(path)
  assertSameEnvironment(readPrivateEnvFile(targetPath), existing)
  const temporaryPath = createSyncedTemporaryFile(
    dirname(targetPath),
    basename(targetPath),
    contents,
  )
  let temporaryExists = true

  return {
    commit() {
      let renamed = false
      try {
        assertSameEnvironment(readPrivateEnvFile(targetPath), existing)
        renameSync(temporaryPath, targetPath)
        temporaryExists = false
        renamed = true
        syncCommittedDirectory(dirname(targetPath))
      } catch (error) {
        if (renamed) {
          try {
            restoreEnvironment(targetPath, existing)
          } catch {
            // Recovery is best-effort here; the caller also rolls back the DB password.
          }
        }
        throw error
      }
    },
    discard() {
      if (temporaryExists) {
        removeIfPresent(temporaryPath)
        temporaryExists = false
      }
    },
  }
}

export function writePrivateEnvFile(path: string, contents: string): void {
  const existing = readPrivateEnvFile(path)
  const staged = stagePrivateEnvFile(path, contents, existing)
  try {
    staged.commit()
  } catch (error) {
    staged.discard()
    throw error
  }
}

function rollbackPasswordFromEnvironment(existingText: string): string | null {
  const value = parseEnv(existingText).BFF_DATABASE_URL
  if (!value) return null
  try {
    const url = new URL(value)
    if (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      url.username === "axsys_bff" &&
      LOCAL_DATABASE_HOSTS.has(url.hostname) &&
      url.port === "54322" &&
      url.pathname === "/postgres" &&
      url.search === "" &&
      url.hash === "" &&
      BASE64URL_32_BYTES.test(url.password)
    ) {
      return url.password
    }
  } catch {
    // An invalid previous URL is never used to build SQL or restore a credential.
  }
  return null
}

async function setBffPassword(
  databaseUrl: string,
  password: string | null,
  onApplied: () => void,
): Promise<void> {
  if (password !== null && !BASE64URL_32_BYTES.test(password)) {
    throw new Error("BFF credential has an invalid format")
  }
  const statement =
    password === null
      ? "alter role axsys_bff password null"
      : `alter role axsys_bff password '${password}'`
  const adminSql = postgres(databaseUrl, { max: 1, prepare: false })
  try {
    // PostgreSQL utility statements do not accept bind parameters. The only interpolated
    // value is constrained to the 32-byte base64url alphabet before reaching this statement.
    await adminSql.unsafe(statement)
    onApplied()
  } finally {
    await adminSql.end()
  }
}

function buildSupabaseAdminUrl(databaseUrl: URL): string {
  const url = new URL(databaseUrl)
  url.username = "supabase_admin"
  return url.toString()
}

export async function hardenLocalPublicPrivileges(
  databaseUrl: string,
): Promise<void> {
  const adminSql = postgres(databaseUrl, { max: 1, prepare: false })
  try {
    await adminSql.begin(async (transaction) => {
      const [identity] = await transaction<[{ valid: boolean }]>`
        select current_user = 'supabase_admin' as valid
      `
      if (identity?.valid !== true) {
        throw new Error("Local database privilege owner assertion failed")
      }
      await transaction.unsafe(PUBLIC_PRIVILEGE_HARDENING_SQL)
    })
  } finally {
    await adminSql.end()
  }
}

const realRuntime: ProvisionRuntime = {
  getStatusText() {
    return execFileSync("npx", ["supabase", "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      killSignal: "SIGKILL",
    })
  },
  generateSecret() {
    return randomBytes(32).toString("base64url")
  },
  readEnvironment: readPrivateEnvFile,
  stageEnvironment: stagePrivateEnvFile,
  hardenPublicPrivileges: hardenLocalPublicPrivileges,
  setBffPassword,
}

async function provisionWithRuntime(runtime: ProvisionRuntime): Promise<void> {
  const status = parseSupabaseStatus(runtime.getStatusText())
  const databaseUrl = validateLocalDatabaseUrl(status.databaseUrl)
  const existing = runtime.readEnvironment(".env.local")
  const bffPassword = runtime.generateSecret()
  if (!BASE64URL_32_BYTES.test(bffPassword)) {
    throw new Error("Generated BFF credential has an invalid format")
  }

  const bffUrl = new URL(databaseUrl)
  bffUrl.username = "axsys_bff"
  bffUrl.password = bffPassword
  const output = buildLocalEnvironment({
    existingText: existing.contents,
    canonical: {
      NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.publishableKey,
      SUPABASE_SECRET_KEY: status.secretKey,
      DATABASE_URL: databaseUrl.toString(),
      BFF_DATABASE_URL: bffUrl.toString(),
      APP_ORIGIN: "http://127.0.0.1:3000",
      TRUST_PROXY: "false",
    },
    generateSecret: runtime.generateSecret,
  })
  const staged = runtime.stageEnvironment(".env.local", output, existing)
  const rollbackPassword = rollbackPasswordFromEnvironment(existing.contents)
  const privilegeOwnerUrl = buildSupabaseAdminUrl(databaseUrl)
  let passwordRotationAttempted = false

  try {
    await runtime.hardenPublicPrivileges(privilegeOwnerUrl)
    passwordRotationAttempted = true
    await runtime.setBffPassword(databaseUrl.toString(), bffPassword, () => {})
    staged.commit()
  } catch (error) {
    if (passwordRotationAttempted) {
      try {
        await runtime.setBffPassword(databaseUrl.toString(), rollbackPassword, () => {})
      } catch {
        // Rollback was attempted; no database or credential detail crosses this boundary.
      }
    }
    try {
      staged.discard()
    } catch {
      // The fixed outward error remains independent of filesystem cleanup details.
    }
    throw error
  }
}

export function formatProvisioningFailure(error: unknown): string {
  void error
  return `${PROVISIONING_FAILURE}.\n`
}

export async function provisionLocalEnvironment(
  runtime: ProvisionRuntime = realRuntime,
): Promise<void> {
  try {
    await provisionWithRuntime(runtime)
  } catch {
    throw new Error(PROVISIONING_FAILURE)
  }
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
