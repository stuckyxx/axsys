"use client"

import { useEffect, useLayoutEffect } from "react"

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

export function PublicDarkBoundary() {
  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement
    const hadDark = root.classList.contains("dark")
    const hadLight = root.classList.contains("light")
    const colorScheme = root.style.colorScheme

    root.classList.remove("light")
    root.classList.add("dark")
    root.style.colorScheme = "dark"

    return () => {
      root.classList.toggle("dark", hadDark)
      root.classList.toggle("light", hadLight)
      root.style.colorScheme = colorScheme
    }
  }, [])

  return null
}
