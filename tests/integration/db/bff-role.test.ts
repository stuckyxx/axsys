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

  it("has no effective privileges on the public schema", async () => {
    const [privileges] = await sql<[{ usage: boolean; create: boolean }]>`
      select
        has_schema_privilege(current_user, 'public', 'USAGE') as usage,
        has_schema_privilege(current_user, 'public', 'CREATE') as create
    `

    expect(privileges).toEqual({ usage: false, create: false })
  })

  it("cannot read an application table directly", async () => {
    await expect(sql`select * from public.companies`).rejects.toMatchObject({
      code: expect.stringMatching(/^(?:42501|42P01)$/u),
      message: expect.stringMatching(/permission denied|does not exist/u),
    })
  })
})
