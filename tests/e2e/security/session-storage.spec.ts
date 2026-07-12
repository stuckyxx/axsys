import { Buffer } from "node:buffer"

import {
  expect,
  test as base,
  type Page,
} from "@playwright/test"

import {
  AdversarialLocalFixture,
  type AdversarialIdentity,
} from "../../helpers/adversarial-local-fixture"

const AUTH_COOKIE =
  /^sb-[A-Za-z0-9._-]+-auth-token(?:-code-verifier)?(?:\.[0-9]+)?$/u
const AUTH_COOKIE_PART =
  /^(sb-[A-Za-z0-9._-]+-auth-token(?:-code-verifier)?)(?:\.([0-9]+))?$/u
const CSRF_COOKIE = "__Host-axsys-csrf"

type AdversarialFixtures = Readonly<{
  adversarialFixture: AdversarialLocalFixture
}>

const test = base.extend<AdversarialFixtures>({
  adversarialFixture: async ({}, provide, testInfo) => {
    const fixture = new AdversarialLocalFixture(
      `session-storage-${testInfo.project.name}-${testInfo.workerIndex}`,
    )
    try {
      await fixture.create()
      await provide(fixture)
    } finally {
      await fixture.cleanup()
    }
  },
})

test.use({ trace: "off", screenshot: "off", video: "off" })

async function login(page: Page, identity: AdversarialIdentity): Promise<void> {
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": identity.clientIp,
  })
  await page.goto("/login")
  await page.getByLabel("E-mail").fill(identity.email)
  await page.getByLabel("Senha").fill(identity.password)
  try {
    await page.getByRole("button", { name: "Entrar" }).click()
    await expect(page).toHaveURL(/\/app\/dashboard$/u, { timeout: 30_000 })
  } finally {
    await page
      .locator("#login-password")
      .evaluateAll((inputs: HTMLInputElement[]) => {
        for (const input of inputs) input.value = ""
      })
      .catch(() => undefined)
  }
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
}

async function browserStorage(page: Page, themeKey: string) {
  return page.evaluate(async (allowedThemeKey) => {
    const SENSITIVE = /supabase|jwt|access.?token|refresh.?token|session/iu
    const localEntries = Object.entries(localStorage)
    const sessionEntries = Object.entries(sessionStorage)
    const applicationSessionEntries = sessionEntries.filter(
      ([key]) => !key.startsWith("__next_debug_channel:"),
    )
    const cacheNames = await caches.keys()
    const indexedDatabaseNames =
      typeof indexedDB.databases === "function"
        ? (await indexedDB.databases()).map(({ name }) => name ?? "")
        : []
    const sensitiveViolationKinds = new Set<string>()
    for (const [source, entries] of [
      ["local-storage", localEntries],
      ["session-storage", applicationSessionEntries],
    ] as const) {
      for (const [key, value] of entries) {
        if (SENSITIVE.test(key)) sensitiveViolationKinds.add(`${source}:key`)
        if (SENSITIVE.test(value)) sensitiveViolationKinds.add(`${source}:value`)
      }
    }
    for (const name of cacheNames) {
      if (SENSITIVE.test(name)) sensitiveViolationKinds.add("cache-storage:name")
    }
    for (const name of indexedDatabaseNames) {
      if (SENSITIVE.test(name)) sensitiveViolationKinds.add("indexed-db:name")
    }

    return {
      applicationSessionEntryCount: applicationSessionEntries.length,
      cacheCount: cacheNames.length,
      indexedDatabaseCount: indexedDatabaseNames.length,
      localEntryCount: localEntries.length,
      sensitiveViolationKinds: [...sensitiveViolationKinds].sort(),
      themeState: (() => {
        const value = localStorage.getItem(allowedThemeKey)
        if (value === null) return "missing"
        if (value === "dark" || value === "light") return value
        return "invalid"
      })(),
      unexpectedLocalEntryCount: localEntries.filter(
        ([key]) => key !== allowedThemeKey,
      ).length,
    }
  }, themeKey)
}

type StorageCredentialInspection = Readonly<{
  invalidDebugKeyCount: number
  leakedCredentialKinds: string[]
  persistedJwt: boolean
}>

