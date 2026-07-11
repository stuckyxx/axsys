import Image from "next/image"

import { cn } from "@/lib/utils"

type AxsysLogoProps = {
  variant?: "compact" | "horizontal"
  monochrome?: boolean
  preload?: boolean
  className?: string
}

export function AxsysLogo({
  variant = "horizontal",
  monochrome = false,
  preload = false,
  className,
}: AxsysLogoProps) {
  const compact = variant === "compact"

  return (
    <span
      aria-label="Axsys"
      className={cn("inline-flex items-center gap-2.5", className)}
      data-monochrome={String(monochrome)}
      data-variant={variant}
      role="img"
    >
      <Image
        alt=""
        className={compact ? "size-8" : "h-auto w-[132px]"}
        height={compact ? 1254 : 809}
        preload={preload}
        sizes={compact ? "32px" : "132px"}
        src={
          monochrome
            ? compact
              ? "/brand/axsys-mark-monochrome.png"
              : "/brand/axsys-monochrome.png"
            : compact
              ? "/brand/axsys-mark.png"
              : "/brand/axsys-wordmark.png"
        }
        width={compact ? 1254 : 1942}
      />
    </span>
  )
}
