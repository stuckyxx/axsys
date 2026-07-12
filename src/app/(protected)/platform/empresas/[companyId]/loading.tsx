import { Skeleton } from "@/components/ui/skeleton"

export default function CompanyDetailLoading() {
  return <div aria-label="Carregando empresa" aria-busy="true" className="space-y-8"><div className="space-y-3 border-b pb-7"><Skeleton className="h-3 w-20" /><Skeleton className="h-10 w-72 max-w-full" /><Skeleton className="h-4 w-96 max-w-full" /></div><div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-48 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /></div></div>
}
