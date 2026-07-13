import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { POST as loginPost } from "@/app/api/auth/login/route"
import { POST as clientsPost } from "@/app/api/administrative/clients/route"
import { POST as catalogPost } from "@/app/api/administrative/catalog-items/route"
import { PATCH as catalogPatch } from "@/app/api/administrative/catalog-items/[itemId]/route"
import {
  GET as proposalsGet,
  POST as proposalsPost,
} from "@/app/api/administrative/proposals/route"
import {
  DELETE as proposalDelete,
  GET as proposalGet,
} from "@/app/api/administrative/proposals/[proposalId]/route"
import { POST as proposalStatusPost } from "@/app/api/administrative/proposals/[proposalId]/status/route"
import { NO_STORE_HEADERS } from "@/lib/security/no-store"
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
    if (!requestCookies.current) throw new Error("Proposal cookie jar unavailable")
    return cookieStoreForAdversarialJar(requestCookies.current)
  },
}))

const fixture = new AdversarialLocalFixture("administrative-proposals-live")
const appOrigin = requireLocalHttpUrl(
  process.env.APP_ORIGIN,
  "3000",
  "Administrative proposals live test",
).replace(/\/$/u, "")

type ProposalRouteContext = Readonly<{ params: Promise<{ proposalId: string }> }>
type CatalogRouteContext = Readonly<{ params: Promise<{ itemId: string }> }>

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
    "user-agent": "axsys-proposal-live-test",
    "x-correlation-id": fixture.nextCorrelationId(),
    "x-forwarded-for": identity.clientIp,
  })
  if (options.csrf) headers.set("x-csrf-token", options.csrf)
  return new Request(`${appOrigin}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
}

function proposalContext(proposalId: string): ProposalRouteContext {
  return { params: Promise.resolve({ proposalId }) }
}

function catalogContext(itemId: string): CatalogRouteContext {
  return { params: Promise.resolve({ itemId }) }
}

async function authenticate(identity: AdversarialIdentity): Promise<void> {
  requestCookies.current = identity.jar
  const csrf = fixture.issueCsrf(identity.jar)
  const response = await loginPost(request("/api/auth/login", {
    body: { email: identity.email, password: identity.password, rememberMe: false },
    csrf,
    identity,
    method: "POST",
  }))
  expect(response.status).toBe(200)
}

function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

const clientInput = {
  legalName: "Município de Propostas Seguras",
  tradeName: "Prefeitura Propostas Seguras",
  cnpj: "04.252.011/0001-10",
  segment: "Prefeituras",
  email: "propostas@example.test",
  phone: "+55 85 3333-2207",
  addressStreet: "Avenida Central",
  addressNumber: "100",
  addressComplement: null,
  addressNeighborhood: "Centro",
  municipality: "Horizonte",
  state: "CE",
  postalCode: "62880000",
}

const companyState = {
  A: { clientId: "", serviceId: "", serviceVersion: 0, productId: "" },
  B: { clientId: "", serviceId: "", serviceVersion: 0, productId: "" },
}

async function seedTenant(identity: AdversarialIdentity, suffix: "A" | "B") {
  requestCookies.current = identity.jar
  const csrf = fixture.issueCsrf(identity.jar)
  const clientResponse = await clientsPost(request("/api/administrative/clients", {
    body: { ...clientInput, legalName: `${clientInput.legalName} ${suffix}` },
    csrf,
    identity,
    method: "POST",
  }))
  const serviceResponse = await catalogPost(request("/api/administrative/catalog-items", {
    body: {
      itemKind: "service",
      segment: "Prefeituras",
      name: `Assessoria técnica ${suffix}`,
      description: "Descrição histórica do serviço",
    },
    csrf,
    identity,
    method: "POST",
  }))
  const productResponse = await catalogPost(request("/api/administrative/catalog-items", {
    body: {
      itemKind: "product",
      segment: "Prefeituras",
      name: `Equipamento técnico ${suffix}`,
      description: "Descrição histórica do produto",
    },
    csrf,
    identity,
    method: "POST",
  }))
  expect([clientResponse.status, serviceResponse.status, productResponse.status])
    .toEqual([201, 201, 201])
  const client = (await clientResponse.json()) as { record: { id: string } }
  const service = (await serviceResponse.json()) as { record: { id: string; version: number } }
  const product = (await productResponse.json()) as { record: { id: string } }
  companyState[suffix] = {
    clientId: client.record.id,
    serviceId: service.record.id,
    serviceVersion: service.record.version,
    productId: product.record.id,
  }
}

function proposalInput(suffix: "A" | "B") {
  const tenant = companyState[suffix]
  return {
    clientId: tenant.clientId,
    segment: "Prefeituras",
    issuedOn: "2026-07-12",
    items: [
      {
        kind: "service" as const,
        catalogItemId: tenant.serviceId,
        description: "Descrição histórica do serviço",
        months: 3,
        monthlyAmount: "1250.40",
      },
      {
        kind: "product" as const,
        catalogItemId: tenant.productId,
        description: "Descrição histórica do produto",
        quantity: "2.5",
        unitAmount: "199.99",
      },
    ],
  }
}

let proposalsA: Array<{ id: string; number: number; total: string; version: number }> = []
let proposalsB: Array<{ id: string; number: number; total: string; version: number }> = []

beforeAll(async () => {
  vi.stubEnv("TRUST_PROXY", "true")
  await fixture.create()
  await authenticate(fixture.adminA)
  await authenticate(fixture.adminB)
  await seedTenant(fixture.adminA, "A")
  await seedTenant(fixture.adminB, "B")
}, 60_000)

afterAll(async () => {
  try {
    await fixture.cleanup()
  } finally {
    requestCookies.current = undefined
    vi.unstubAllEnvs()
  }
}, 60_000)

describe.sequential("proposal live RLS, numbering and snapshot flow", () => {
  it("creates independent gap-free sequences concurrently with exact totals", async () => {
    requestCookies.current = fixture.adminA.jar
    const csrfA = fixture.issueCsrf(fixture.adminA.jar)
    const createdA = await Promise.all(Array.from({ length: 20 }, () =>
      proposalsPost(request("/api/administrative/proposals", {
        body: proposalInput("A"),
        csrf: csrfA,
        identity: fixture.adminA,
        method: "POST",
      })),
    ))
    requestCookies.current = fixture.adminB.jar
    const csrfB = fixture.issueCsrf(fixture.adminB.jar)
    const createdB = await Promise.all(Array.from({ length: 7 }, () =>
      proposalsPost(request("/api/administrative/proposals", {
        body: proposalInput("B"),
        csrf: csrfB,
        identity: fixture.adminB,
        method: "POST",
      })),
    ))
    expect(createdA.every((response) => response.status === 201)).toBe(true)
    expect(createdB.every((response) => response.status === 201)).toBe(true)
    proposalsA = await Promise.all(createdA.map(async (response) =>
      ((await response.json()) as { proposal: typeof proposalsA[number] }).proposal,
    ))
    proposalsB = await Promise.all(createdB.map(async (response) =>
      ((await response.json()) as { proposal: typeof proposalsB[number] }).proposal,
    ))
    expect(proposalsA.map(({ number }) => number).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 20 }, (_, index) => index + 1))
    expect(proposalsB.map(({ number }) => number).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 7 }, (_, index) => index + 1))
    expect(new Set([...proposalsA, ...proposalsB].map(({ id }) => id)).size).toBe(27)
    expect([...proposalsA, ...proposalsB].every(({ total }) => total === "4251.18"))
      .toBe(true)
  }, 60_000)

  it("lists only the active tenant and keeps snapshot text after catalog edits", async () => {
    requestCookies.current = fixture.adminA.jar
    const list = await proposalsGet(request(
      `/api/administrative/proposals?clientId=${companyState.A.clientId}&status=draft&limit=25`,
      { identity: fixture.adminA },
    ))
    expect(list.status).toBe(200)
    expectNoStore(list)
    const listBody = (await list.json()) as { items: Array<{ id: string }> }
    expect(listBody.items).toHaveLength(20)
    expect(listBody.items.every(({ id }) => proposalsA.some((proposal) => proposal.id === id)))
      .toBe(true)

    const changed = await catalogPatch(request(`/api/administrative/catalog-items/${companyState.A.serviceId}`, {
      body: {
        version: companyState.A.serviceVersion,
        itemKind: "service",
        segment: "Prefeituras",
        name: "Assessoria técnica A",
        description: "Descrição atualizada no catálogo",
      },
      csrf: fixture.issueCsrf(fixture.adminA.jar),
      identity: fixture.adminA,
      method: "PATCH",
    }), catalogContext(companyState.A.serviceId))
    expect(changed.status).toBe(200)

    const detail = await proposalGet(
      request(`/api/administrative/proposals/${proposalsA[0]!.id}`, { identity: fixture.adminA }),
      proposalContext(proposalsA[0]!.id),
    )
    expect(detail.status).toBe(200)
    const detailBody = (await detail.json()) as {
      items: Array<{ description: string; quantity: string | null }>
    }
    expect(detailBody.items.map(({ description }) => description)).toEqual([
      "Descrição histórica do serviço",
      "Descrição histórica do produto",
    ])
    expect(detailBody.items[1]?.quantity).toBe("2.500")
  })

  it("makes a foreign proposal indistinguishable from a random identifier", async () => {
    requestCookies.current = fixture.adminA.jar
    const foreign = await proposalGet(
      request(`/api/administrative/proposals/${proposalsB[0]!.id}`, { identity: fixture.adminA }),
      proposalContext(proposalsB[0]!.id),
    )
    const randomId = randomUUID()
    const unknown = await proposalGet(
      request(`/api/administrative/proposals/${randomId}`, { identity: fixture.adminA }),
      proposalContext(randomId),
    )
    const a = (await foreign.json()) as { error: Record<string, unknown> }
    const b = (await unknown.json()) as { error: Record<string, unknown> }
    expect(foreign.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect({ ...a.error, correlationId: undefined }).toEqual({ ...b.error, correlationId: undefined })
  })

  it("requires a generated document before sending and deletes a legal draft", async () => {
    requestCookies.current = fixture.adminA.jar
    const target = proposalsA[0]!
    const transition = await proposalStatusPost(request(
      `/api/administrative/proposals/${target.id}/status`,
      {
        body: { expectedVersion: target.version, nextStatus: "sent" },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "POST",
      },
    ), proposalContext(target.id))
    expect(transition.status).toBe(409)
    expect(((await transition.json()) as { error: { code: string } }).error.code)
      .toBe("DOCUMENT_REQUIRED")

    const deleted = await proposalDelete(request(`/api/administrative/proposals/${target.id}`, {
      body: { version: target.version },
      csrf: fixture.issueCsrf(fixture.adminA.jar),
      identity: fixture.adminA,
      method: "DELETE",
    }), proposalContext(target.id))
    const deletionError = deleted.status === 204
      ? null
      : await deleted.clone().json() as unknown
    expect({ status: deleted.status, deletionError }).toEqual({
      status: 204,
      deletionError: null,
    })
    expectNoStore(deleted)
  })
})
