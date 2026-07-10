import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { connection } from "next/server"
import type { ReactNode } from "react"

import { AppProviders } from "@/components/providers/app-providers"

import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: { default: "Axsys", template: "%s | Axsys" },
  description: "Gestão segura para fornecedores e prestadores do setor público.",
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection()

  return (
    <html
      lang="pt-BR"
      className={`dark ${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
