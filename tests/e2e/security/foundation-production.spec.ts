import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test"

const CSRF_COOKIE_NAME = "__Host-axsys-csrf"

type SecurityPolicyViolation = Readonly<{
  blockedURI: string
  columnNumber: number
  disposition: string
  effectiveDirective: string
  lineNumber: number
  originalPolicy: string
  sample: string
  sourceFile: string
  violatedDirective: string
}>

type FoundationWindow = Window & {
  __foundationCspViolations?: SecurityPolicyViolation[]
}

type BrowserFetchResult = Readonly<{
  headers: Record<string, string>
  status: number
  token: unknown
}>

type MutationResult = Readonly<{
  headers: Record<string, string>
  status: number
}>

function expectNoStore(headers: Record<string, string>): void {
  expect(headers["cache-control"]?.toLowerCase()).toBe(
    "private, no-store, max-age=0, must-revalidate",
  )
  expect(headers.pragma?.toLowerCase()).toBe("no-cache")
  expect(headers.expires).toBe("0")
}

function expectVaryCredentials(headers: Record<string, string>): void {
  const vary = (headers.vary ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
  expect(vary).toEqual([
    "cookie",
    "authorization",
    "rsc",
    "next-router-state-tree",
    "next-router-prefetch",
    "next-router-segment-prefetch",
  ])
}

function expectSensitiveResponse(headers: Record<string, string>): void {
  expectNoStore(headers)
  expectVaryCredentials(headers)
}

async function getCspViolations(page: Page): Promise<SecurityPolicyViolation[]> {
  return page.evaluate(
    () =>
      (window as FoundationWindow).__foundationCspViolations?.slice() ?? [],
  )
}

async function fetchCsrf(page: Page): Promise<BrowserFetchResult> {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/csrf", {
      cache: "no-store",
      credentials: "same-origin",
    })
    const body = (await response.json()) as unknown
    const headers: Record<string, string> = {}
    response.headers.forEach((value, name) => {
      headers[name] = value
    })
    return {
      headers,
      status: response.status,
      token:
        typeof body === "object" && body !== null && "token" in body
          ? body.token
          : undefined,
    }
  })
}

async function postInvalidLogin(
  page: Page,
  token: string,
  marker: string,
): Promise<MutationResult> {
  return page.evaluate(
    async ({ csrfToken, requestMarker }) => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ unexpected: requestMarker }),
      })
      const headers: Record<string, string> = {}
      response.headers.forEach((value, name) => {
        headers[name] = value
      })
      return { headers, status: response.status }
    },
    { csrfToken: token, requestMarker: marker },
  )
}

async function csrfCookie(context: BrowserContext) {
  return (await context.cookies()).find(
    (cookie) => cookie.name === CSRF_COOKIE_NAME,
  )
}

async function expectTokenNotPersisted(page: Page, token: string): Promise<void> {
  const storage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }))
  expect(JSON.stringify(storage)).not.toContain(token)
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    const foundationWindow = window as FoundationWindow
    foundationWindow.__foundationCspViolations = []
    document.addEventListener(
      "securitypolicyviolation",
      (event) => {
        foundationWindow.__foundationCspViolations?.push({
          blockedURI: event.blockedURI,
          columnNumber: event.columnNumber,
          disposition: event.disposition,
          effectiveDirective: event.effectiveDirective,
          lineNumber: event.lineNumber,
          originalPolicy: event.originalPolicy,
          sample: event.sample,
          sourceFile: event.sourceFile,
          violatedDirective: event.violatedDirective,
        })
      },
      { capture: true },
    )
  })
})

