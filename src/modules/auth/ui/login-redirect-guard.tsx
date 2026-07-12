"use client"

import { useEffect } from "react"

import { navigateToAuthenticatedPortal } from "@/modules/auth/ui/authenticated-navigation"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function LoginRedirectGuard() {
  useEffect(() => {
    const controller = new AbortController()
    const resolveExistingSession = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        const body = await readJson(response)
        if (controller.signal.aborted || !isRecord(body)) return

        if (response.status === 200) {
          if (body.kind === "platform") {
            navigateToAuthenticatedPortal("/platform")
          } else if (body.kind === "company") {
            navigateToAuthenticatedPortal("/app/dashboard")
          }
          return
        }

        if (
          response.status === 403 &&
          isRecord(body.error) &&
          body.error.code === "PASSWORD_CHANGE_REQUIRED"
        ) {
          navigateToAuthenticatedPortal("/change-password")
        }
      } catch {
        // Availability failures do not prove that a session exists.
      }
    }
    void resolveExistingSession()
    return () => controller.abort()
  }, [])

  return null
}
