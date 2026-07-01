import assert from 'node:assert/strict';
import test from 'node:test';

import type { Certificate } from '../types.ts';
import { persistRecoveredCertificatesSafely } from '../utils/certificateRecovery.ts';

const sampleCertificates: Certificate[] = [
  {
    id: 'cert-1',
    name: 'Certidão Federal',
    validUntil: '2026-06-30',
    fileUrl: 'data:application/pdf;base64,AAA',
  },
];

test('persistRecoveredCertificatesSafely retorna as certidões mesmo quando o cache local falha', () => {
  const recovered = persistRecoveredCertificatesSafely(
    sampleCertificates,
    () => {
      throw new Error('QuotaExceededError');
    },
  );

  assert.deepEqual(recovered, sampleCertificates);
});

test('persistRecoveredCertificatesSafely grava no cache quando a persistência local funciona', () => {
  let persistedPayload: Certificate[] | null = null;

  const recovered = persistRecoveredCertificatesSafely(sampleCertificates, (certificates) => {
    persistedPayload = certificates;
  });

  assert.deepEqual(recovered, sampleCertificates);
  assert.deepEqual(persistedPayload, sampleCertificates);
});
