import Image from "next/image"

import { cn } from "@/lib/utils"

type AxsysLogoProps = {
  variant?: "compact" | "horizontal"
  monochrome?: boolean
  className?: string
}

export function AxsysLogo({
  variant = "horizontal",
  monochrome = false,
  className,
}: AxsysLogoProps) {
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
        className="h-8 w-auto"
        height={32}
        priority
        src={
          monochrome
            ? variant === "compact"
              ? "/brand/axsys-mark-monochrome.png"
              : "/brand/axsys-monochrome.png"
            : variant === "compact"
              ? "/brand/axsys-mark.png"
              : "/brand/axsys-wordmark.png"
        }
        width={variant === "compact" ? 32 : 132}
      />
    </span>
  )
}
