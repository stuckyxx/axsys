import { Skeleton } from "@/components/ui/skeleton"

export default function CompaniesLoading() {
  return <div aria-label="Carregando empresas" aria-busy="true" className="space-y-6"><div className="space-y-3 border-b border-border/70 pb-6"><Skeleton className="h-3 w-24" /><Skeleton className="h-9 w-52" /><Skeleton className="h-5 w-full max-w-md" /></div><div className="overflow-hidden rounded-2xl border">{Array.from({ length: 5 }, (_, index) => <div className="grid grid-cols-[1fr_10rem] gap-4 border-b p-5 last:border-0" key={index}><div className="space-y-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-3 w-1/2" /></div><Skeleton className="h-7 w-20 justify-self-end" /></div>)}</div></div>
}
