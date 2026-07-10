import { loadEnvFile } from "node:process"
import postgres from "postgres"
import { afterAll, describe, expect, it } from "vitest"

if (!process.env.BFF_DATABASE_URL) {
  try {
    loadEnvFile(".env.local")
  } catch {
    // CI may provide the variable directly without a local dotenv file.
  }
}

const databaseUrl = process.env.BFF_DATABASE_URL
if (!databaseUrl) {
  throw new Error("BFF integration environment is not provisioned")
}

const sql = postgres(databaseUrl, { max: 1, prepare: false })

afterAll(async () => {
  await sql.end()
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
