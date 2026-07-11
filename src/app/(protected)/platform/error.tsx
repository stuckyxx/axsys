"use client"

import { PortalError } from "@/components/layout/portal-error"

export default function PlatformError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return <PortalError error={error} reset={reset} />
}
