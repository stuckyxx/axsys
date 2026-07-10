import "server-only"

export type InvalidationScope = {
  userId: string
  companyId: string | null
}

export type InvalidationEvent = {
  scope: InvalidationScope
  resources: readonly string[]
  correlationId: string
}

export interface ServerInvalidationPublisher {
  publish(event: InvalidationEvent): Promise<void>
}

export const noOpInvalidationPublisher: ServerInvalidationPublisher = {
  async publish() {},
}
