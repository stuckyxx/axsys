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
  CLAMAV_HOST: string
  CLAMAV_PORT: string
  SUPABASE_STORAGE_TUS_ENDPOINT: string
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
  generateEncryptionKey: () => string
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
const ENCRYPTION_SECRET_KEYS = [
  "BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64",
  "PII_ENCRYPTION_KEY_V1_BASE64",
] as const
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/u
const BASE64_32_BYTES = /^[A-Za-z0-9+/]{43}=$/u
const ENV_ASSIGNMENT_PATTERN =
  /^[\t \uFEFF]*(?:export[\t ]+)?([\w.-]+)(?:[\t ]*=[\t ]*|:[\t ]+)('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`|[^#\r\n]*)[\t ]*(?:#[^\r\n]*)?\r?$/gmu
const DOTENV_COMPATIBLE_ASSIGNMENT_PATTERN =
  /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gmu
const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])
const PROVISIONING_FAILURE = "Local environment provisioning failed"
const PUBLIC_PRIVILEGE_HARDENING_SQL = `
revoke all privileges on all tables in schema public from public;
revoke all privileges on all sequences in schema public from public;
revoke all privileges on all functions in schema public from public;
revoke all privileges on all tables in schema public
  from anon, service_role;
do $$
declare
  v_preserve_theme_update boolean := false;
begin
  if to_regclass('public.profiles') is not null
     and exists (
       select 1
       from pg_attribute attribute
       where attribute.attrelid = 'public.profiles'::regclass
         and attribute.attname = 'preferred_theme'
         and attribute.attnum > 0
         and not attribute.attisdropped
     ) then
    v_preserve_theme_update := has_column_privilege(
      'authenticated', 'public.profiles', 'preferred_theme', 'UPDATE'
    );
  end if;

  revoke insert, update, delete, truncate, references, trigger, maintain
    on all tables in schema public
    from authenticated;

  if v_preserve_theme_update then
    grant update (preferred_theme) on public.profiles to authenticated;

    if has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
       or exists (
         select 1
         from pg_attribute attribute
         where attribute.attrelid = 'public.profiles'::regclass
           and attribute.attnum > 0
           and not attribute.attisdropped
           and attribute.attname <> 'preferred_theme'
           and has_column_privilege(
             'authenticated',
             'public.profiles',
             attribute.attname,
             'UPDATE'
           )
       ) then
      raise exception 'profile theme grant assertion failed';
    end if;
  end if;
end
$$;
revoke all privileges on all sequences in schema public
  from anon, authenticated, service_role;
revoke all privileges on all functions in schema public
  from anon, authenticated, service_role;
revoke all privileges on all tables in schema public from axsys_bff;
revoke all privileges on all sequences in schema public from axsys_bff;
revoke all privileges on all functions in schema public from axsys_bff;

do $$
declare
  v_recovery_function_oid oid := to_regprocedure(
    'public.issue_password_recovery_grant(text)'
  );
  v_recovery_signature text;
begin
  if v_recovery_function_oid is not null then
    if 1 <> (
      select count(*)
      from pg_proc function
      join pg_namespace namespace on namespace.oid = function.pronamespace
      join pg_roles owner_role on owner_role.oid = function.proowner
      join pg_language language on language.oid = function.prolang
      where function.oid = v_recovery_function_oid
        and namespace.nspname = 'public'
        and function.proname = 'issue_password_recovery_grant'
        and owner_role.rolname = 'postgres'
        and language.lanname = 'plpgsql'
        and function.prokind = 'f'
        and function.provolatile = 'v'
        and function.prosecdef
        and not function.proretset
        and function.prorettype = 'timestamptz'::regtype
        and function.proconfig = array['search_path=""']::text[]
        and not exists (
          select 1
          from pg_depend dependency
          where dependency.classid = 'pg_proc'::regclass
            and dependency.objid = function.oid
            and dependency.deptype = 'e'
        )
    ) then
      raise exception 'password recovery RPC catalog assertion failed';
    end if;

    select format(
      '%I.%I(%s)',
      namespace.nspname,
      function.proname,
      pg_get_function_identity_arguments(function.oid)
    )
    into strict v_recovery_signature
    from pg_proc function
    join pg_namespace namespace on namespace.oid = function.pronamespace
    where function.oid = v_recovery_function_oid;

    execute format(
      'revoke execute on function %s from public, anon, authenticated, service_role, axsys_bff',
      v_recovery_signature
    );
    execute format(
      'grant execute on function %s to authenticated',
      v_recovery_signature
    );

    if not has_function_privilege(
      'authenticated', v_recovery_function_oid, 'EXECUTE'
    ) or exists (
      select 1
      from unnest(array['public','anon','service_role','axsys_bff']) role_name
      where has_function_privilege(
        role_name, v_recovery_function_oid, 'EXECUTE'
      )
    ) then
      raise exception 'password recovery RPC privilege assertion failed';
    end if;
  end if;
end
$$;

do $$
declare
  v_signature text;
  v_function_oid oid;
  v_expected_volatility "char";
begin
  foreach v_signature in array array[
    'public.company_reserve_member_provisioning(text,text,text,uuid)',
    'public.company_commit_member_provisioning(uuid,uuid,text,text,membership_role,module_key[],uuid)',
    'public.company_update_membership(uuid,text,membership_role,membership_status,module_key[],text,bigint,uuid)',
    'public.company_get_api_access_context()'
  ] loop
    v_function_oid := to_regprocedure(v_signature);
    if v_function_oid is null then
      continue;
    end if;
    v_expected_volatility := case
      when v_signature = 'public.company_get_api_access_context()' then 's'::"char"
      else 'v'::"char"
    end;
    if 1 <> (
      select count(*)
      from pg_proc function
      join pg_namespace namespace on namespace.oid=function.pronamespace
      join pg_roles owner_role on owner_role.oid=function.proowner
      join pg_language language on language.oid=function.prolang
      where function.oid=v_function_oid
        and namespace.nspname='public'
        and owner_role.rolname='postgres'
        and language.lanname='plpgsql'
        and function.prokind='f'
        and function.provolatile=v_expected_volatility
        and function.prosecdef
        and not function.proretset
        and function.prorettype='jsonb'::regtype
        and function.proconfig=array['search_path=""']::text[]
        and not exists (
          select 1 from pg_depend dependency
          where dependency.classid='pg_proc'::regclass
            and dependency.objid=function.oid
            and dependency.deptype='e'
        )
    ) then
      raise exception 'company membership RPC catalog assertion failed';
    end if;
    execute format(
      'revoke execute on function %s from public, anon, authenticated, service_role, axsys_bff',
      v_function_oid::regprocedure
    );
    execute format(
      'grant execute on function %s to authenticated',
      v_function_oid::regprocedure
    );
    if not has_function_privilege('authenticated',v_function_oid,'EXECUTE')
       or exists (
         select 1 from unnest(array['public','anon','service_role','axsys_bff']) role_name
         where has_function_privilege(role_name,v_function_oid,'EXECUTE')
       ) then
      raise exception 'company membership RPC privilege assertion failed';
    end if;
  end loop;
end
$$;

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
  const quote = value.at(0)
  if (
    (quote === '"' || quote === "'" || quote === "`") &&
    value.at(-1) === quote
  ) {
    const unquoted = value.slice(1, -1)
    return quote === '"'
      ? unquoted.replaceAll("\\n", "\n").replaceAll("\\r", "\r")
      : unquoted
  }
  return value
}

