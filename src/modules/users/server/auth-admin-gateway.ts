import "server-only"

import { getAdminSupabase } from "@/lib/supabase/admin"

export type AuthAdminGateway = Readonly<{
  createUser(input: {
    email: string
    password: string
    emailConfirm: true
  }): Promise<{ id: string }>
  banUser(userId: string): Promise<void>
  unbanUser(userId: string): Promise<void>
  deleteUser(userId: string): Promise<void>
}>

type AuthAdminClient = Readonly<{
  createUser(input: {
    email: string
    password: string
    email_confirm: true
  }): Promise<{
    data: { user: { id: string } | null }
    error: unknown | null
  }>
  updateUserById(
    userId: string,
    attributes: { ban_duration: "876000h" | "none" },
  ): Promise<{ error: unknown | null }>
  deleteUser(
    userId: string,
    shouldSoftDelete: false,
  ): Promise<{ error: unknown | null }>
}>

const AUTH_ADMIN_FAILURE = "Auth administration unavailable"

function assertSuccess(error: unknown | null): void {
  if (error !== null) throw new Error(AUTH_ADMIN_FAILURE)
}

export function createAuthAdminGateway(
  admin: AuthAdminClient,
): AuthAdminGateway {
  return Object.freeze({
    async createUser(input) {
      const result = await admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: input.emailConfirm,
      })
      assertSuccess(result.error)
      if (result.data.user === null) throw new Error(AUTH_ADMIN_FAILURE)
      return { id: result.data.user.id }
    },

    async banUser(userId) {
      const result = await admin.updateUserById(userId, {
        ban_duration: "876000h",
      })
      assertSuccess(result.error)
    },

    async unbanUser(userId) {
      const result = await admin.updateUserById(userId, {
        ban_duration: "none",
      })
      assertSuccess(result.error)
    },

    async deleteUser(userId) {
      const result = await admin.deleteUser(userId, false)
      assertSuccess(result.error)
    },
  })
}

export function getAuthAdminGateway(): AuthAdminGateway {
  return createAuthAdminGateway(getAdminSupabase().auth.admin)
}
