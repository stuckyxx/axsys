import { loadEnvFile } from "node:process"
import postgres from "postgres"
import { afterAll, describe, expect, it } from "vitest"
import { hardenLocalPublicPrivileges } from "../../../scripts/provision-local-env"

if (!process.env.BFF_DATABASE_URL) {
  try {
    loadEnvFile(".env.local")
  } catch {
    // CI may provide the variable directly without a local dotenv file.
  }
}

const databaseUrl = process.env.BFF_DATABASE_URL
const adminDatabaseUrl = process.env.DATABASE_URL
if (!databaseUrl || !adminDatabaseUrl) {
  throw new Error("BFF integration environment is not provisioned")
}

const sql = postgres(databaseUrl, { max: 1, prepare: false })
const postgresOwnerSql = postgres(adminDatabaseUrl, { max: 1, prepare: false })
const supabaseAdminUrl = new URL(adminDatabaseUrl)
supabaseAdminUrl.username = "supabase_admin"
const supabaseAdminOwnerSql = postgres(supabaseAdminUrl.toString(), {
  max: 1,
  prepare: false,
})

const SECURITY_BOUNDARY_USER_ID = "62000000-0000-4000-8000-000000000001"
const SECURITY_BOUNDARY_SESSION_IDS = [
  "92000000-0000-4000-8000-000000000001",
  "92000000-0000-4000-8000-000000000002",
  "92000000-0000-4000-8000-000000000003",
] as const
const SECURITY_BOUNDARY_CORRELATION_IDS = [
  "72000000-0000-4000-8000-000000000001",
  "72000000-0000-4000-8000-000000000002",
  "72000000-0000-4000-8000-000000000003",
  "72000000-0000-4000-8000-000000000004",
  "72000000-0000-4000-8000-000000000005",
] as const
const SECURITY_BOUNDARY_RATE_KEYS = ["62".repeat(32), "63".repeat(32)] as const

async function cleanupSecurityBoundaryFixtures(): Promise<void> {
  await postgresOwnerSql.begin(async (transaction) => {
    const [catalog] = await transaction<
      [{ auditEvents: boolean; securityEvents: boolean; sessionControls: boolean }]
    >`
      select
        to_regclass('public.audit_events') is not null as "auditEvents",
        to_regclass('public.security_events') is not null as "securityEvents",
        to_regclass('private.auth_session_controls') is not null as "sessionControls"
    `

    if (catalog.auditEvents && catalog.securityEvents) {
      await transaction.unsafe(
        "lock table public.audit_events, public.security_events in access exclusive mode",
      )
      const triggerStates = await transaction<
        { triggerName: string; enabled: string }[]
      >`
        select tgname as "triggerName", tgenabled as enabled
        from pg_trigger
        where (tgrelid, tgname) in (
          ('public.audit_events'::regclass, 'audit_events_append_only'),
          ('public.security_events'::regclass, 'security_events_append_only')
        )
          and not tgisinternal
        order by tgname
      `
      expect(triggerStates).toEqual([
        { triggerName: "audit_events_append_only", enabled: "O" },
        { triggerName: "security_events_append_only", enabled: "O" },
      ])

      await transaction.unsafe(
        "alter table public.audit_events disable trigger audit_events_append_only",
      )
      await transaction.unsafe(
        "alter table public.security_events disable trigger security_events_append_only",
      )
      await transaction`
        delete from public.audit_events
        where correlation_id = any(${[...SECURITY_BOUNDARY_CORRELATION_IDS]}::uuid[])
      `
      await transaction`
        delete from public.security_events
        where correlation_id = any(${[...SECURITY_BOUNDARY_CORRELATION_IDS]}::uuid[])
      `
      await transaction.unsafe(
        "alter table public.audit_events enable trigger audit_events_append_only",
      )
      await transaction.unsafe(
        "alter table public.security_events enable trigger security_events_append_only",
      )

      const restored = await transaction<{ enabled: string }[]>`
        select tgenabled as enabled
        from pg_trigger
        where (tgrelid, tgname) in (
          ('public.audit_events'::regclass, 'audit_events_append_only'),
          ('public.security_events'::regclass, 'security_events_append_only')
        )
          and not tgisinternal
        order by tgname
      `
      expect(restored).toEqual([{ enabled: "O" }, { enabled: "O" }])
    }

    if (catalog.sessionControls) {
      await transaction`
        delete from private.rate_limit_buckets
        where key_hash = any(${[...SECURITY_BOUNDARY_RATE_KEYS]}::text[])
      `
      await transaction`
        delete from private.auth_session_controls
        where session_id = any(${[...SECURITY_BOUNDARY_SESSION_IDS]}::uuid[])
      `
      await transaction`
        delete from private.auth_user_session_cutoffs
        where user_id = ${SECURITY_BOUNDARY_USER_ID}::uuid
      `
    }

    await transaction`
      delete from public.platform_roles
      where user_id = ${SECURITY_BOUNDARY_USER_ID}::uuid
    `
    await transaction`
      delete from auth.sessions
      where id = any(${[...SECURITY_BOUNDARY_SESSION_IDS]}::uuid[])
    `
    await transaction`
      delete from public.profiles
      where user_id = ${SECURITY_BOUNDARY_USER_ID}::uuid
    `
    await transaction`
      delete from auth.users
      where id = ${SECURITY_BOUNDARY_USER_ID}::uuid
    `
  })
}

