import { randomUUID } from "node:crypto"

import {
  getUploadRetirementDependencies,
  retireUploadAuthorizations,
} from "@/modules/files/server/expired-upload-cleaner"

const BATCH_LIMIT = 50
const MAX_BATCHES = 100

async function main(): Promise<void> {
  process.loadEnvFile(".env.local")
  const dependencies = getUploadRetirementDependencies()
  const totals = {
    batches: 0,
    claimed: 0,
    retired: 0,
    releasedClaims: 0,
    cancelledReserved: 0,
    releasedBytes: 0,
  }

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const result = await retireUploadAuthorizations(dependencies, {
      workerId: randomUUID(),
      limit: BATCH_LIMIT,
    })
    totals.batches += 1
    totals.claimed += result.claimed
    totals.retired += result.retired
    totals.releasedClaims += result.releasedClaims
    totals.cancelledReserved += result.cancelledReserved
    totals.releasedBytes += result.releasedBytes
    if (
      result.claimed < BATCH_LIMIT &&
      result.cancelledReserved < BATCH_LIMIT
    ) {
      break
    }
  }

  process.stdout.write(`${JSON.stringify(totals)}\n`)
}

void main().catch(() => {
  process.stderr.write("File cleanup failed.\n")
  process.exitCode = 1
})
