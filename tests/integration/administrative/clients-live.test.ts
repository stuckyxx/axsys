import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { POST as loginPost } from "@/app/api/auth/login/route"
import {
  GET as clientsGet,
  POST as clientsPost,
} from "@/app/api/administrative/clients/route"
import {
  DELETE as clientDelete,
  GET as clientGet,
  PATCH as clientPatch,
} from "@/app/api/administrative/clients/[clientId]/route"
import { POST as clientArchive } from "@/app/api/administrative/clients/[clientId]/archive/route"
import { POST as clientRestore } from "@/app/api/administrative/clients/[clientId]/restore/route"
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
    if (!requestCookies.current) throw new Error("Administrative cookie jar unavailable")
    return cookieStoreForAdversarialJar(requestCookies.current)
  },
}))

const fixture = new AdversarialLocalFixture("administrative-clients-live")
const appOrigin = requireLocalHttpUrl(
  process.env.APP_ORIGIN,
  "3000",
  "Administrative clients live test",
).replace(/\/$/u, "")

type RouteContext = Readonly<{ params: Promise<{ clientId: string }> }>

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
    "user-agent": "axsys-administrative-live-test",
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

function context(clientId: string): RouteContext {
  return { params: Promise.resolve({ clientId }) }
}

function expectNoStore(response: Response): void {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

async function authenticate(identity: AdversarialIdentity): Promise<void> {
  requestCookies.current = identity.jar
  const csrf = fixture.issueCsrf(identity.jar)
  const response = await loginPost(
    request("/api/auth/login", {
      body: { email: identity.email, password: identity.password, rememberMe: false },
      csrf,
      identity,
      method: "POST",
    }),
  )
  expect(response.status).toBe(200)
  expectNoStore(response)
}

const clientInput = {
  legalName: "Município de Horizonte",
  tradeName: "Prefeitura de Horizonte",
  cnpj: "04.252.011/0001-10",
  segment: "Prefeituras",
  email: "compras@horizonte.example",
  phone: "+55 85 3333-2207",
  addressStreet: "Avenida Presidente Castelo Branco",
  addressNumber: "5100",
  addressComplement: null,
  addressNeighborhood: "Centro",
  municipality: "Horizonte",
  state: "CE",
  postalCode: "62880000",
}

let clientAId = ""
let clientBId = ""
let clientAVersion = 0

beforeAll(async () => {
  vi.stubEnv("TRUST_PROXY", "true")
  await fixture.create()
  await authenticate(fixture.adminA)
  await authenticate(fixture.adminB)
}, 45_000)

afterAll(async () => {
  try {
    await fixture.cleanup()
  } finally {
    requestCookies.current = undefined
    vi.unstubAllEnvs()
  }
}, 45_000)

describe.sequential("Administrative clients live RLS/BFF flow", () => {
  it("creates the same normalized CNPJ independently in two tenants", async () => {
    requestCookies.current = fixture.adminA.jar
    const first = await clientsPost(
      request("/api/administrative/clients", {
        body: clientInput,
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "POST",
      }),
    )
    requestCookies.current = fixture.adminB.jar
    const second = await clientsPost(
      request("/api/administrative/clients", {
        body: { ...clientInput, legalName: "Município de Horizonte B" },
        csrf: fixture.issueCsrf(fixture.adminB.jar),
        identity: fixture.adminB,
        method: "POST",
      }),
    )

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expectNoStore(first)
    const firstBody = (await first.json()) as { record: { id: string; version: number; cnpj: string } }
    const secondBody = (await second.json()) as { record: { id: string } }
    clientAId = firstBody.record.id
    clientBId = secondBody.record.id
    clientAVersion = firstBody.record.version
    expect(firstBody.record.cnpj).toBe("04252011000110")
    expect(clientBId).not.toBe(clientAId)
  })

  it("lists and aggregates only the authenticated tenant through RLS", async () => {
    requestCookies.current = fixture.adminA.jar
    const list = await clientsGet(
      request("/api/administrative/clients?q=Munic%C3%ADpio&archived=false&limit=25", {
        identity: fixture.adminA,
      }),
    )
    const detail = await clientGet(
      request(`/api/administrative/clients/${clientAId}`, { identity: fixture.adminA }),
      context(clientAId),
    )

    expect(list.status).toBe(200)
    expect(detail.status).toBe(200)
    const listBody = (await list.json()) as { items: Array<{ id: string }> }
    const detailBody = (await detail.json()) as {
      aggregates: { proposalCount: number; proposalTotal: string; contractCount: number; contractTotal: string }
    }
    expect(listBody.items.map(({ id }) => id)).toEqual([clientAId])
    expect(detailBody.aggregates).toEqual({
      proposalCount: 0,
      proposalTotal: "0.00",
      contractCount: 0,
      contractTotal: "0.00",
    })
  })

  it("makes a foreign identifier indistinguishable from an unknown identifier", async () => {
    requestCookies.current = fixture.adminA.jar
    const foreign = await clientGet(
      request(`/api/administrative/clients/${clientBId}`, { identity: fixture.adminA }),
      context(clientBId),
    )
    const unknownId = randomUUID()
    const unknown = await clientGet(
      request(`/api/administrative/clients/${unknownId}`, { identity: fixture.adminA }),
      context(unknownId),
    )
    const foreignBody = (await foreign.json()) as { error: Record<string, unknown> }
    const unknownBody = (await unknown.json()) as { error: Record<string, unknown> }

    expect(foreign.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect({ ...foreignBody.error, correlationId: undefined }).toEqual({
      ...unknownBody.error,
      correlationId: undefined,
    })
  })

  it("updates by CAS and rejects a stale replay without overwriting", async () => {
    requestCookies.current = fixture.adminA.jar
    const csrf = fixture.issueCsrf(fixture.adminA.jar)
    const updated = await clientPatch(
      request(`/api/administrative/clients/${clientAId}`, {
        body: { ...clientInput, legalName: "Município de Horizonte Atualizado", version: clientAVersion },
        csrf,
        identity: fixture.adminA,
        method: "PATCH",
      }),
      context(clientAId),
    )
    const stale = await clientPatch(
      request(`/api/administrative/clients/${clientAId}`, {
        body: { ...clientInput, legalName: "Replay obsoleto", version: clientAVersion },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "PATCH",
      }),
      context(clientAId),
    )

    expect(updated.status).toBe(200)
    expect(stale.status).toBe(409)
    const updatedBody = (await updated.json()) as { record: { version: number } }
    clientAVersion = updatedBody.record.version
  })

  it("archives, restores and hard-deletes an unlinked client", async () => {
    requestCookies.current = fixture.adminA.jar
    const archived = await clientArchive(
      request(`/api/administrative/clients/${clientAId}/archive`, {
        body: { version: clientAVersion },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "POST",
      }),
      context(clientAId),
    )
    const archivedBody = (await archived.json()) as { record: { version: number } }
    const restored = await clientRestore(
      request(`/api/administrative/clients/${clientAId}/restore`, {
        body: { version: archivedBody.record.version },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "POST",
      }),
      context(clientAId),
    )
    const restoredBody = (await restored.json()) as { record: { version: number } }
    const deleted = await clientDelete(
      request(`/api/administrative/clients/${clientAId}`, {
        body: { version: restoredBody.record.version },
        csrf: fixture.issueCsrf(fixture.adminA.jar),
        identity: fixture.adminA,
        method: "DELETE",
      }),
      context(clientAId),
    )

    expect(archived.status).toBe(200)
    expect(restored.status).toBe(200)
    expect(deleted.status).toBe(204)
    expectNoStore(deleted)
  })
})
