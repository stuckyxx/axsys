import assert from 'node:assert/strict';
import test from 'node:test';

import type { Contract } from '../types.ts';
import { persistRecoveredContractsSafely } from '../utils/contractRecovery.ts';

const sampleContracts: Contract[] = [
  {
    id: 'contract-1',
    clientId: 'client-1',
    clientName: 'Prefeitura Municipal',
    contractNumber: '001/2026',
    object: 'Locacao de software',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    totalValue: 120000,
    fileUrl: '#',
  },
];

test('persistRecoveredContractsSafely retorna os contratos mesmo quando o cache local falha', () => {
  const recovered = persistRecoveredContractsSafely(
    sampleContracts,
    () => {
      throw new Error('QuotaExceededError');
    },
  );

  assert.deepEqual(recovered, sampleContracts);
});

test('persistRecoveredContractsSafely grava no cache quando a persistencia local funciona', () => {
  let persistedPayload: Contract[] | null = null;

  const recovered = persistRecoveredContractsSafely(sampleContracts, (contracts) => {
    persistedPayload = contracts;
  });

  assert.deepEqual(recovered, sampleContracts);
  assert.deepEqual(persistedPayload, sampleContracts);
});
