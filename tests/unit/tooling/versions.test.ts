import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const pkg = JSON.parse(readFileSync("package.json", "utf8"))

describe("toolchain", () => {
  it.each([
    ["next", "16.2.10"],
    ["react", "19.2.7"],
    ["react-dom", "19.2.7"],
    ["@supabase/ssr", "0.12.0"],
    ["@supabase/supabase-js", "2.110.2"],
    ["@tanstack/react-query", "5.101.2"],
    ["@phosphor-icons/react", "2.1.10"],
  ])("fixa %s em %s", (name, version) => {
    expect(pkg.dependencies[name]).toBe(version)
  })

  it.each([
    ["supabase", "2.109.1"],
    ["vitest", "4.1.10"],
    ["@playwright/test", "1.61.1"],
    ["jsdom", "29.1.1"],
  ])("fixa a dependência de desenvolvimento %s em %s", (name, version) => {
    expect(pkg.devDependencies[name]).toBe(version)
  })

  it("fixa Node.js e npm", () => {
    expect(pkg.engines.node).toBe("24.13.0")
    expect(pkg.packageManager).toBe("npm@11.6.2")
  })

  it.each(["dependencies", "devDependencies"])("rejeita ranges em %s", (section) => {
    for (const [name, version] of Object.entries(pkg[section])) {
      expect(version, `${section}.${name}`).not.toMatch(/^[~^]/)
    }
  })

  it("mantém o override seguro do PostCSS", () => {
    expect(pkg.overrides.postcss).toBe("8.5.16")
  })
})
