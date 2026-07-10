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

  it("fixa Supabase CLI e npm", () => {
    expect(pkg.devDependencies.supabase).toBe("2.109.1")
    expect(pkg.packageManager).toBe("npm@11.6.2")
  })

  it("mantém o override seguro do PostCSS", () => {
    expect(pkg.overrides.postcss).toBe("8.5.16")
  })
})
