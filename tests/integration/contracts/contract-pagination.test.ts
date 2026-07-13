import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { POST as loginPost } from "@/app/api/auth/login/route"
import { POST as clientsPost } from "@/app/api/administrative/clients/route"
import {
  GET as contractsGet,
  POST as contractsPost,
} from "@/app/api/administrative/contracts/route"
import {
  DELETE as contractDelete,
  GET as contractGet,
  PATCH as contractPatch,
} from "@/app/api/administrative/contracts/[contractId]/route"
import { POST as contractClose } from "@/app/api/administrative/contracts/[contractId]/close/route"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
import { requireCompanyApiContext } from "@/modules/auth/server/guards"
import { listContracts } from "@/modules/contracts/server/contract-service"
import {
  AdversarialLocalFixture,
  cookieStoreForAdversarialJar,
  type AdversarialCookieJar,
  type AdversarialIdentity,
} from "../../helpers/adversarial-local-fixture"
import { requireLocalHttpUrl } from "../../helpers/local-destructive-urls"

const requestCookies = vi.hoisted(() => ({
  current: undefined as AdversarialCookieJar | undefined,
}))

vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!requestCookies.current)
      throw new Error("Contract cookie jar unavailable")
    return cookieStoreForAdversarialJar(requestCookies.current)
  },
}))

const fixture = new AdversarialLocalFixture("administrative-contracts-live")
const appOrigin = requireLocalHttpUrl(
  process.env.APP_ORIGIN,
  "3000",
  "Administrative contracts live test",
).replace(/\/$/u, "")

type RouteContext = Readonly<{ params: Promise<{ contractId: string }> }>
type ContractRecord = Readonly<{
  id: string
  number: string
  endsOn: string
  version: number
  status: "closed" | "expired" | "expiring" | "active"
  closeReason: string | null
}>
type MutationBody = Readonly<{
  record: ContractRecord
  scopes: readonly string[]
}>

