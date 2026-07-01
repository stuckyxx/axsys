import assert from 'node:assert/strict';
import test from 'node:test';

import type { Certificate } from '../types.ts';
import { evaluatePaymentRequestCertificates } from '../utils/paymentFormalization.ts';

const validCertificate = (name: string, validUntil: string): Certificate => ({
  id: `${name}-${validUntil}`,
  name,
  validUntil,
  fileUrl: 'data:application/pdf;base64,TEST',
});

test('evaluatePaymentRequestCertificates identifica certidões vencidas e ausentes', () => {
  const certificates = [
    validCertificate('Certidão Federal', '2025-01-10'),
    validCertificate('Certidão Trabalhista', '2027-01-10'),
  ];

  const result = evaluatePaymentRequestCertificates(certificates, new Date('2026-06-17T12:00:00Z'));

  assert.deepEqual(result.expiredCertificates.map((item) => item.name), ['Certidão Federal']);
  assert.equal(result.missingCertificates.includes('Certificado de Regularidade do FGTS'), true);
  assert.equal(result.missingCertificates.includes('Certidão Municipal'), true);
});

test('evaluatePaymentRequestCertificates não marca pendências quando todas as obrigatórias estão válidas', () => {
  const certificates: Certificate[] = [
    validCertificate('Certidão Federal', '2027-01-10'),
    {
      ...validCertificate('Certidão Federal', '2025-01-10'),
      id: 'historical-expired-federal',
      createdAt: '2026-01-10T10:00:00.000Z',
    },
    validCertificate('Certidão Trabalhista', '2027-01-10'),
    validCertificate('Certificado de Regularidade do FGTS', '2027-01-10'),
    validCertificate('Certidão Estadual (Débitos)', '2027-01-10'),
    validCertificate('Certidão Estadual (Dívida Ativa)', '2027-01-10'),
    validCertificate('Certidão Municipal', '2027-01-10'),
  ];

  const result = evaluatePaymentRequestCertificates(certificates, new Date('2026-06-17T12:00:00Z'));

  assert.deepEqual(result.expiredCertificates, []);
  assert.deepEqual(result.missingCertificates, []);
});
