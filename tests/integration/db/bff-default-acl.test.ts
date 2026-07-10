import { loadEnvFile } from "node:process"
import postgres from "postgres"
import { afterAll, describe, expect, it } from "vitest"
import {
  hardenLocalPublicPrivileges,
  validateLocalDatabaseUrl,
} from "../../../scripts/provision-local-env"

if (!process.env.DATABASE_URL) {
  try {
    loadEnvFile(".env.local")
  } catch {
    // CI may provide the variable directly without a local dotenv file.
  }
}

const databaseUrlValue = process.env.DATABASE_URL
if (!databaseUrlValue) {
  throw new Error("Default ACL integration environment is not provisioned")
}

const postgresUrl = validateLocalDatabaseUrl(databaseUrlValue)
const supabaseAdminUrl = new URL(postgresUrl)
supabaseAdminUrl.username = "supabase_admin"

const postgresOwnerSql = postgres(postgresUrl.toString(), {
  max: 1,
  prepare: false,
})
const supabaseAdminOwnerSql = postgres(supabaseAdminUrl.toString(), {
  max: 1,
  prepare: false,
})

const ownerConnections = [
  ["postgres", postgresOwnerSql],
  ["supabase_admin", supabaseAdminOwnerSql],
] as const

afterAll(async () => {
  await Promise.all([postgresOwnerSql.end(), supabaseAdminOwnerSql.end()])
})

describe("axsys_bff default ACL hardening", () => {
  it("repairs owner drift without erasing explicit object grants", async () => {
    let createdPrivateSchema = false

    try {
      const [privateSchema] = await supabaseAdminOwnerSql<[{ exists: boolean }]>`
        select to_regnamespace('private') is not null as exists
      `
      if (!privateSchema.exists) {
        await supabaseAdminOwnerSql`
          create schema private authorization supabase_admin
        `
        createdPrivateSchema = true
      }

      await supabaseAdminOwnerSql.unsafe(`
        create table public.axsys_bff_acl_authenticated_probe(id bigint);
        revoke all privileges on table public.axsys_bff_acl_authenticated_probe
          from public, anon, authenticated, service_role, axsys_bff;
        grant select on table public.axsys_bff_acl_authenticated_probe
          to authenticated;

        create function private.axsys_bff_acl_private_probe()
        returns integer
        language sql
        as 'select 1';
        revoke all privileges on function private.axsys_bff_acl_private_probe()
          from public, anon, authenticated, service_role, axsys_bff;
        grant execute on function private.axsys_bff_acl_private_probe()
          to axsys_bff;
      `)

      for (const [owner, ownerSql] of ownerConnections) {
        await ownerSql.unsafe(`
          alter default privileges for role ${owner}
            grant all privileges on tables to axsys_bff;
          alter default privileges for role ${owner} in schema public
            grant all privileges on tables to axsys_bff;
          alter default privileges for role ${owner}
            grant all privileges on sequences to axsys_bff;
          alter default privileges for role ${owner} in schema public
            grant all privileges on sequences to axsys_bff;
          alter default privileges for role ${owner}
            grant all privileges on functions to axsys_bff;
          alter default privileges for role ${owner} in schema public
            grant all privileges on functions to axsys_bff;
        `)
      }

      await hardenLocalPublicPrivileges(supabaseAdminUrl.toString())

      for (const [owner, ownerSql] of ownerConnections) {
        await ownerSql.unsafe(`
          create table public.axsys_bff_acl_${owner}_table(id bigint);
          create sequence public.axsys_bff_acl_${owner}_sequence;
          create function public.axsys_bff_acl_${owner}_function()
          returns integer
          language sql
          as 'select 1';
        `)
      }

      const [remainingDefaults] = await supabaseAdminOwnerSql<[{ count: number }]>`
        select count(*)::integer as count
        from pg_default_acl defaults
        cross join lateral aclexplode(defaults.defaclacl) grant_item
        join pg_roles owner_role on owner_role.oid = defaults.defaclrole
        join pg_roles grantee_role on grantee_role.oid = grant_item.grantee
        where defaults.defaclnamespace in (0, 'public'::regnamespace)
          and owner_role.rolname in ('postgres', 'supabase_admin')
          and grantee_role.rolname = 'axsys_bff'
          and defaults.defaclobjtype in ('r', 'S', 'f')
      `

      const futurePrivileges = await supabaseAdminOwnerSql<
        {
          owner: string
          tablePrivilege: boolean
          sequencePrivilege: boolean
          functionPrivilege: boolean
        }[]
      >`
        select
          owner,
          has_table_privilege(
            'axsys_bff',
            format('public.axsys_bff_acl_%s_table', owner),
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
          ) as "tablePrivilege",
          has_sequence_privilege(
            'axsys_bff',
            format('public.axsys_bff_acl_%s_sequence', owner),
            'USAGE,SELECT,UPDATE'
          ) as "sequencePrivilege",
          has_function_privilege(
            'axsys_bff',
            format('public.axsys_bff_acl_%s_function()', owner),
            'EXECUTE'
          ) as "functionPrivilege"
        from unnest(array['postgres', 'supabase_admin']) owner
        order by owner
      `

      const [explicitPrivileges] = await supabaseAdminOwnerSql<
        [{ authenticatedSelect: boolean; bffExecute: boolean }]
      >`
        select
          has_table_privilege(
            'authenticated',
            'public.axsys_bff_acl_authenticated_probe',
            'SELECT'
          ) as "authenticatedSelect",
          has_function_privilege(
            'axsys_bff',
            'private.axsys_bff_acl_private_probe()',
            'EXECUTE'
          ) as "bffExecute"
      `

      expect({
        remainingDefaultGrants: remainingDefaults.count,
        futurePrivileges,
        explicitPrivileges,
      }).toEqual({
        remainingDefaultGrants: 0,
        futurePrivileges: [
          {
            owner: "postgres",
            tablePrivilege: false,
            sequencePrivilege: false,
            functionPrivilege: false,
          },
          {
            owner: "supabase_admin",
            tablePrivilege: false,
            sequencePrivilege: false,
            functionPrivilege: false,
          },
        ],
        explicitPrivileges: {
          authenticatedSelect: true,
          bffExecute: true,
        },
      })
    } finally {
      for (const [owner, ownerSql] of ownerConnections) {
        await ownerSql.unsafe(`
          drop function if exists public.axsys_bff_acl_${owner}_function();
          drop sequence if exists public.axsys_bff_acl_${owner}_sequence;
          drop table if exists public.axsys_bff_acl_${owner}_table;

          alter default privileges for role ${owner}
            revoke all privileges on tables from axsys_bff;
          alter default privileges for role ${owner} in schema public
            revoke all privileges on tables from axsys_bff;
          alter default privileges for role ${owner}
            revoke all privileges on sequences from axsys_bff;
          alter default privileges for role ${owner} in schema public
            revoke all privileges on sequences from axsys_bff;
          alter default privileges for role ${owner}
            revoke all privileges on functions from axsys_bff;
          alter default privileges for role ${owner} in schema public
            revoke all privileges on functions from axsys_bff;
        `)
      }

      await supabaseAdminOwnerSql.unsafe(`
        drop function if exists private.axsys_bff_acl_private_probe();
        drop table if exists public.axsys_bff_acl_authenticated_probe;
      `)
      if (createdPrivateSchema) {
        await supabaseAdminOwnerSql`drop schema if exists private`
      }
    }
  })
})