async function inspectStoredCredentials(
  page: Page,
  credentials: readonly { kind: string; value: string }[],
): Promise<StorageCredentialInspection> {
  return page.evaluate((credentialValues) => {
    const DEBUG_KEY = /^__next_debug_channel:[A-Za-z0-9_-]{8,128}$/u
    const JWT =
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u
    const decodedDebugChunks: { key: string; value: string }[] = []
    const decodedDebugStreams: { key: string; value: string }[] = []
    let invalidDebugKeyCount = 0

    for (const [key, serialized] of Object.entries(sessionStorage)) {
      if (!key.startsWith("__next_debug_channel:")) continue
      if (!DEBUG_KEY.test(key)) {
        invalidDebugKeyCount += 1
        continue
      }
      try {
        const chunks = JSON.parse(serialized) as unknown
        if (
          !Array.isArray(chunks) ||
          Object.keys(chunks).length !== chunks.length ||
          chunks.length > 16_384 ||
          !chunks.every(
            (chunk) => typeof chunk === "string" && chunk.length <= 4_194_304,
          )
        ) {
          invalidDebugKeyCount += 1
          continue
        }
        let decodedStream = ""
        for (const chunk of chunks) {
          const binary = atob(chunk as string)
          if (btoa(binary) !== chunk) throw new Error("non-canonical base64")
          decodedDebugChunks.push({ key, value: binary })
          decodedStream += binary
        }
        decodedDebugStreams.push({ key, value: decodedStream })
      } catch {
        invalidDebugKeyCount += 1
      }
    }

    const stored = [
      ...Object.entries(localStorage).flatMap(([key, value]) => [
        { source: "local-storage-key", value: key },
        { source: "local-storage-value", value },
      ]),
      ...Object.entries(sessionStorage).flatMap(([key, value]) => [
        { source: "session-storage-key", value: key },
        { source: "session-storage-value", value },
      ]),
      ...decodedDebugChunks.map(({ value }) => ({
        source: "next-debug-decoded",
        value,
      })),
      ...decodedDebugStreams.map(({ value }) => ({
        source: "next-debug-stream",
        value,
      })),
    ]
    const leakedCredentialKinds = new Set<string>()
    for (const entry of stored) {
      for (const credential of credentialValues) {
        if (
          credential.value.length > 0 &&
          entry.value.includes(credential.value)
        ) {
          leakedCredentialKinds.add(`${credential.kind}:${entry.source}`)
        }
      }
    }
    return {
      invalidDebugKeyCount,
      leakedCredentialKinds: [...leakedCredentialKinds].sort(),
      persistedJwt: stored.some(({ value }) => JWT.test(value)),
    }
  }, credentials)
}

function credentialFragments(
  cookies: readonly { name: string; value: string }[],
): { kind: string; value: string }[] {
  const fragments = cookies
    .filter(({ value }) => value.length > 0)
    .map(({ name, value }) => ({
      kind: name === CSRF_COOKIE ? "csrf-cookie" : "auth-cookie-encoded",
      value,
    }))
  const groups = new Map<
    string,
    { chunks: Map<number, string>; direct: string | null }
  >()

  for (const cookie of cookies) {
    const parsedName = AUTH_COOKIE_PART.exec(cookie.name)
    if (!parsedName) continue
    const baseName = parsedName[1]!
    const indexText = parsedName[2]
    const group = groups.get(baseName) ?? {
      chunks: new Map<number, string>(),
      direct: null,
    }
    if (indexText === undefined) {
      if (group.direct !== null) {
        throw new Error("Task 17 duplicate Auth cookie")
      }
      group.direct = cookie.value
    } else {
      const index = Number(indexText)
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        String(index) !== indexText ||
        group.chunks.has(index)
      ) {
        throw new Error("Task 17 malformed Auth cookie chunks")
      }
      group.chunks.set(index, cookie.value)
    }
    groups.set(baseName, group)
  }

  for (const [baseName, group] of groups) {
    if (group.direct !== null && group.chunks.size > 0) {
      throw new Error("Task 17 ambiguous Auth cookie chunks")
    }
    let serialized = group.direct
    if (serialized === null) {
      const indices = [...group.chunks.keys()].sort((left, right) => left - right)
      if (
        indices.length === 0 ||
        indices.some((index, position) => index !== position)
      ) {
        throw new Error("Task 17 incomplete Auth cookie chunks")
      }
      serialized = indices.map((index) => group.chunks.get(index)!).join("")
    }
    fragments.push({ kind: "auth-cookie-encoded", value: serialized })
    if (baseName.endsWith("-code-verifier")) continue
    if (!serialized.startsWith("base64-")) {
      throw new Error("Task 17 Auth cookie encoding is invalid")
    }

    let decoded: unknown
    try {
      decoded = JSON.parse(
        Buffer.from(serialized.slice("base64-".length), "base64url").toString(
          "utf8",
        ),
      ) as unknown
    } catch {
      throw new Error("Task 17 Auth cookie payload is invalid")
    }
    if (typeof decoded !== "object" || decoded === null) {
      throw new Error("Task 17 Auth cookie payload is invalid")
    }
    for (const key of ["access_token", "refresh_token"] as const) {
      const value = (decoded as Record<string, unknown>)[key]
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("Task 17 Auth cookie credential is invalid")
      }
      fragments.push({ kind: key.replaceAll("_", "-"), value })
    }
  }
  return [...new Map(
    fragments.map((fragment) => [
      `${fragment.kind}\u0000${fragment.value}`,
      fragment,
    ]),
  ).values()]
}

