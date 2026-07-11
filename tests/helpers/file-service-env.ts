import { Buffer } from "node:buffer"

export const TEST_FILE_SERVICE_ENV = Object.freeze({
  CLAMAV_HOST: "127.0.0.1",
  CLAMAV_PORT: "3310",
  SUPABASE_STORAGE_TUS_ENDPOINT:
    "http://127.0.0.1:54321/storage/v1/upload/resumable",
  BANK_ACCOUNT_ENCRYPTION_KEY_V1_BASE64: Buffer.alloc(32, 1).toString("base64"),
  PII_ENCRYPTION_KEY_V1_BASE64: Buffer.alloc(32, 2).toString("base64"),
})
