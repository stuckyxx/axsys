import "server-only"

import { cookies } from "next/headers"

import { bffDb } from "@/lib/db/bff"
import { ApiError } from "@/lib/http/api-error"
import { createServerSupabase } from "@/lib/supabase/server"
import { z } from "@/lib/validation/zod"
import { changePasswordSchema } from "@/modules/auth/schemas/auth-schemas"
import { getAccessContext } from "@/modules/auth/server/get-access-context"
import { validatePassword } from "@/modules/auth/server/password-policy"

const AUTH_COOKIE_NAME =
  /^sb-[A-Za-z0-9._-]+-auth-token(?:-code-verifier)?(?:\.[0-9]+)?$/u

const claimsSchema = z.object({
  sub: z.uuid(),
  session_id: z.uuid(),
  is_anonymous: z.boolean().optional(),
})

type ChangeTemporaryPasswordInput = z.input<typeof changePasswordSchema>

function authenticationRequired(): ApiError {
  return new ApiError("AUTH_REQUIRED", 401, "Faça login para continuar.")
}

async function clearAuthenticationCookies(): Promise<void> {
  try {
    const store = await cookies()
    for (const cookie of store.getAll()) {
      if (AUTH_COOKIE_NAME.test(cookie.name)) store.delete(cookie.name)
    }
  } catch {
    // Database session revocation remains authoritative.
  }
}

async function globalSignOut(
  client: Awaited<ReturnType<typeof createServerSupabase>>,
): Promise<boolean> {
  let succeeded = false
  try {
    const result = await client.auth.signOut({ scope: "global" })
    succeeded = result.error === null
  } catch {
    succeeded = false
  }
  await clearAuthenticationCookies()
  return succeeded
}

function retryRequired(): ApiError {
  return new ApiError(
    "PASSWORD_CHANGE_RETRY_REQUIRED",
    503,
    "Não foi possível concluir a troca. Entre novamente e tente de novo.",
  )
}

export async function changeTemporaryPassword(
  input: ChangeTemporaryPasswordInput,
  correlationId: string,
): Promise<Readonly<{ redirectTo: "/login" }>> {
  const parsedInput = changePasswordSchema.parse(input)
  const client = await createServerSupabase()
  const claimsResult = await client.auth.getClaims()
  const claims = claimsSchema.safeParse(claimsResult.data?.claims)
  if (
    claimsResult.error !== null ||
    !claims.success ||
    claims.data.is_anonymous === true
  ) {
    throw authenticationRequired()
  }

  const resolution = await getAccessContext()
  if (resolution.status === "anonymous") throw authenticationRequired()
  if (resolution.status === "authenticated") {
    throw new ApiError(
      "PASSWORD_CHANGE_NOT_REQUIRED",
      403,
      "A troca de senha provisória não está disponível.",
    )
  }
  if (resolution.userId !== claims.data.sub) throw authenticationRequired()
  if (resolution.expired) {
    throw new ApiError(
      "TEMPORARY_PASSWORD_EXPIRED",
      403,
      "A senha provisória expirou. Solicite uma nova senha.",
    )
  }

  await validatePassword(parsedInput.password)
  try {
    const result = await client.auth.updateUser({
      password: parsedInput.password,
    })
    if (result.error !== null) throw new Error("Auth update unavailable")
  } catch {
    throw new ApiError(
      "PASSWORD_CHANGE_FAILED",
      503,
      "Não foi possível alterar a senha. Tente novamente.",
    )
  }

  try {
    await bffDb.completeTemporaryPasswordChange({
      actorUserId: claims.data.sub,
      sessionId: claims.data.session_id,
      correlationId,
    })
  } catch {
    await globalSignOut(client)
    throw retryRequired()
  }

  if (!(await globalSignOut(client))) throw retryRequired()
  return Object.freeze({ redirectTo: "/login" })
}