type SetCookieMetadata = Readonly<{
  domain: string | null
  expired: boolean
  httpOnly: boolean
  maxAge: string | null
  name: string
  path: string | null
  sameSite: string | null
  secure: boolean
}>

function setCookieMetadata(header: string): SetCookieMetadata {
  const parts = header.split(";").map((part) => part.trim())
  const name = parts[0]?.split("=", 1)[0] ?? ""
  const attributes = new Map(
    parts.slice(1).map((part) => {
      const separator = part.indexOf("=")
      return separator === -1
        ? [part.toLowerCase(), ""]
        : [
            part.slice(0, separator).toLowerCase(),
            part.slice(separator + 1),
          ]
    }),
  )
  const expires = attributes.get("expires")
  return Object.freeze({
    domain: attributes.get("domain") ?? null,
    expired:
      expires !== undefined &&
      Number.isFinite(Date.parse(expires)) &&
      Date.parse(expires) <= Date.now(),
    httpOnly: attributes.has("httponly"),
    maxAge: attributes.get("max-age") ?? null,
    name,
    path: attributes.get("path") ?? null,
    sameSite: attributes.get("samesite") ?? null,
    secure: attributes.has("secure"),
  })
}

async function logout(page: Page): Promise<{
  setCookies: SetCookieMetadata[]
  status: number
}> {
  const controlPage = await page.context().newPage()
  try {
    await controlPage.goto("/forgot-password")
    const logoutResponse = controlPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/logout" &&
        response.request().method() === "POST",
    )
    const [response, browserResult] = await Promise.all([
      logoutResponse,
      controlPage.evaluate(async () => {
        const csrfResponse = await fetch("/api/auth/csrf", {
          cache: "no-store",
          credentials: "same-origin",
        })
        const csrfBody = (await csrfResponse.json().catch(() => null)) as unknown
        if (
          !csrfResponse.ok ||
          typeof csrfBody !== "object" ||
          csrfBody === null ||
          !("token" in csrfBody) ||
          typeof csrfBody.token !== "string"
        ) {
          return { phase: "csrf", status: csrfResponse.status }
        }
        const result = await fetch("/api/auth/logout", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { "x-csrf-token": csrfBody.token },
          method: "POST",
        })
        return { phase: "logout", status: result.status }
      }),
    ])
    expect(browserResult).toEqual({ phase: "logout", status: response.status() })
    const headers = await response.headersArray()
    return {
      setCookies: headers
        .filter(({ name }) => name.toLowerCase() === "set-cookie")
        .map(({ value }) => setCookieMetadata(value)),
      status: response.status(),
    }
  } finally {
    await controlPage.close()
  }
}

async function revalidateUntilLogin(page: Page): Promise<void> {
  let focusError: unknown
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  } catch (error) {
    focusError = error
  }
  try {
    await expect.poll(() => page.url(), { timeout: 20_000 }).toMatch(/\/login$/u)
  } catch (error) {
    if (focusError !== undefined) throw focusError
    throw error
  }
}

function browserCookieAttributes(cookie: {
  httpOnly: boolean
  path: string
  sameSite: string
  secure: boolean
}) {
  return {
    httpOnly: cookie.httpOnly,
    path: cookie.path,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
  }
}

async function visibleSensitiveKinds(
  page: Page,
  sensitiveValues: readonly { kind: string; value: string }[],
): Promise<string[]> {
  return page.locator("body").evaluate(
    (body, values) =>
      values
        .filter(({ value }) => body.textContent?.includes(value) === true)
        .map(({ kind }) => kind),
    sensitiveValues,
  )
}