function request(
  path: string,
  options: Readonly<{
    body?: unknown
    csrf?: string
    identity?: AdversarialIdentity
    method?: string
  }> = {},
): Request {
  const identity = options.identity ?? fixture.adminA
  const headers = new Headers({
    "content-type": "application/json",
    origin: appOrigin,
    "user-agent": "axsys-contract-live-test",
    "x-correlation-id": fixture.nextCorrelationId(),
    "x-forwarded-for": identity.clientIp,
  })
  if (options.csrf) headers.set("x-csrf-token", options.csrf)
  return new Request(`${appOrigin}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  })
}

function context(contractId: string): RouteContext {
  return { params: Promise.resolve({ contractId }) }
}

function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

async function authenticate(identity: AdversarialIdentity): Promise<void> {
  requestCookies.current = identity.jar
  const response = await loginPost(
    request("/api/auth/login", {
      body: {
        email: identity.email,
        password: identity.password,
        rememberMe: false,
      },
      csrf: fixture.issueCsrf(identity.jar),
      identity,
      method: "POST",
    }),
  )
  expect(response.status).toBe(200)
}

const clientInput = {
  legalName: "Município de Contratos Seguros",
  tradeName: "Prefeitura Contratos Seguros",
  cnpj: "04.252.011/0001-10",
  segment: "Prefeituras",
  email: "contratos@example.test",
  phone: "+55 85 3333-2207",
  addressStreet: "Avenida Central",
  addressNumber: "100",
  addressComplement: null,
  addressNeighborhood: "Centro",
  municipality: "Horizonte",
  state: "CE",
  postalCode: "62880000",
}

const clients = { A: "", B: "" }
let tenantAContract: ContractRecord | null = null

function contractInput(
  clientId: string,
  number: string,
  endsOn = "2027-12-31",
) {
  return {
    clientId,
    number,
    object: `Prestação segura ${number}`,
    startsOn: "2026-01-01",
    endsOn,
    amount: "12500.00",
  }
}

async function createContract(
  identity: AdversarialIdentity,
  body: ReturnType<typeof contractInput>,
): Promise<Response> {
  requestCookies.current = identity.jar
  return contractsPost(
    request("/api/administrative/contracts", {
      body,
      csrf: fixture.issueCsrf(identity.jar),
      identity,
      method: "POST",
    }),
  )
}

beforeAll(async () => {
  vi.stubEnv("TRUST_PROXY", "true")
  await fixture.create()
  await authenticate(fixture.adminA)
  await authenticate(fixture.adminB)
  for (const [suffix, identity] of [
    ["A", fixture.adminA],
    ["B", fixture.adminB],
  ] as const) {
    requestCookies.current = identity.jar
    const response = await clientsPost(
      request("/api/administrative/clients", {
        body: {
          ...clientInput,
          legalName: `${clientInput.legalName} ${suffix}`,
        },
        csrf: fixture.issueCsrf(identity.jar),
        identity,
        method: "POST",
      }),
    )
    expect(response.status).toBe(201)
    clients[suffix] = (
      (await response.json()) as { record: { id: string } }
    ).record.id
  }
}, 60_000)

afterAll(async () => {
  try {
    await fixture.cleanup()
  } finally {
    requestCookies.current = undefined
    vi.unstubAllEnvs()
  }
}, 60_000)

describe.sequential("contract live RLS, CRUD and stable pagination", () => {
  it("allows the same number across tenants and rejects a tenant duplicate", async () => {
    const createdA = await createContract(
      fixture.adminA,
      contractInput(clients.A, "CT-SHARED"),
    )
    const createdB = await createContract(
      fixture.adminB,
      contractInput(clients.B, "CT-SHARED"),
    )
    expect([createdA.status, createdB.status]).toEqual([201, 201])
    expectNoStore(createdA)
    const bodyA = (await createdA.json()) as MutationBody
    const bodyB = (await createdB.json()) as MutationBody
    expect(bodyA.record.id).not.toBe(bodyB.record.id)
    expect(bodyA.scopes).toEqual(["contracts", "notifications", "dashboard"])
    tenantAContract = bodyA.record

    const duplicate = await createContract(
      fixture.adminA,
      contractInput(clients.A, "CT-SHARED"),
    )
    expect(duplicate.status).toBe(409)
    expect(
      ((await duplicate.json()) as { error: { code: string } }).error.code,
    ).toBe("CONTRACT_NUMBER_CONFLICT")
  })

  it("traverses 63 duplicate-date rows as 25/25/13 without shifts", async () => {
    const originalIds = await fixture.seedContractsForPagination(
      clients.A,
      63,
      "CT-PAGE-",
    )

    requestCookies.current = fixture.adminA.jar
    const pages: ContractRecord[][] = []
    let cursor: string | null = null
    do {
      const search = new URLSearchParams({
        q: "CT-PAGE-",
        status: "active",
        clientId: clients.A,
        limit: "25",
      })
      if (cursor) search.set("cursor", cursor)
      const response = await contractsGet(
        request(`/api/administrative/contracts?${search}`, {
          identity: fixture.adminA,
        }),
      )
      expect(response.status).toBe(200)
      expectNoStore(response)
      const body = (await response.json()) as {
        items: ContractRecord[]
        nextCursor: string | null
      }
      pages.push(body.items)
      cursor = body.nextCursor
      if (pages.length === 1) {
        const behind = await createContract(
          fixture.adminA,
          contractInput(clients.A, "CT-PAGE-BEHIND", "2027-01-01"),
        )
        expect(behind.status).toBe(201)
      }
    } while (cursor)

    expect(pages.map(({ length }) => length)).toEqual([25, 25, 13])
    const traversed = pages.flat()
    expect(new Set(traversed.map(({ id }) => id)).size).toBe(63)
    expect(new Set(traversed.map(({ id }) => id))).toEqual(new Set(originalIds))
    expect(traversed.map(({ endsOn, id }) => `${endsOn}:${id}`)).toEqual(
      [...traversed]
        .sort(
          (left, right) =>
            left.endsOn.localeCompare(right.endsOn) ||
            left.id.localeCompare(right.id),
        )
        .map(({ endsOn, id }) => `${endsOn}:${id}`),
    )

    const malformed = await contractsGet(
      request(
        "/api/administrative/contracts?cursor=not-a-valid-cursor&limit=25",
        { identity: fixture.adminA },
      ),
    )
    expect(malformed.status).toBe(422)

    const escapedWildcard = await contractsGet(
      request("/api/administrative/contracts?q=CT-PAGE-%25&limit=25", {
        identity: fixture.adminA,
      }),
    )
    expect(escapedWildcard.status).toBe(200)
    expect(
      ((await escapedWildcard.json()) as { items: ContractRecord[] }).items,
    ).toEqual([])
  }, 90_000)

  it("applies the exact company-local lifecycle boundaries from one clock read", async () => {
    const seeds = [
      ["CT-BOUNDARY-CLOSED", "2026-08-25"],
      ["CT-BOUNDARY-EXPIRED", "2026-07-09"],
      ["CT-BOUNDARY-START", "2026-07-10"],
      ["CT-BOUNDARY-END", "2026-08-24"],
      ["CT-BOUNDARY-ACTIVE", "2026-08-25"],
    ] as const
    const records: ContractRecord[] = []
    for (const [number, endsOn] of seeds) {
      const response = await createContract(
        fixture.adminA,
        contractInput(clients.A, number, endsOn),
      )
      expect(response.status).toBe(201)
      records.push(((await response.json()) as MutationBody).record)
    }
    const toClose = records[0]!
    requestCookies.current = fixture.adminA.jar
    const closed = await contractClose(
      request(`/api/administrative/contracts/${toClose.id}/close`, {
        body: {
          version: toClose.version,
          reason: "Fechamento para limite temporal",
        },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "POST",
      }),
      context(toClose.id),
    )
    expect(closed.status).toBe(200)

    const access = await requireCompanyApiContext("administrative")
    const clock = { now: vi.fn(() => new Date("2026-07-10T12:00:00.000Z")) }
    const expected = {
      closed: ["CT-BOUNDARY-CLOSED"],
      expired: ["CT-BOUNDARY-EXPIRED"],
      expiring: ["CT-BOUNDARY-END", "CT-BOUNDARY-START"],
      active: ["CT-BOUNDARY-ACTIVE"],
    } as const
    for (const status of ["closed", "expired", "expiring", "active"] as const) {
      const page = await listContracts({
        context: access,
        q: "CT-BOUNDARY-",
        status,
        limit: 25,
        clock,
      })
      expect(page.items.map(({ number }) => number).sort()).toEqual(
        [...expected[status]].sort(),
      )
    }
    expect(clock.now).toHaveBeenCalledTimes(4)
  })

  it("treats PostgREST star aliases as literal search input", async () => {
    requestCookies.current = fixture.adminA.jar
    const response = await contractsGet(
      request("/api/administrative/contracts?q=CT-PAGE-*&limit=25", {
        identity: fixture.adminA,
      }),
    )

    expect(response.status).toBe(200)
    expectNoStore(response)
    expect((await response.json()) as { items: ContractRecord[] }).toMatchObject(
      { items: [] },
    )
  })

  it("hides foreign IDs, preserves CAS, closes once and blocks history deletion", async () => {
    if (!tenantAContract) throw new Error("Contract fixture unavailable")
    requestCookies.current = fixture.adminB.jar
    const foreign = await contractGet(
      request(`/api/administrative/contracts/${tenantAContract.id}`, {
        identity: fixture.adminB,
      }),
      context(tenantAContract.id),
    )
    const unknownId = randomUUID()
    const unknown = await contractGet(
      request(`/api/administrative/contracts/${unknownId}`, {
        identity: fixture.adminB,
      }),
      context(unknownId),
    )
    expect([foreign.status, unknown.status]).toEqual([404, 404])
    const foreignError = (await foreign.json()) as {
      error: Record<string, unknown>
    }
    const unknownError = (await unknown.json()) as {
      error: Record<string, unknown>
    }
    expect({ ...foreignError.error, correlationId: undefined }).toEqual({
      ...unknownError.error,
      correlationId: undefined,
    })

    requestCookies.current = fixture.adminA.jar
    const updateBody = {
      ...contractInput(clients.A, tenantAContract.number, "2028-01-31"),
      version: tenantAContract.version,
    }
    const updated = await contractPatch(
      request(`/api/administrative/contracts/${tenantAContract.id}`, {
        body: updateBody,
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "PATCH",
      }),
      context(tenantAContract.id),
    )
    expect(updated.status).toBe(200)
    const updatedRecord = ((await updated.json()) as MutationBody).record

    const stale = await contractPatch(
      request(`/api/administrative/contracts/${tenantAContract.id}`, {
        body: { ...updateBody, object: "Replay obsoleto" },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "PATCH",
      }),
      context(tenantAContract.id),
    )
    expect(stale.status).toBe(409)

    const closed = await contractClose(
      request(`/api/administrative/contracts/${tenantAContract.id}/close`, {
        body: {
          version: updatedRecord.version,
          reason: "Encerramento contratual definitivo",
        },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "POST",
      }),
      context(tenantAContract.id),
    )
    expect(closed.status).toBe(200)
    const closedRecord = ((await closed.json()) as MutationBody).record
    expect(closedRecord).toMatchObject({
      status: "closed",
      closeReason: "Encerramento contratual definitivo",
    })
    expect(await fixture.contractClosureEvidence(tenantAContract.id)).toEqual({
      actorUserId: fixture.adminA.userId,
      auditCount: 1,
      closeReason: "Encerramento contratual definitivo",
      closed: true,
    })

    const closeAgain = await contractClose(
      request(`/api/administrative/contracts/${tenantAContract.id}/close`, {
        body: { version: closedRecord.version, reason: "Tentativa repetida" },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "POST",
      }),
      context(tenantAContract.id),
    )

    const editClosed = await contractPatch(
      request(`/api/administrative/contracts/${tenantAContract.id}`, {
        body: { ...updateBody, version: closedRecord.version },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "PATCH",
      }),
      context(tenantAContract.id),
    )
    const deleteClosed = await contractDelete(
      request(`/api/administrative/contracts/${tenantAContract.id}`, {
        body: { version: closedRecord.version },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "DELETE",
      }),
      context(tenantAContract.id),
    )
    expect(editClosed.status).toBe(409)
    expect(closeAgain.status).toBe(409)
    expect(deleteClosed.status).toBe(409)
  })

  it("deletes an unlinked contract and maps an attachment link to RESOURCE_IN_USE", async () => {
    const freeResponse = await createContract(
      fixture.adminA,
      contractInput(clients.A, "CT-DELETE-FREE"),
    )
    const linkedResponse = await createContract(
      fixture.adminA,
      contractInput(clients.A, "CT-DELETE-LINKED"),
    )
    const free = ((await freeResponse.json()) as MutationBody).record
    const linked = ((await linkedResponse.json()) as MutationBody).record
    await fixture.seedSyntheticContractAttachment(linked.id)

    requestCookies.current = fixture.adminA.jar
    const deleted = await contractDelete(
      request(`/api/administrative/contracts/${free.id}`, {
        body: { version: free.version },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "DELETE",
      }),
      context(free.id),
    )
    const protectedResponse = await contractDelete(
      request(`/api/administrative/contracts/${linked.id}`, {
        body: { version: linked.version },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "DELETE",
      }),
      context(linked.id),
    )

    expect(deleted.status).toBe(204)
    expect(protectedResponse.status).toBe(409)
    expect(
      ((await protectedResponse.json()) as { error: { code: string } }).error
        .code,
    ).toBe("RESOURCE_IN_USE")
  })

  it("uses the functional number prefix index on a 20k-row plan", async () => {
    const plan = await fixture.contractPrefixSearchPlan()

    expect(plan).toContain("contracts_company_number_prefix_idx")
    expect(plan).toContain("contracts_company_object_prefix_idx")
    expect(plan).toContain("Index Cond")
    expect(plan).toContain("lower(number)")
  }, 30_000)
})
