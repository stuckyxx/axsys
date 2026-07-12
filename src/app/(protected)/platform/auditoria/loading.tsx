import { Skeleton } from "@/components/ui/skeleton"

export default function PlatformAuditLoading() {
  return <div aria-label="Carregando auditoria" className="space-y-7"><div className="space-y-3 border-b border-border pb-7"><Skeleton className="h-3 w-32" /><Skeleton className="h-10 w-72 max-w-full" /><Skeleton className="h-4 w-full max-w-xl" /></div><Skeleton className="h-24 w-full rounded-2xl" /><Skeleton className="h-80 w-full rounded-2xl" /></div>
}