test("keeps session credentials in hardened cookies only and purges protected state on logout", async ({
  adversarialFixture,
  context,
  page,
}) => {
  test.setTimeout(90_000)
  const identity = adversarialFixture.memberA
  await login(page, identity)

  const themeKey = `axsys-theme:${identity.userId}`
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), themeKey), {
      timeout: 20_000,
    })
    .toBe("dark")

  const storage = await browserStorage(page, themeKey)
  expect(storage).toEqual({
    applicationSessionEntryCount: 0,
    cacheCount: 0,
    indexedDatabaseCount: 0,
    localEntryCount: 1,
    sensitiveViolationKinds: [],
    themeState: "dark",
    unexpectedLocalEntryCount: 0,
  })

  const cookies = await context.cookies()
  const authCookies = cookies.filter(({ name }) => AUTH_COOKIE.test(name))
  expect(authCookies.length).toBeGreaterThan(0)
  for (const cookie of authCookies) {
    expect(browserCookieAttributes(cookie)).toEqual({
      httpOnly: true,
      path: "/",
      sameSite: "Lax",
      secure: true,
    })
  }
  const credentials = credentialFragments(
    cookies.filter(
      ({ name }) => name === CSRF_COOKIE || AUTH_COOKIE.test(name),
    ),
  )
  const storageInspection = await inspectStoredCredentials(page, credentials)
  expect(storageInspection).toEqual({
    invalidDebugKeyCount: 0,
    leakedCredentialKinds: [],
    persistedJwt: false,
  })
  expect(
    cookies
      .filter(({ name }) => name === CSRF_COOKIE)
      .map(browserCookieAttributes),
  ).toEqual([
    {
      httpOnly: true,
      path: "/",
      sameSite: "Strict",
      secure: true,
    },
  ])

  const secondPage = await context.newPage()
  await secondPage.goto("/app/dashboard")
  await expect(secondPage.getByRole("heading", { name: "Dashboard" })).toBeVisible()

  const logoutResult = await logout(page)
  expect(logoutResult.status).toBe(204)
  const deletionNames = logoutResult.setCookies.map(({ name }) => name)
  const expectedDeletionNames = [
    ...new Set(
      cookies
        .filter(
          ({ name }) => name === CSRF_COOKIE || AUTH_COOKIE.test(name),
        )
        .map(({ name }) => name),
    ),
  ].sort()
  expect([...new Set(deletionNames)].sort()).toEqual(expectedDeletionNames)
  expect(deletionNames).toHaveLength(expectedDeletionNames.length)
  for (const deletion of logoutResult.setCookies.filter(
    ({ name }) => name === CSRF_COOKIE || AUTH_COOKIE.test(name),
  )) {
    expect.soft(deletion).toMatchObject({
      domain: null,
      httpOnly: true,
      path: "/",
      secure: true,
    })
    expect.soft(deletion.sameSite?.toLowerCase()).toBe(
      deletion.name === CSRF_COOKIE ? "strict" : "lax",
    )
    expect.soft(deletion.maxAge === "0" || deletion.expired).toBe(true)
  }
  const afterLogoutCookies = await context.cookies()
  expect(
    afterLogoutCookies.filter(
      ({ name }) => name === CSRF_COOKIE || AUTH_COOKIE.test(name),
    ).map(({ name }) => name),
    JSON.stringify(logoutResult.setCookies),
  ).toEqual([])

  await revalidateUntilLogin(page)
  await expect(page).toHaveURL(/\/login$/u, { timeout: 20_000 })
  await expect(page.getByRole("heading", { name: "Acesse sua conta" })).toBeVisible()
  expect(
    await visibleSensitiveKinds(page, [
      { kind: "display-name", value: identity.displayName },
      { kind: "email", value: identity.email },
    ]),
  ).toEqual([])

  await revalidateUntilLogin(secondPage)
  await expect(secondPage).toHaveURL(/\/login$/u)
  await expect(
    secondPage.getByRole("heading", { name: "Acesse sua conta" }),
  ).toBeVisible()
  expect(
    await visibleSensitiveKinds(secondPage, [
      { kind: "display-name", value: identity.displayName },
      { kind: "email", value: identity.email },
    ]),
  ).toEqual([])
  await expect(
    secondPage.locator('nav[aria-label="Navegação da empresa"]'),
  ).toHaveCount(0)

  const finalStorage = await browserStorage(page, themeKey)
  expect(finalStorage).toEqual({
    applicationSessionEntryCount: 0,
    cacheCount: 0,
    indexedDatabaseCount: 0,
    localEntryCount: 1,
    sensitiveViolationKinds: [],
    themeState: "dark",
    unexpectedLocalEntryCount: 0,
  })
  expect(await inspectStoredCredentials(page, credentials)).toEqual({
    invalidDebugKeyCount: 0,
    leakedCredentialKinds: [],
    persistedJwt: false,
  })
})