type EnvironmentAssignment = Readonly<{
  end: number
  key: string
  rawValue: string
  start: number
}>

function environmentAssignments(text: string): EnvironmentAssignment[] {
  const pattern = new RegExp(
    ENV_ASSIGNMENT_PATTERN.source,
    ENV_ASSIGNMENT_PATTERN.flags,
  )
  return Array.from(text.matchAll(pattern), (match) => {
    const start = match.index ?? 0
    let end = start + match[0].length
    if (text.at(end) === "\n") end += 1
    return {
      end,
      key: match[1],
      rawValue: match[2] ?? "",
      start,
    }
  })
}

function dotenvCompatibleAssignments(text: string): EnvironmentAssignment[] {
  const normalized = text.replace(/\r\n?/gu, "\n")
  const pattern = new RegExp(
    DOTENV_COMPATIBLE_ASSIGNMENT_PATTERN.source,
    DOTENV_COMPATIBLE_ASSIGNMENT_PATTERN.flags,
  )
  return Array.from(normalized.matchAll(pattern), (match) => ({
    end: (match.index ?? 0) + match[0].length,
    key: match[1],
    rawValue: match[2] ?? "",
    start: match.index ?? 0,
  }))
}

function assertOwnedAssignmentsAreUnambiguous(
  text: string,
  ownedKeys: ReadonlySet<string>,
): void {
  const safeAssignments = environmentAssignments(text)
    .filter(({ key }) => ownedKeys.has(key))
    .map(({ key, rawValue }) => [key, decodeEnvValue(rawValue)] as const)
  const dotenvAssignments = dotenvCompatibleAssignments(text)
    .filter(({ key }) => ownedKeys.has(key))
    .map(({ key, rawValue }) => [key, decodeEnvValue(rawValue)] as const)

  if (
    safeAssignments.length !== dotenvAssignments.length ||
    safeAssignments.some(
      ([key, value], index) =>
        dotenvAssignments[index]?.[0] !== key ||
        dotenvAssignments[index]?.[1] !== value,
    )
  ) {
    throw new Error("Owned environment key uses unsupported syntax")
  }
}

