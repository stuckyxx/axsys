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
          create table public.axsys_bff_acl_${owner}_existing_table(id bigint);
          create sequence public.axsys_bff_acl_${owner}_existing_sequence;
          create function public.axsys_bff_acl_${owner}_existing_function()
          returns integer
          language sql
          as 'select 1';
          grant all privileges
            on table public.axsys_bff_acl_${owner}_existing_table
            to public, anon, authenticated, service_role, axsys_bff;
          grant all privileges
            on sequence public.axsys_bff_acl_${owner}_existing_sequence
            to public, anon, authenticated, service_role, axsys_bff;
          grant execute
            on function public.axsys_bff_acl_${owner}_existing_function()
            to public, anon, authenticated, service_role, axsys_bff;
        `)

        await ownerSql.unsafe(`
          alter default privileges for role ${owner}
            grant all privileges on tables
            to public, anon, authenticated, service_role, axsys_bff;
          alter default privileges for role ${owner} in schema public
            grant all privileges on tables
            to public, anon, authenticated, service_role, axsys_bff;
          alter default privileges for role ${owner}
            grant all privileges on sequences
            to public, anon, authenticated, service_role, axsys_bff;
          alter default privileges for role ${owner} in schema public
            grant all privileges on sequences
            to public, anon, authenticated, service_role, axsys_bff;
          alter default privileges for role ${owner}
            grant all privileges on functions
            to public, anon, authenticated, service_role, axsys_bff;
          alter default privileges for role ${owner} in schema public
            grant all privileges on functions
            to public, anon, authenticated, service_role, axsys_bff;
        `)
      }

      const preHardeningPrivileges = await supabaseAdminOwnerSql<
        {
          owner: string
          publicMaintain: boolean
          bffMaintain: boolean
          publicFunction: boolean
          bffFunction: boolean
        }[]
      >`
        select
          owner,
          has_table_privilege(
            'anon',
            format('public.axsys_bff_acl_%s_existing_table', owner),
            'MAINTAIN'
          ) as "publicMaintain",
          has_table_privilege(
            'axsys_bff',
            format('public.axsys_bff_acl_%s_existing_table', owner),
            'MAINTAIN'
          ) as "bffMaintain",
          has_function_privilege(
            'anon',
            format('public.axsys_bff_acl_%s_existing_function()', owner),
            'EXECUTE'
          ) as "publicFunction",
          has_function_privilege(
            'axsys_bff',
            format('public.axsys_bff_acl_%s_existing_function()', owner),
            'EXECUTE'
          ) as "bffFunction"
        from unnest(array['postgres', 'supabase_admin']) owner
        order by owner
      `
      expect(
        preHardeningPrivileges.every(
          ({ publicMaintain, bffMaintain, publicFunction, bffFunction }) =>
            publicMaintain && bffMaintain && publicFunction && bffFunction,
        ),
      ).toBe(true)

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
        left join pg_roles grantee_role on grantee_role.oid = grant_item.grantee
        where defaults.defaclnamespace in (0, 'public'::regnamespace)
          and owner_role.rolname in ('postgres', 'supabase_admin')
          and (
            grant_item.grantee = 0
            or grantee_role.rolname in (
              'anon', 'authenticated', 'service_role', 'axsys_bff'
            )
          )
          and defaults.defaclobjtype in ('r', 'S', 'f')
      `

      const existingPrivileges = await supabaseAdminOwnerSql<
        {
          owner: string
          roleName: string
          tableSelectPrivilege: boolean
          tableDangerousPrivilege: boolean
          sequencePrivilege: boolean
          functionPrivilege: boolean
        }[]
      >`
        select
          owner,
          role_name as "roleName",
          has_table_privilege(
            role_name,
            format('public.axsys_bff_acl_%s_existing_table', owner),
            'SELECT'
          ) as "tableSelectPrivilege",
          has_table_privilege(
            role_name,
            format('public.axsys_bff_acl_%s_existing_table', owner),
            'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
          ) as "tableDangerousPrivilege",
          has_sequence_privilege(
            role_name,
            format('public.axsys_bff_acl_%s_existing_sequence', owner),
            'USAGE,SELECT,UPDATE'
          ) as "sequencePrivilege",
          has_function_privilege(
            role_name,
            format('public.axsys_bff_acl_%s_existing_function()', owner),
            'EXECUTE'
          ) as "functionPrivilege"
        from unnest(array['postgres', 'supabase_admin']) owner
        cross join unnest(
          array['anon', 'authenticated', 'service_role', 'axsys_bff']
        ) role_name
        order by owner, role_name
      `

      const [remainingPublicOrBffObjectGrants] = await supabaseAdminOwnerSql<
        [{ count: number }]
      >`
        select count(*)::integer as count
        from pg_class class
        join pg_namespace namespace on namespace.oid = class.relnamespace
        cross join lateral aclexplode(class.relacl) grant_item
        left join pg_roles grantee on grantee.oid = grant_item.grantee
        where namespace.nspname = 'public'
          and class.relname in (
            'axsys_bff_acl_postgres_existing_table',
            'axsys_bff_acl_postgres_existing_sequence',
            'axsys_bff_acl_supabase_admin_existing_table',
            'axsys_bff_acl_supabase_admin_existing_sequence'
          )
          and (grant_item.grantee = 0 or grantee.rolname = 'axsys_bff')
      `

      const [remainingPublicOrBffFunctionGrants] = await supabaseAdminOwnerSql<
        [{ count: number }]
      >`
        select count(*)::integer as count
        from pg_proc function
        join pg_namespace namespace on namespace.oid = function.pronamespace
        cross join lateral aclexplode(function.proacl) grant_item
        left join pg_roles grantee on grantee.oid = grant_item.grantee
        where namespace.nspname = 'public'
          and function.proname in (
            'axsys_bff_acl_postgres_existing_function',
            'axsys_bff_acl_supabase_admin_existing_function'
          )
          and (grant_item.grantee = 0 or grantee.rolname = 'axsys_bff')
      `

      const futurePrivileges = await supabaseAdminOwnerSql<
        {
          owner: string
          roleName: string
          tablePrivilege: boolean
          sequencePrivilege: boolean
          functionPrivilege: boolean
        }[]
      >`
        select
          owner,
          role_name as "roleName",
          has_table_privilege(
            role_name,
            format('public.axsys_bff_acl_%s_table', owner),
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'
          ) as "tablePrivilege",
          has_sequence_privilege(
            role_name,
            format('public.axsys_bff_acl_%s_sequence', owner),
            'USAGE,SELECT,UPDATE'
          ) as "sequencePrivilege",
          has_function_privilege(
            role_name,
            format('public.axsys_bff_acl_%s_function()', owner),
            'EXECUTE'
          ) as "functionPrivilege"
        from unnest(array['postgres', 'supabase_admin']) owner
        cross join unnest(
          array['anon', 'authenticated', 'service_role', 'axsys_bff']
        ) role_name
        order by owner, role_name
      `

      const [explicitPrivileges] = await supabaseAdminOwnerSql<
        [{
          authenticatedSelect: boolean
          authenticatedThemeUpdate: boolean
          authenticatedProfileTableUpdate: boolean
          otherAuthenticatedUpdateColumns: number
          bffExecute: boolean
        }]
      >`
        select
          has_table_privilege(
            'authenticated',
            'public.axsys_bff_acl_authenticated_probe',
            'SELECT'
          ) as "authenticatedSelect",
          has_column_privilege(
            'authenticated',
            'public.profiles',
            'preferred_theme',
            'UPDATE'
          ) as "authenticatedThemeUpdate",
          has_table_privilege(
            'authenticated',
            'public.profiles',
            'UPDATE'
          ) as "authenticatedProfileTableUpdate",
          (
            select count(*)::integer
            from pg_attribute attribute
            join pg_class class on class.oid = attribute.attrelid
            join pg_namespace namespace on namespace.oid = class.relnamespace
            where namespace.nspname = 'public'
              and class.relkind in ('r', 'p')
              and attribute.attnum > 0
              and not attribute.attisdropped
              and not (
                class.relname = 'profiles'
                and attribute.attname = 'preferred_theme'
              )
              and has_column_privilege(
                'authenticated',
                format('%I.%I', namespace.nspname, class.relname),
                attribute.attname,
                'UPDATE'
              )
          ) as "otherAuthenticatedUpdateColumns",
          has_function_privilege(
            'axsys_bff',
            'private.axsys_bff_acl_private_probe()',
            'EXECUTE'
          ) as "bffExecute"
      `

      expect(remainingDefaults.count).toBe(0)
      expect(remainingPublicOrBffObjectGrants.count).toBe(0)
      expect(remainingPublicOrBffFunctionGrants.count).toBe(0)
      expect(existingPrivileges).toHaveLength(8)
      expect(
        existingPrivileges.every(
          ({
            roleName,
            tableSelectPrivilege,
            tableDangerousPrivilege,
            sequencePrivilege,
            functionPrivilege,
          }) =>
            tableSelectPrivilege === (roleName === "authenticated") &&
            !tableDangerousPrivilege &&
            !sequencePrivilege &&
            !functionPrivilege,
        ),
      ).toBe(true)
      expect(futurePrivileges).toHaveLength(8)
      expect(
        futurePrivileges.every(
          ({ tablePrivilege, sequencePrivilege, functionPrivilege }) =>
            !tablePrivilege && !sequencePrivilege && !functionPrivilege,
        ),
      ).toBe(true)
      expect(explicitPrivileges).toEqual({
        authenticatedSelect: true,
        authenticatedThemeUpdate: true,
        authenticatedProfileTableUpdate: false,
        otherAuthenticatedUpdateColumns: 0,
        bffExecute: true,
      })
    } finally {
      const cleanupErrors: unknown[] = []
      const ownerCleanup = await Promise.allSettled(
        ownerConnections.map(async ([owner, ownerSql]) => {
          await ownerSql.unsafe(`
            drop function if exists public.axsys_bff_acl_${owner}_function();
            drop sequence if exists public.axsys_bff_acl_${owner}_sequence;
            drop table if exists public.axsys_bff_acl_${owner}_table;
            drop function if exists public.axsys_bff_acl_${owner}_existing_function();
            drop sequence if exists public.axsys_bff_acl_${owner}_existing_sequence;
            drop table if exists public.axsys_bff_acl_${owner}_existing_table;

            alter default privileges for role ${owner}
              revoke all privileges on tables
              from public, anon, authenticated, service_role, axsys_bff;
            alter default privileges for role ${owner} in schema public
              revoke all privileges on tables
              from public, anon, authenticated, service_role, axsys_bff;
            alter default privileges for role ${owner}
              revoke all privileges on sequences
              from public, anon, authenticated, service_role, axsys_bff;
            alter default privileges for role ${owner} in schema public
              revoke all privileges on sequences
              from public, anon, authenticated, service_role, axsys_bff;
            alter default privileges for role ${owner}
              revoke all privileges on functions
              from public, anon, authenticated, service_role, axsys_bff;
            alter default privileges for role ${owner} in schema public
              revoke all privileges on functions
              from public, anon, authenticated, service_role, axsys_bff;
          `)
        }),
      )
      for (const result of ownerCleanup) {
        if (result.status === "rejected") cleanupErrors.push(result.reason)
      }

      try {
        await supabaseAdminOwnerSql.unsafe(`
          drop function if exists private.axsys_bff_acl_private_probe();
          drop table if exists public.axsys_bff_acl_authenticated_probe;
        `)
        if (createdPrivateSchema) {
          await supabaseAdminOwnerSql`drop schema if exists private`
        }
      } catch (error) {
        cleanupErrors.push(error)
      }

      try {
        const [residue] = await supabaseAdminOwnerSql<
          [{ objectCount: number; defaultGrantCount: number }]
        >`
          select
            (
              select count(*)::integer
              from (
                select class.relname
                from pg_class class
                join pg_namespace namespace on namespace.oid = class.relnamespace
                where namespace.nspname = 'public'
                  and class.relname like 'axsys_bff_acl_%'
                union all
                select function.proname
                from pg_proc function
                join pg_namespace namespace on namespace.oid = function.pronamespace
                where namespace.nspname in ('public', 'private')
                  and function.proname like 'axsys_bff_acl_%'
              ) objects
            )::integer as "objectCount",
            (
              select count(*)::integer
              from pg_default_acl defaults
              cross join lateral aclexplode(defaults.defaclacl) grant_item
              join pg_roles owner_role on owner_role.oid = defaults.defaclrole
              left join pg_roles grantee_role on grantee_role.oid = grant_item.grantee
              where defaults.defaclnamespace in (0, 'public'::regnamespace)
                and owner_role.rolname in ('postgres', 'supabase_admin')
                and defaults.defaclobjtype in ('r', 'S', 'f')
                and (
                  grant_item.grantee = 0
                  or grantee_role.rolname in (
                    'anon', 'authenticated', 'service_role', 'axsys_bff'
                  )
                )
            )::integer as "defaultGrantCount"
        `
        if (residue.objectCount !== 0 || residue.defaultGrantCount !== 0) {
          cleanupErrors.push(new Error("Default ACL integration cleanup left residue"))
        }
      } catch (error) {
        cleanupErrors.push(error)
      }

      if (cleanupErrors.length > 0) {
        throw new AggregateError(cleanupErrors, "Default ACL integration cleanup failed")
      }
    }
  }, 20_000)
})
