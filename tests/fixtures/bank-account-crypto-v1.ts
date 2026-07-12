const envelope = (
  ciphertext: string,
  iv: string,
  tag: string,
) =>
  Object.freeze({
    ciphertext,
    iv,
    tag,
    keyVersion: 1 as const,
  })

/**
 * Reusable encrypted fixture matching the exact Plan 05 bank_snapshot contract.
 * The company ID is fixture scope metadata used to reconstruct the field AAD;
 * it is deliberately outside the persisted snapshot.
 */
export const BANK_ACCOUNT_CRYPTO_V1_FIXTURE = Object.freeze({
  companyId: "11111111-1111-4111-8111-111111111111",
  snapshot: Object.freeze({
    bankAccountId: "22222222-2222-4222-8222-222222222222",
    bankCode: "001",
    bankName: "Banco do Brasil",
    accountType: "checking" as const,
    holderName: "Maria da Silva",
    branch: envelope(
      "R9O6g6U=",
      "AQEBAQEBAQEBAQEB",
      "B0aJ+9AjI8qR1JiDfh36Ww==",
    ),
    branchLast4: "2345",
    account: envelope(
      "I4zeMW7fhg==",
      "AgICAgICAgICAgIC",
      "vyyPOg1YwfyjCI7TwQ3IDA==",
    ),
    accountLast4: "6543",
    holderDocument: envelope(
      "FMyQN28eaXpDcHI=",
      "AwMDAwMDAwMDAwMD",
      "//Ja1HV+2WWjE8MP+ZjGUw==",
    ),
    holderDocumentLast4: "8901",
  }),
})

/** Test-only decryption oracle. Never serialize or persist with the public fixture. */
export const BANK_ACCOUNT_CRYPTO_V1_TEST_ONLY_MATERIAL = Object.freeze({
  keyBase64: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
  plaintext: Object.freeze({
    branch: "12345",
    account: "9876543",
    holderDocument: "12345678901",
  }),
})
