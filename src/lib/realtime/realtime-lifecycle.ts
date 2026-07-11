type RealtimeLifecycle<Channel> = Readonly<{
  dispose: () => Promise<unknown>
  removeChannel: (channel: Channel) => Promise<unknown>
}>

export async function settleRealtimeCleanup<Channel>(
  lifecycle: RealtimeLifecycle<Channel>,
  channel: Channel,
): Promise<void> {
  try {
    await lifecycle.removeChannel(channel)
  } catch {
    // Optional transport teardown cannot affect the already-unmounted portal.
  }

  try {
    await lifecycle.dispose()
  } catch {
    // Client disposal is best effort and must never create an unhandled rejection.
  }
}
