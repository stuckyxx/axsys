import { Skeleton } from "@/components/ui/skeleton"

export default function PlatformHealthLoading() {
  return <div aria-label="Carregando saúde da plataforma" className="space-y-8"><div className="space-y-3 border-b border-border pb-7"><Skeleton className="h-3 w-24" /><Skeleton className="h-10 w-72 max-w-full" /><Skeleton className="h-4 w-full max-w-xl" /></div><div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /></div><Skeleton className="h-72 rounded-2xl" /></div>
}