test("next start hydrates login under one CSP nonce without violations", async ({
  page,
}) => {
  const runtimeErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  page.on("pageerror", (error) => runtimeErrors.push(error.message))

  const response = await page.goto("/login", { waitUntil: "networkidle" })
  expect(response).not.toBeNull()
  if (!response) throw new Error("Login navigation returned no response")
  expect(response.status()).toBe(200)

  const headers = response.headers()
  expectNoStore(headers)
  const csp = headers["content-security-policy"] ?? ""
  expect(csp).not.toContain("'unsafe-eval'")
  const nonceMatches = [...csp.matchAll(/'nonce-([^']+)'/gu)]
  expect(nonceMatches).toHaveLength(1)
  const nonce = nonceMatches[0]?.[1]
  expect(nonce).toMatch(/^[A-Za-z0-9+/_=-]{1,128}$/u)

  await expect(
    page.getByRole("heading", { name: "Acesse sua conta" }),
  ).toBeVisible()
  await expect(page.getByLabel("E-mail")).toBeEditable()
  await expect(page.getByLabel("Senha")).toBeEditable()
  await expect(page.getByRole("button", { name: "Entrar" })).toBeEnabled()

  const rememberMe = page.getByRole("checkbox", { name: "Manter conectado" })
  await rememberMe.click()
  await expect(rememberMe).toBeChecked()

  const executableScripts = await page.evaluate(() => {
    const executableTypes = new Set([
      "",
      "application/javascript",
      "module",
      "text/javascript",
    ])
    return Array.from(document.scripts)
      .filter((script) => executableTypes.has(script.type.trim().toLowerCase()))
      .map((script) => ({
        nonce: script.nonce,
        source: script.src || "inline",
        type: script.type,
      }))
  })
  expect(executableScripts.length).toBeGreaterThan(0)
  for (const script of executableScripts) {
    expect(script.nonce, `nonce mismatch for ${script.source}`).toBe(nonce)
  }

  await expect(
    page.locator(
      "nextjs-portal, [data-nextjs-dialog], #webpack-dev-server-client-overlay",
    ),
  ).toHaveCount(0)
  expect(runtimeErrors).toEqual([])
  expect(await getCspViolations(page)).toEqual([])
})

test("two tabs reuse one strict CSRF cookie across interleaved mutations", async ({
  context,
  page: pageA,
}) => {
  const pageB = await context.newPage()
  const [loginA, loginB] = await Promise.all([
    pageA.goto("/login", { waitUntil: "networkidle" }),
    pageB.goto("/login", { waitUntil: "networkidle" }),
  ])
  expect(loginA).not.toBeNull()
  expect(loginB).not.toBeNull()
  if (!loginA || !loginB) throw new Error("Login navigation returned no response")
  expectNoStore(loginA.headers())
  expectNoStore(loginB.headers())

  const first = await fetchCsrf(pageA)
  expect(first.status).toBe(200)
  expectSensitiveResponse(first.headers)
  expect(typeof first.token).toBe("string")
  if (typeof first.token !== "string") throw new Error("Missing first CSRF token")

  const cookieAfterFirst = await csrfCookie(context)
  expect(cookieAfterFirst).toBeDefined()
  expect(cookieAfterFirst?.value).toBe(first.token)

  const second = await fetchCsrf(pageB)
  expect(second.status).toBe(200)
  expectSensitiveResponse(second.headers)
  expect(second.token).toBe(first.token)
  if (typeof second.token !== "string") throw new Error("Missing second CSRF token")

  const cookieAfterSecond = await csrfCookie(context)
  expect(cookieAfterSecond).toEqual(cookieAfterFirst)
  expect(cookieAfterSecond).toMatchObject({
    httpOnly: true,
    name: CSRF_COOKIE_NAME,
    path: "/",
    sameSite: "Strict",
    secure: true,
    value: first.token,
  })

  const mutations = [
    await postInvalidLogin(pageA, first.token, "a-1"),
    await postInvalidLogin(pageB, second.token, "b-1"),
    await postInvalidLogin(pageA, first.token, "a-2"),
    await postInvalidLogin(pageB, second.token, "b-2"),
  ]
  for (const mutation of mutations) {
    expect(mutation.status).not.toBe(403)
    expect(mutation.status).toBe(422)
    expectSensitiveResponse(mutation.headers)
  }

  await expectTokenNotPersisted(pageA, first.token)
  await expectTokenNotPersisted(pageB, second.token)
  expect(await getCspViolations(pageA)).toEqual([])
  expect(await getCspViolations(pageB)).toEqual([])
})
