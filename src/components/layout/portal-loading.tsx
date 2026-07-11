import { Skeleton } from "@/components/ui/skeleton"

export function PortalLoading() {
  return (
    <div
      aria-label="Carregando conteúdo"
      className="mx-auto w-full max-w-[1400px] space-y-10 px-4 py-8 sm:px-6 lg:px-8 lg:py-10"
      role="status"
    >
      <span className="sr-only">Carregando conteúdo do portal.</span>
      <div className="space-y-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-5 border-t border-border/70 pt-8 md:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  )
}
