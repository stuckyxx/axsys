import { resolve } from "node:path"
import { loadConfigFromFile } from "vite"
import { describe, expect, it } from "vitest"

type InlineProject = {
  resolve?: { alias?: Record<string, string> }
  test?: {
    environment?: string
    include?: string[]
    name?: string
    setupFiles?: string[]
  }
}

describe("Vitest project isolation", () => {
  it("keeps browser setup in the UI project and server-only in the Node project", async () => {
    const loadedConfig = await loadConfigFromFile(
      { command: "serve", mode: "test" },
      resolve("vitest.config.ts"),
    )
    expect(loadedConfig).not.toBeNull()

    const rootConfig = loadedConfig?.config as {
      resolve?: { alias?: Record<string, string>; tsconfigPaths?: boolean }
      test?: { projects?: InlineProject[] }
    }
    const projectNamed = (name: string) =>
      rootConfig.test?.projects?.find((project) => project.test?.name === name)
    const uiProject = projectNamed("ui")
    const nodeProject = projectNamed("node")

    expect(rootConfig.resolve?.alias ?? {}).not.toHaveProperty("server-only")
    expect(rootConfig.resolve?.tsconfigPaths).toBe(true)
    expect(uiProject?.test).toMatchObject({
      environment: "jsdom",
      include: ["tests/unit/**/*.{test,spec}.tsx"],
      setupFiles: ["./vitest.setup.ts"],
    })
    expect(uiProject?.resolve?.alias ?? {}).not.toHaveProperty("server-only")
    expect(nodeProject?.test).toMatchObject({
      environment: "node",
      include: [
        "tests/unit/**/*.{test,spec}.ts",
        "tests/integration/**/*.{test,spec}.{ts,tsx}",
      ],
      setupFiles: [],
    })
    expect(nodeProject?.resolve?.alias).toHaveProperty("server-only")
  })
})
