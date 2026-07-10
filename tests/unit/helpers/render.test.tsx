import {
  QueryClientProvider,
  type QueryClient,
  useQueryClient,
} from "@tanstack/react-query"
import type { RenderOptions } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, expectTypeOf, it } from "vitest"

import { createTestQueryClient } from "../../helpers/query-client"
import { renderWithProviders } from "../../helpers/render"

type ProviderRenderOptions = NonNullable<Parameters<typeof renderWithProviders>[1]>

describe("renderWithProviders", () => {
  it("does not expose the mandatory wrapper as a caller option", () => {
    type HasWrapper = "wrapper" extends keyof ProviderRenderOptions ? true : false

    expectTypeOf<HasWrapper>().toEqualTypeOf<false>()
  })

  it("keeps its own QueryClient when an untyped caller supplies a wrapper", () => {
    const replacementClient = createTestQueryClient()
    let observedClient: QueryClient | undefined

    function QueryClientProbe() {
      observedClient = useQueryClient()
      return null
    }

    const unsafeOptions = {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={replacementClient}>{children}</QueryClientProvider>
      ),
    } as unknown as Omit<RenderOptions, "wrapper">

    const { queryClient } = renderWithProviders(<QueryClientProbe />, unsafeOptions)

    expect(observedClient).toBe(queryClient)
    expect(observedClient).not.toBe(replacementClient)
  })
})
