import type { ReactNode } from "react"

import { Toaster } from "@/components/ui/sonner"
import { PublicDarkBoundary } from "@/lib/theme/public-dark-boundary"

export default function PublicLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="dark min-h-dvh bg-background text-foreground">
      <PublicDarkBoundary />
      {children}
      <Toaster theme="dark" />
    </div>
  )
}