export function parseEnv(text: string): Record<string, string> {
  const values = new Map<string, string>()
  for (const assignment of environmentAssignments(text)) {
    values.set(assignment.key, decodeEnvValue(assignment.rawValue))
  }
  return Object.fromEntries(values)
}

function preserveUnknownEnvironment(
  text: string,
  ownedKeys: ReadonlySet<string>,
): string {
  let cursor = 0
  let preserved = ""
  for (const assignment of environmentAssignments(text)) {
    if (!ownedKeys.has(assignment.key)) continue
    preserved += text.slice(cursor, assignment.start)
    cursor = assignment.end
  }
  preserved += text.slice(cursor)
  return preserved
}

function isCanonicalEncryptionKey(value: string): boolean {
  if (!BASE64_32_BYTES.test(value)) return false
  const decoded = Buffer.from(value, "base64")
  return decoded.byteLength === 32 && decoded.toString("base64") === value
}

export function parseSupabaseStatus(text: string): SupabaseStatus {
  if (
    /^[\t ]*(?:export[\t ]+)?(?:API_URL|PUBLISHABLE_KEY|ANON_KEY|SECRET_KEY|SERVICE_ROLE_KEY|DB_URL)[\t ]*=.*#/mu.test(
      text,
    )
  ) {
    throw new Error("Supabase status did not return required local credentials")
  }
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
  generateEncryptionKey: () => string
}): string {
  const ownedKeys = new Set<string>([
    ...Object.keys(input.canonical),
    ...APPLICATION_SECRET_KEYS,
    ...ENCRYPTION_SECRET_KEYS,
  ])
  assertOwnedAssignmentsAreUnambiguous(input.existingText, ownedKeys)
  const existing = parseEnv(input.existingText)
  const merged: Record<string, string> = { ...input.canonical }

  for (const key of APPLICATION_SECRET_KEYS) {
    const value = Object.hasOwn(existing, key)
      ? existing[key]
      : input.generateSecret()
    if (!BASE64URL_32_BYTES.test(value)) {
      throw new Error("Application secret has an invalid format")
    }
    merged[key] = value
  }

  for (const key of ENCRYPTION_SECRET_KEYS) {
    if (Object.hasOwn(existing, key)) {
      if (!isCanonicalEncryptionKey(existing[key])) {
        throw new Error("Existing encryption key has an invalid format")
      }
      merged[key] = existing[key]
      continue
    }

    const generated = input.generateEncryptionKey()
    if (!isCanonicalEncryptionKey(generated)) {
      throw new Error("Generated encryption key has an invalid format")
    }
    merged[key] = generated
  }

  const ownedEnvironment = serializeEnvironment(merged)
  const preservedEnvironment = preserveUnknownEnvironment(
    input.existingText,
    ownedKeys,
  )
  const preservedPrefix =
    preservedEnvironment.length === 0 || preservedEnvironment.endsWith("\n")
      ? preservedEnvironment
      : `${preservedEnvironment}\n`
  return `${preservedPrefix}${ownedEnvironment}`
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
  generateEncryptionKey() {
    return randomBytes(32).toString("base64")
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
      CLAMAV_HOST: "127.0.0.1",
      CLAMAV_PORT: "3310",
      SUPABASE_STORAGE_TUS_ENDPOINT:
        "http://127.0.0.1:54321/storage/v1/upload/resumable",
    },
    generateSecret: runtime.generateSecret,
    generateEncryptionKey: runtime.generateEncryptionKey,
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

type ProvisioningCliOptions = Readonly<{
  provision?: () => Promise<void>
  writeStderr?: (value: string) => void
  writeStdout?: (value: string) => void
}>

export async function runProvisioningCli({
  provision = () => provisionLocalEnvironment(),
  writeStderr = (value) => {
    process.stderr.write(value)
  },
  writeStdout = (value) => {
    process.stdout.write(value)
  },
}: ProvisioningCliOptions = {}): Promise<0 | 1> {
  try {
    await provision()
    writeStdout("Local environment provisioned without printing secrets.\n")
    return 0
  } catch (error) {
    writeStderr(formatProvisioningFailure(error))
    return 1
  }
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
  void runProvisioningCli().then((exitCode) => {
    process.exitCode = exitCode
  })
}
