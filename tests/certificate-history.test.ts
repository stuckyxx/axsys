import assert from 'node:assert/strict';
import test from 'node:test';

import type { Certificate } from '../types.ts';
import { buildCertificateCollections } from '../utils/certificateHistory.ts';

const makeCertificate = (
  id: string,
  name: string,
  validUntil: string,
  createdAt: string,
): Certificate => ({
  id,
  name,
  validUntil,
  fileUrl: `data:application/pdf;base64,${id}`,
  createdAt,
});

test('buildCertificateCollections mantém somente a vigente mais recente por tipo na visão atual', () => {
  const certificates: Certificate[] = [
    makeCertificate('fed-old', 'Certidão Federal', '2026-12-31', '2026-06-01T10:00:00.000Z'),
    makeCertificate('fed-current', 'Certidão Federal', '2026-09-30', '2026-06-10T10:00:00.000Z'),
    makeCertificate('municipal-current', 'Certidão Municipal', '2026-08-15', '2026-06-08T10:00:00.000Z'),
    makeCertificate('trabalhista-expired', 'Certidão Trabalhista', '2026-05-01', '2026-06-09T10:00:00.000Z'),
  ];

  const result = buildCertificateCollections(certificates, new Date('2026-06-20T12:00:00.000Z'));

  assert.deepEqual(result.current.map((certificate) => certificate.id), ['fed-current', 'municipal-current']);
  assert.deepEqual(
    result.relevant.map((certificate) => certificate.id),
    ['fed-current', 'trabalhista-expired', 'municipal-current'],
  );
  assert.deepEqual(
    result.history.map((certificate) => certificate.id),
    ['trabalhista-expired', 'fed-old'],
  );
  assert.deepEqual(result.expired.map((certificate) => certificate.id), ['trabalhista-expired']);
});
