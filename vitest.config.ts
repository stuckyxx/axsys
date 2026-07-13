import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    coverage: {
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/components/ui/**", "src/lib/supabase/database.types.ts"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "ui",
          include: ["tests/unit/**/*.{test,spec}.tsx"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        extends: true,
        resolve: {
          alias: {
            "server-only": fileURLToPath(
              new URL("./tests/helpers/server-only.ts", import.meta.url),
            ),
          },
        },
        test: {
          name: "node",
          include: [
            "tests/unit/**/*.{test,spec}.ts",
            "tests/integration/**/*.{test,spec}.{ts,tsx}",
            "tests/contracts/**/*.{test,spec}.ts",
          ],
          environment: "node",
          setupFiles: [],
        },
      },
    ],
  },
})
