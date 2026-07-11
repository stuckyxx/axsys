export type ClientInvalidation = Readonly<{
  resources: readonly string[]
  scope: Readonly<{
    companyId: string | null
    userId: string
  }>
  senderId: string
  type: "invalidate" | "session-ended"
}>

export const INVALIDATION_CHANNEL = "axsys:invalidation:v1"

export function openInvalidationChannel(): BroadcastChannel {
  return new BroadcastChannel(INVALIDATION_CHANNEL)
}
