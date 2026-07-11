"use client"

import type { ComponentType, ReactNode } from "react"
import { useState } from "react"
import { ListIcon, SidebarSimpleIcon, XIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { AxsysLogo } from "@/components/brand/axsys-logo"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

type NavigationIcon = ComponentType<{
  "aria-hidden"?: boolean
  className?: string
  weight?: "bold" | "duotone" | "fill" | "light" | "regular" | "thin"
}>

export type NavigationItem = Readonly<{
  href: string
  icon: NavigationIcon
  label: string
}>

type ResponsiveNavigationProps = Readonly<{
  children: ReactNode
  displayName: string
  email: string
  items: readonly NavigationItem[]
  portalLabel: "empresa" | "plataforma"
  utility?: ReactNode
}>

export function ResponsiveNavigation({
  children,
  displayName,
  email,
  items,
  portalLabel,
  utility,
}: ResponsiveNavigationProps) {
  const pathname = usePathname()
  const [railExpanded, setRailExpanded] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const navigationLinks = (showLabels: boolean, onNavigate?: () => void) =>
    items.map(({ href, icon: Icon, label }) => {
      const active =
        pathname === href || (href !== "/platform" && pathname.startsWith(`${href}/`))

      return (
        <Link
          aria-current={active ? "page" : undefined}
          aria-label={showLabels ? undefined : label}
          className={cn(
            "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px",
            active && "bg-secondary text-secondary-foreground",
            !showLabels && "justify-center px-0",
          )}
          href={href}
          key={href}
          onClick={onNavigate}
          prefetch={false}
          title={showLabels ? undefined : label}
        >
          <Icon aria-hidden className="size-5 shrink-0" weight={active ? "duotone" : "regular"} />
          {showLabels ? <span>{label}</span> : null}
        </Link>
      )
    })

  return (
    <div className="min-h-dvh bg-background sm:grid sm:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[17.5rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-border/80 bg-card/60 lg:flex lg:min-h-dvh lg:flex-col">
        <div className="flex h-20 items-center border-b border-border/70 px-6">
          <AxsysLogo variant="horizontal" preload />
        </div>
        <nav aria-label={`Navegação da ${portalLabel}`} className="flex flex-1 flex-col gap-1 p-4">
          {navigationLinks(true)}
        </nav>
        <div className="border-t border-border/70 p-4">
          <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{email}</p>
        </div>
      </aside>

      <aside
        className={cn(
          "hidden min-h-dvh flex-col border-r border-border/80 bg-card/60 transition-[width] sm:flex lg:hidden",
          railExpanded ? "w-64" : "w-[4.75rem]",
        )}
      >
        <div className={cn("flex h-20 items-center border-b border-border/70", railExpanded ? "justify-between px-4" : "justify-center")}>
          {railExpanded ? <AxsysLogo variant="horizontal" /> : <AxsysLogo variant="compact" />}
          <Button
            aria-label={railExpanded ? "Recolher navegação" : "Expandir navegação"}
            aria-expanded={railExpanded}
            className="size-11"
            onClick={() => setRailExpanded((current) => !current)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <SidebarSimpleIcon aria-hidden className="size-5" weight="bold" />
          </Button>
        </div>
        <nav
          aria-label={`Navegação compacta da ${portalLabel}`}
          className="flex flex-1 flex-col gap-1 p-3"
        >
          {navigationLinks(railExpanded)}
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-border/80 bg-background/95 px-4 supports-backdrop-filter:backdrop-blur-md sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  aria-label="Abrir menu"
                  className="size-11 sm:hidden"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <ListIcon aria-hidden className="size-5" weight="bold" />
                </Button>
              </SheetTrigger>
              <SheetContent
                className="max-h-dvh min-h-0 w-[min(88vw,22rem)] overflow-hidden"
                showCloseButton={false}
                side="left"
              >
                <SheetHeader className="relative shrink-0 border-b border-border/70 px-5 py-5 pr-16">
                  <AxsysLogo variant="horizontal" />
                  <SheetTitle className="sr-only">Menu do portal</SheetTitle>
                  <SheetDescription className="sr-only">
                    Navegue pelas áreas disponíveis do portal.
                  </SheetDescription>
                  <SheetClose asChild>
                    <Button
                      aria-label="Fechar menu"
                      className="absolute right-3 top-3 size-11"
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <XIcon aria-hidden className="size-5" weight="bold" />
                    </Button>
                  </SheetClose>
                </SheetHeader>
                <nav aria-label={`Menu móvel da ${portalLabel}`} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-3 py-2">
                  {navigationLinks(true, () => setMobileOpen(false))}
                </nav>
                <div className="shrink-0 border-t border-border/70 p-5">
                  <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{email}</p>
                </div>
              </SheetContent>
            </Sheet>
            <div className="sm:hidden">
              <AxsysLogo variant="compact" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">Portal da {portalLabel}</p>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">{displayName}</p>
            </div>
          </div>
          {utility ? <div className="flex items-center gap-2">{utility}</div> : null}
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  )
}
