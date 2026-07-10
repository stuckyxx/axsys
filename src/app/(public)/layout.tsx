import type { ReactNode } from "react"

import { Toaster } from "@/components/ui/sonner"

export default function PublicLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="dark min-h-dvh bg-background text-foreground">
      {children}
      <Toaster theme="dark" />
    </div>
  )
}
