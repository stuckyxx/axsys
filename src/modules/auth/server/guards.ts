import "server-only"

import { redirect } from "next/navigation"

import { ApiError } from "@/lib/http/api-error"
import type {
  AccessContext,
  ModuleKey,
} from "@/modules/auth/domain/access-context"
import {
  getAccessContext,
  getCompanyApiAccessContext,
} from "@/modules/auth/server/get-access-context"

const MAX_RECENT_AUTHENTICATION_AGE_SECONDS = 600
const AUTHENTICATION_CLOCK_SKEW_SECONDS = 60

function reauthenticationRequired(): ApiError {
  return new ApiError(
    "REAUTHENTICATION_REQUIRED",
    403,
    "Confirme sua senha novamente para continuar.",
  )
}

function moduleForbidden(): ApiError {
  return new ApiError("MODULE_FORBIDDEN", 403, "Módulo não autorizado.")
}

function companyArchived(): ApiError {
  return new ApiError("COMPANY_ARCHIVED", 403, "Empresa arquivada.")
}

export async function requireAccessContext(): Promise<AccessContext> {
  const resolution = await getAccessContext()
  if (resolution.status === "anonymous") {
    redirect("/login")
  }
  if (resolution.status === "password_change") {
    redirect("/change-password")
  }

  return resolution.context
}

export async function requirePlatformContext() {
  const context = await requireAccessContext()
  if (context.kind === "company") {
    redirect("/app/dashboard")
  }

  return context
}

export async function requirePlatformApiContext() {
  const resolution = await getAccessContext()
  if (resolution.status === "anonymous") {
    throw new ApiError("AUTH_REQUIRED", 401, "Faça login para continuar.")
  }
  if (resolution.status === "password_change") {
    throw new ApiError(
      "PASSWORD_CHANGE_REQUIRED",
      403,
      "Altere sua senha provisória para continuar.",
    )
  }
  if (resolution.context.kind !== "platform") {
    throw new ApiError("PLATFORM_FORBIDDEN", 403, "Operação não autorizada.")
  }
  return resolution.context
}

export async function requireCompanyContext(requiredModule?: ModuleKey) {
  const context = await requireAccessContext()
  if (context.kind === "platform") {
    redirect("/platform")
  }
  if (requiredModule && !context.modules.includes(requiredModule)) {
    throw moduleForbidden()
  }

  return context
}

export async function requireCompanyApiContext(requiredModule?: ModuleKey) {
  const resolution = await getCompanyApiAccessContext()
  if (resolution.status === "anonymous") {
    throw new ApiError("AUTH_REQUIRED", 401, "Faça login para continuar.")
  }
  if (resolution.status === "password_change") {
    throw new ApiError(
      "PASSWORD_CHANGE_REQUIRED",
      403,
      "Altere sua senha provisória para continuar.",
    )
  }
  if (resolution.status === "company_inactive") {
    throw companyArchived()
  }
  if (resolution.context.kind !== "company") {
    throw new ApiError("COMPANY_FORBIDDEN", 403, "Operação não autorizada.")
  }
  if (requiredModule && !resolution.context.modules.includes(requiredModule)) {
    throw moduleForbidden()
  }

  return resolution.context
}

export function requireRecentAuthentication(
  context: AccessContext,
  maxAgeSeconds = MAX_RECENT_AUTHENTICATION_AGE_SECONDS,
): void {
  const nowSeconds = Math.floor(Date.now() / 1_000)
  if (
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds <= 0 ||
    !Number.isSafeInteger(maxAgeSeconds) ||
    maxAgeSeconds <= 0 ||
    maxAgeSeconds > MAX_RECENT_AUTHENTICATION_AGE_SECONDS ||
    !Number.isSafeInteger(context.authenticatedAt) ||
    context.authenticatedAt <= 0 ||
    context.authenticatedAt > nowSeconds + AUTHENTICATION_CLOCK_SKEW_SECONDS
  ) {
    throw reauthenticationRequired()
  }

  const effectiveAuthenticatedAt = Math.min(
    context.authenticatedAt,
    nowSeconds,
  )
  if (nowSeconds - effectiveAuthenticatedAt > maxAgeSeconds) {
    throw reauthenticationRequired()
  }
}