afterAll(async () => {
  await Promise.all([sql.end(), postgresOwnerSql.end(), supabaseAdminOwnerSql.end()])
})

describe("axsys_bff", () => {
  it("connects as the restricted role with every dangerous flag disabled", async () => {
    const [role] = await sql<
      [
        {
          currentUser: string
          canLogin: boolean
          inherit: boolean
          superuser: boolean
          createDb: boolean
          createRole: boolean
          replication: boolean
          bypassRls: boolean
          connectionLimit: number
        },
      ]
    >`
      select
        current_user as "currentUser",
        rolcanlogin as "canLogin",
        rolinherit as inherit,
        rolsuper as superuser,
        rolcreatedb as "createDb",
        rolcreaterole as "createRole",
        rolreplication as replication,
        rolbypassrls as "bypassRls",
        rolconnlimit as "connectionLimit"
      from pg_roles
      where rolname = current_user
    `

    expect(role).toEqual({
      currentUser: "axsys_bff",
      canLogin: true,
      inherit: false,
      superuser: false,
      createDb: false,
      createRole: false,
      replication: false,
      bypassRls: false,
      connectionLimit: 20,
    })
  })

  it("has no role memberships", async () => {
    const [memberships] = await sql<[{ count: number }]>`
      select count(*)::integer as count
      from pg_auth_members
      where member = (select oid from pg_roles where rolname = current_user)
    `

    expect(memberships.count).toBe(0)
  })

  it("is granted only to trusted administrative members", async () => {
    const members = await sql<{ member: string }[]>`
      select member_role.rolname as member
      from pg_auth_members membership
      join pg_roles member_role on member_role.oid = membership.member
      where membership.roleid = (select oid from pg_roles where rolname = current_user)
      order by member_role.rolname
    `

    expect(members.length).toBeGreaterThan(0)
    expect(
      members.every(({ member }) => ["postgres", "supabase_admin"].includes(member)),
    ).toBe(true)
  })

  it("has no future public object grants for API bearer roles", async () => {
    const [unexpected] = await sql<[{ count: number }]>`
      select count(*)::integer as count
      from pg_default_acl defaults
      cross join lateral aclexplode(defaults.defaclacl) grant_item
      join pg_roles owner_role on owner_role.oid = defaults.defaclrole
      join pg_roles grantee_role on grantee_role.oid = grant_item.grantee
      where defaults.defaclnamespace in (0, 'public'::regnamespace)
        and owner_role.rolname in ('postgres', 'supabase_admin')
        and grantee_role.rolname in ('anon', 'authenticated', 'service_role')
        and defaults.defaclobjtype in ('r', 'S', 'f')
    `

    expect(unexpected.count).toBe(0)

    const globalFunctionDefaults = await sql<{ owner: string }[]>`
      select owner_role.rolname as owner
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
      order by owner_role.rolname
    `
    expect(globalFunctionDefaults.map(({ owner }) => owner)).toEqual([
      "postgres",
      "supabase_admin",
    ])
  })

  it("denies future public object privileges for every application role under both owners", async () => {
    for (const [owner, ownerSql] of [
      ["postgres", postgresOwnerSql],
      ["supabase_admin", supabaseAdminOwnerSql],
    ] as const) {
      await ownerSql.begin(async (transaction) => {
        await transaction.unsafe(`
          create table public.axsys_default_acl_probe_table(id bigint);
          create sequence public.axsys_default_acl_probe_sequence;
          create function public.axsys_default_acl_probe()
          returns integer
          language sql
          as 'select 1'
        `)
        try {
          const privileges = await transaction<
            {
              roleName: string
              canUseTable: boolean
              canUseSequence: boolean
              canExecute: boolean
              owner: string
            }[]
          >`
            select
              role_name as "roleName",
              has_table_privilege(
                role_name,
                'public.axsys_default_acl_probe_table',
                'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
              ) as "canUseTable",
              has_sequence_privilege(
                role_name,
                'public.axsys_default_acl_probe_sequence',
                'USAGE,SELECT,UPDATE'
              ) as "canUseSequence",
              has_function_privilege(
                role_name,
                'public.axsys_default_acl_probe()',
                'EXECUTE'
              ) as "canExecute",
              current_user as owner
            from unnest(array['anon', 'authenticated', 'service_role', 'axsys_bff']) role_name
            order by role_name
          `

          expect(
            privileges.every(
              ({ canUseTable, canUseSequence, canExecute }) =>
                !canUseTable && !canUseSequence && !canExecute,
            ),
          ).toBe(true)
          expect(new Set(privileges.map(({ owner: actualOwner }) => actualOwner))).toEqual(
            new Set([owner]),
          )
        } finally {
          await transaction.unsafe(
            `
              drop function if exists public.axsys_default_acl_probe();
              drop sequence if exists public.axsys_default_acl_probe_sequence;
              drop table if exists public.axsys_default_acl_probe_table;
            `,
          )
        }
      })
    }
  })

  it("repairs global and public-schema PUBLIC default ACL drift for every object type and owner", async () => {
    const owners = [
      ["postgres", postgresOwnerSql],
      ["supabase_admin", supabaseAdminOwnerSql],
    ] as const

    try {
      for (const [owner, ownerSql] of owners) {
        await ownerSql.unsafe(`
          alter default privileges for role ${owner}
            grant all privileges on tables to public;
          alter default privileges for role ${owner} in schema public
            grant all privileges on tables to public;
          alter default privileges for role ${owner}
            grant all privileges on sequences to public;
          alter default privileges for role ${owner} in schema public
            grant all privileges on sequences to public;
          alter default privileges for role ${owner}
            grant all privileges on functions to public;
          alter default privileges for role ${owner} in schema public
            grant all privileges on functions to public;
        `)
      }

      await hardenLocalPublicPrivileges(supabaseAdminUrl.toString())

      const [remainingPublicDefaults] = await supabaseAdminOwnerSql<
        [{ count: number }]
      >`
        select count(*)::integer as count
        from pg_default_acl defaults
        cross join lateral aclexplode(defaults.defaclacl) grant_item
        join pg_roles owner_role on owner_role.oid = defaults.defaclrole
        where defaults.defaclnamespace in (0, 'public'::regnamespace)
          and owner_role.rolname in ('postgres', 'supabase_admin')
          and defaults.defaclobjtype in ('r', 'S', 'f')
          and grant_item.grantee = 0
      `
      expect(remainingPublicDefaults.count).toBe(0)

      for (const [owner, ownerSql] of owners) {
        await ownerSql.begin(async (transaction) => {
          await transaction.unsafe(`
            create table public.axsys_public_drift_probe_table(id bigint);
            create sequence public.axsys_public_drift_probe_sequence;
            create function public.axsys_public_drift_probe()
            returns integer
            language sql
            as 'select 1';
          `)
          try {
            const privileges = await transaction<
              {
                roleName: string
                canUseTable: boolean
                canUseSequence: boolean
                canExecute: boolean
                owner: string
              }[]
            >`
              select
                role_name as "roleName",
                has_table_privilege(
                  role_name,
                  'public.axsys_public_drift_probe_table',
                  'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
                ) as "canUseTable",
                has_sequence_privilege(
                  role_name,
                  'public.axsys_public_drift_probe_sequence',
                  'USAGE,SELECT,UPDATE'
                ) as "canUseSequence",
                has_function_privilege(
                  role_name,
                  'public.axsys_public_drift_probe()',
                  'EXECUTE'
                ) as "canExecute",
                current_user as owner
              from unnest(array['anon', 'authenticated', 'service_role', 'axsys_bff']) role_name
              order by role_name
            `

            expect(
              privileges.every(
                ({ canUseTable, canUseSequence, canExecute }) =>
                  !canUseTable && !canUseSequence && !canExecute,
              ),
            ).toBe(true)
            expect(new Set(privileges.map(({ owner: actualOwner }) => actualOwner))).toEqual(
              new Set([owner]),
            )
          } finally {
            await transaction.unsafe(`
              drop function if exists public.axsys_public_drift_probe();
              drop sequence if exists public.axsys_public_drift_probe_sequence;
              drop table if exists public.axsys_public_drift_probe_table;
            `)
          }
        })
      }
    } finally {
      for (const [owner, ownerSql] of owners) {
        await ownerSql.unsafe(`
          alter default privileges for role ${owner}
            revoke all privileges on tables from public;
          alter default privileges for role ${owner} in schema public
            revoke all privileges on tables from public;
          alter default privileges for role ${owner}
            revoke all privileges on sequences from public;
          alter default privileges for role ${owner} in schema public
            revoke all privileges on sequences from public;
          alter default privileges for role ${owner}
            revoke all privileges on functions from public;
          alter default privileges for role ${owner} in schema public
            revoke all privileges on functions from public;
        `)
      }
      await hardenLocalPublicPrivileges(supabaseAdminUrl.toString())
    }
  })

  it("preserves an explicit migration-owned authenticated grant during repeated hardening", async () => {
    await supabaseAdminOwnerSql.unsafe(`
      create table public.axsys_explicit_authenticated_probe(id bigint);
      revoke all privileges on table public.axsys_explicit_authenticated_probe
        from public, anon, authenticated, service_role, axsys_bff;
      grant select on table public.axsys_explicit_authenticated_probe to authenticated;
    `)

    try {
      await hardenLocalPublicPrivileges(supabaseAdminUrl.toString())

      const privileges = await supabaseAdminOwnerSql<
        { roleName: string; canSelect: boolean }[]
      >`
        select
          role_name as "roleName",
          has_table_privilege(
            role_name,
            'public.axsys_explicit_authenticated_probe',
            'SELECT'
          ) as "canSelect"
        from unnest(array['anon', 'authenticated', 'service_role', 'axsys_bff']) role_name
        order by role_name
      `

      expect(privileges).toEqual([
        { roleName: "anon", canSelect: false },
        { roleName: "authenticated", canSelect: true },
        { roleName: "axsys_bff", canSelect: false },
        { roleName: "service_role", canSelect: false },
      ])
    } finally {
      await supabaseAdminOwnerSql.unsafe(
        "drop table if exists public.axsys_explicit_authenticated_probe",
      )
    }
  })

  it("preserves an authenticated private RLS helper grant during repeated hardening", async () => {
    const [schemaState] = await supabaseAdminOwnerSql<[{ existed: boolean }]>`
      select to_regnamespace('private') is not null as existed
    `
    if (!schemaState.existed) {
      await supabaseAdminOwnerSql`create schema private authorization supabase_admin`
    }

    try {
      await supabaseAdminOwnerSql.unsafe(`
        create function private.axsys_authenticated_rls_probe()
        returns boolean
        language sql
        stable
        security definer
        set search_path = ''
        as 'select true';
        revoke all privileges on function private.axsys_authenticated_rls_probe()
          from public, anon, authenticated, service_role, axsys_bff;
        grant execute on function private.axsys_authenticated_rls_probe()
          to authenticated;
      `)

      await hardenLocalPublicPrivileges(supabaseAdminUrl.toString())

      const privileges = await supabaseAdminOwnerSql<
        { roleName: string; canExecute: boolean }[]
      >`
        select
          role_name as "roleName",
          has_function_privilege(
            role_name,
            'private.axsys_authenticated_rls_probe()',
            'EXECUTE'
          ) as "canExecute"
        from unnest(array['anon', 'authenticated', 'service_role', 'axsys_bff']) role_name
        order by role_name
      `

      expect(privileges).toEqual([
        { roleName: "anon", canExecute: false },
        { roleName: "authenticated", canExecute: true },
        { roleName: "axsys_bff", canExecute: false },
        { roleName: "service_role", canExecute: false },
      ])
    } finally {
      await supabaseAdminOwnerSql.unsafe(
        "drop function if exists private.axsys_authenticated_rls_probe()",
      )
      if (!schemaState.existed) {
        await supabaseAdminOwnerSql`drop schema if exists private`
      }
    }
  })

  it("regrants only the attested recovery RPC during repeated db:env hardening", async () => {
    const [catalogBefore] = await supabaseAdminOwnerSql<[{ available: boolean }]>`
      select to_regprocedure(
        'public.issue_password_recovery_grant(text)'
      ) is not null as available
    `
    expect(catalogBefore.available).toBe(true)

    await hardenLocalPublicPrivileges(supabaseAdminUrl.toString())
    await hardenLocalPublicPrivileges(supabaseAdminUrl.toString())

    const [catalog] = await supabaseAdminOwnerSql<
      [{ valid: boolean; signature: string }]
    >`
      select
        owner_role.rolname = 'postgres'
          and function.prosecdef
          and not function.proretset
          and function.prorettype = 'timestamptz'::regtype
          and language.lanname = 'plpgsql'
          and function.proconfig = array['search_path=""']::text[] as valid,
        function.oid::regprocedure::text as signature
      from pg_proc function
      join pg_namespace namespace on namespace.oid = function.pronamespace
      join pg_roles owner_role on owner_role.oid = function.proowner
      join pg_language language on language.oid = function.prolang
      where function.oid = to_regprocedure(
        'public.issue_password_recovery_grant(text)'
      )
        and namespace.nspname = 'public'
    `
    expect(catalog).toEqual({
      valid: true,
      signature: "issue_password_recovery_grant(text)",
    })

    const privileges = await supabaseAdminOwnerSql<
      Array<{ roleName: string; canExecute: boolean }>
    >`
      select role_name as "roleName",
             has_function_privilege(
               role_name,
               to_regprocedure('public.issue_password_recovery_grant(text)'),
               'EXECUTE'
             ) as "canExecute"
      from unnest(
        array['public','anon','authenticated','service_role','axsys_bff']
      ) role_name
      order by role_name
    `
    expect(privileges).toEqual([
      { roleName: "anon", canExecute: false },
      { roleName: "authenticated", canExecute: true },
      { roleName: "axsys_bff", canExecute: false },
      { roleName: "public", canExecute: false },
      { roleName: "service_role", canExecute: false },
    ])
  })

  it("preserves an explicitly allowlisted private BFF function during db:env hardening", async () => {
    const [schemaState] = await supabaseAdminOwnerSql<[{ existed: boolean }]>`
      select to_regnamespace('private') is not null as existed
    `
    if (!schemaState.existed) {
      await supabaseAdminOwnerSql`create schema private authorization supabase_admin`
    }

    try {
      await supabaseAdminOwnerSql.unsafe(`
        create function private.axsys_explicit_bff_probe()
        returns integer
        language sql
        as 'select 1';
        revoke all privileges on function private.axsys_explicit_bff_probe()
          from public, anon, authenticated, service_role;
        grant execute on function private.axsys_explicit_bff_probe() to axsys_bff;
      `)

      await hardenLocalPublicPrivileges(supabaseAdminUrl.toString())

      const privileges = await supabaseAdminOwnerSql<
        { roleName: string; canExecute: boolean }[]
      >`
        select
          role_name as "roleName",
          has_function_privilege(
            role_name,
            'private.axsys_explicit_bff_probe()',
            'EXECUTE'
          ) as "canExecute"
        from unnest(array['anon', 'authenticated', 'service_role', 'axsys_bff']) role_name
        order by role_name
      `

      expect(privileges).toEqual([
        { roleName: "anon", canExecute: false },
        { roleName: "authenticated", canExecute: false },
        { roleName: "axsys_bff", canExecute: true },
        { roleName: "service_role", canExecute: false },
      ])
    } finally {
      await supabaseAdminOwnerSql.unsafe(
        "drop function if exists private.axsys_explicit_bff_probe()",
      )
      if (!schemaState.existed) {
        await supabaseAdminOwnerSql`drop schema if exists private`
      }
    }
  })

  it("has only typed-boundary USAGE on public and extensions schemas", async () => {
    const [privileges] = await sql<
      [
        {
          publicUsage: boolean
          publicCreate: boolean
          extensionsUsage: boolean
          extensionsCreate: boolean
        },
      ]
    >`
      select
        has_schema_privilege(current_user, 'public', 'USAGE') as "publicUsage",
        has_schema_privilege(current_user, 'public', 'CREATE') as "publicCreate",
        has_schema_privilege(current_user, 'extensions', 'USAGE') as "extensionsUsage",
        has_schema_privilege(current_user, 'extensions', 'CREATE') as "extensionsCreate"
    `

    expect(privileges).toEqual({
      publicUsage: true,
      publicCreate: false,
        extensionsUsage: false,
      extensionsCreate: false,
    })
  })

  it.each([
    "profiles",
    "platform_roles",
    "companies",
    "company_memberships",
    "member_modules",
  ] as const)("cannot read public.%s directly", async (table) => {
    const [catalog] = await postgresOwnerSql<[{ exists: boolean }]>`
      select to_regclass(${`public.${table}`}) is not null as exists
    `
    expect(catalog.exists).toBe(true)

    await expect(sql.unsafe(`select * from public.${table}`)).rejects.toMatchObject({
      code: "42501",
      message: expect.stringMatching(/permission denied/u),
    })
  })

  it.each([
    "public.audit_events",
    "public.security_events",
    "public.idempotency_keys",
    "private.rate_limit_policies",
    "private.rate_limit_buckets",
    "private.auth_session_controls",
    "private.auth_user_session_cutoffs",
    "private.auth_password_operations",
    "private.password_recovery_grants",
  ] as const)("cannot read Task 6 table %s directly", async (relation) => {
    const [catalog] = await postgresOwnerSql<[{ exists: boolean }]>`
      select to_regclass(${relation}) is not null as exists
    `
    expect(catalog.exists).toBe(true)

    await expect(sql.unsafe(`select * from ${relation}`)).rejects.toMatchObject({
      code: "42501",
      message: expect.stringMatching(/permission denied/u),
    })
  })

  it.each([
    [
      "revoke_auth_sessions",
      "select private.revoke_auth_sessions(null::uuid, null::uuid)",
    ],
    ["resolve_audit_identity", "select * from private.resolve_audit_identity(null::uuid)"],
    ["reject_append_only_mutation", "select private.reject_append_only_mutation()"],
    ["guard_idempotency_key_update", "select private.guard_idempotency_key_update()"],
    [
      "guard_auth_session_control_update",
      "select private.guard_auth_session_control_update()",
    ],
    [
      "guard_auth_password_operation_update",
      "select private.guard_auth_password_operation_update()",
    ],
  ] as const)("cannot execute owner-only core %s", async (_routine, statement) => {
    await expect(sql.unsafe(statement)).rejects.toMatchObject({
      code: "42501",
      message: expect.stringMatching(/permission denied/u),
    })
  })

  it("has no effective USAGE on private control types", async () => {
    const privileges = await sql<{ typeName: string; canUse: boolean }[]>`
      select type_name as "typeName",
             has_type_privilege(current_user, type_name, 'USAGE') as "canUse"
      from unnest(array[
        'private.auth_session_state',
        'private.auth_password_operation_kind',
        'private.auth_password_operation_status'
      ]) type_name
      order by type_name
    `

    expect(privileges).toEqual([
      { typeName: "private.auth_password_operation_kind", canUse: false },
      { typeName: "private.auth_password_operation_status", canUse: false },
      { typeName: "private.auth_session_state", canUse: false },
    ])
  })

  it("has EXECUTE on all and only the forty allowlisted boundaries", async () => {
    const routines = await postgresOwnerSql<{ routineName: string }[]>`
      select function.proname as "routineName"
      from pg_proc function
      join pg_namespace namespace on namespace.oid = function.pronamespace
      where namespace.nspname = 'private'
        and has_function_privilege('axsys_bff', function.oid, 'EXECUTE')
      order by function.proname
    `

    expect(routines.map(({ routineName }) => routineName)).toEqual([
      "activate_file_upload_authorization",
      "assert_auth_session",
      "authorize_image_file_download",
      "begin_password_recovery",
      "begin_temporary_password_reset",
      "cancel_stale_reserved_upload_intents",
      "cancel_unissued_file_reservation",
      "claim_upload_authorizations_for_retirement",
      "clear_rate_limit",
      "complete_download_audit",
      "complete_password_recovery",
      "complete_temporary_password_change",
      "complete_temporary_password_reset",
      "complete_upload_authorization_retirement",
      "consume_rate_limit",
      "fail_closed_login_session",
      "fail_password_recovery",
      "fail_temporary_password_reset",
      "internal_begin_file_finalization",
      "internal_commit_company_provisioning",
      "internal_complete_company_access_reconciliation",
      "internal_finalize_file_upload",
      "internal_get_company_detail",
      "internal_list_companies",
      "internal_mark_file_cleanup_required",
      "internal_mark_provisioning_auth_created",
      "internal_mark_provisioning_compensation",
      "internal_reject_file_upload",
      "internal_release_file_finalization_for_retry",
      "internal_reserve_company_provisioning",
      "internal_set_company_status",
      "internal_update_company",
      "list_company_user_directory",
      "register_auth_session",
      "release_upload_authorization_retirement_claim",
      "reserve_image_upload_intent",
      "revoke_sessions_and_write_logout",
      "rotate_app_session_after_reauthentication",
      "write_authenticated_audit_event",
      "write_security_event",
    ])
  })

  it("executes every Task 6 boundary with authoritative fixtures", async () => {
    const [sessionId, failClosedSessionId, reauthenticatedSessionId] =
      SECURITY_BOUNDARY_SESSION_IDS
    const [
      loginCorrelationId,
      securityCorrelationId,
      failClosedCorrelationId,
      reauthenticationCorrelationId,
      logoutCorrelationId,
    ] = SECURITY_BOUNDARY_CORRELATION_IDS
    const [accountFailureKey, clearedAccountFailureKey] =
      SECURITY_BOUNDARY_RATE_KEYS
    const rollback = new Error("rollback successful boundary probes")

    await cleanupSecurityBoundaryFixtures()
    await postgresOwnerSql.begin(async (transaction) => {
      await transaction`
        insert into auth.users (
          id, instance_id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at
        ) values (
          ${SECURITY_BOUNDARY_USER_ID}::uuid,
          '00000000-0000-0000-0000-000000000000'::uuid,
          'authenticated',
          'authenticated',
          'bff-boundary@example.test',
          '',
          clock_timestamp(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          '{}'::jsonb,
          clock_timestamp(),
          clock_timestamp()
        )
      `
      await transaction`
        insert into public.profiles (user_id, email, display_name)
        values (
          ${SECURITY_BOUNDARY_USER_ID}::uuid,
          'bff-boundary@example.test',
          'BFF Boundary'
        )
      `
      await transaction`
        insert into public.platform_roles (user_id)
        values (${SECURITY_BOUNDARY_USER_ID}::uuid)
      `
      await transaction`
        insert into auth.sessions (id, user_id, created_at, updated_at)
        values
          (${sessionId}::uuid, ${SECURITY_BOUNDARY_USER_ID}::uuid,
           clock_timestamp() - interval '3 seconds', clock_timestamp()),
          (${failClosedSessionId}::uuid, ${SECURITY_BOUNDARY_USER_ID}::uuid,
           clock_timestamp() - interval '2 seconds', clock_timestamp()),
          (${reauthenticatedSessionId}::uuid, ${SECURITY_BOUNDARY_USER_ID}::uuid,
           clock_timestamp() - interval '1 second', clock_timestamp())
      `
    })

    try {
      try {
        await sql.begin(async (transaction) => {
          const [rateLimit] = await transaction<
            [{ allowed: boolean; attempts: number; retryAfterSeconds: number }]
          >`
            select
              allowed,
              attempts,
              retry_after_seconds as "retryAfterSeconds"
            from private.consume_rate_limit(
              'login-account-failure',
              ${accountFailureKey},
              5,
              900,
              900
            )
          `
          expect(rateLimit).toEqual({
            allowed: true,
            attempts: 1,
            retryAfterSeconds: 0,
          })
          await transaction`
            select private.consume_rate_limit(
              'reauth-account-failure',
              ${clearedAccountFailureKey},
              5,
              900,
              900
            )
          `
          await transaction`
            select private.clear_rate_limit(
              'reauth-account-failure',
              ${clearedAccountFailureKey}
            )
          `

          const [registration] = await transaction<[{ expiresAt: Date }]>`
            select private.register_auth_session(
              ${sessionId}::uuid,
              ${SECURITY_BOUNDARY_USER_ID}::uuid,
              false
            ) as "expiresAt"
          `
          expect(registration.expiresAt).toBeInstanceOf(Date)

          await transaction`
            select private.write_authenticated_audit_event(
              ${SECURITY_BOUNDARY_USER_ID}::uuid,
              ${sessionId}::uuid,
              'auth.login',
              'session',
              null::uuid,
              ${"success"},
              null,
              ${loginCorrelationId}::uuid,
              null,
              null,
              '{}'::jsonb
            )
          `
          const [active] = await transaction<[{ active: boolean }]>`
            select private.assert_auth_session(
              ${sessionId}::uuid,
              ${SECURITY_BOUNDARY_USER_ID}::uuid
            ) as active
          `
          expect(active.active).toBe(true)

          await transaction`
            select private.register_auth_session(
              ${failClosedSessionId}::uuid,
              ${SECURITY_BOUNDARY_USER_ID}::uuid,
              false
            )
          `
          await transaction`
            select private.fail_closed_login_session(
              ${SECURITY_BOUNDARY_USER_ID}::uuid,
              ${failClosedSessionId}::uuid,
              'AUTH_CONTEXT_RESOLUTION_FAILED',
              ${failClosedCorrelationId}::uuid
            )
          `
          await transaction`
            select private.rotate_app_session_after_reauthentication(
              ${SECURITY_BOUNDARY_USER_ID}::uuid,
              ${sessionId}::uuid,
              ${reauthenticatedSessionId}::uuid,
              ${reauthenticationCorrelationId}::uuid
            )
          `
          await transaction`
            select private.write_security_event(
              'auth.password_recovery.requested',
              null::uuid,
              null,
              null,
              ${"success"},
              null,
              ${securityCorrelationId}::uuid,
              '{}'::jsonb
            )
          `
          await transaction`
            select private.revoke_sessions_and_write_logout(
              ${SECURITY_BOUNDARY_USER_ID}::uuid,
              ${reauthenticatedSessionId}::uuid,
              ${logoutCorrelationId}::uuid,
              null,
              null
            )
          `

          throw rollback
        })
      } catch (error) {
        if (error !== rollback) throw error
      }
    } finally {
      await cleanupSecurityBoundaryFixtures()
    }
  })
})
