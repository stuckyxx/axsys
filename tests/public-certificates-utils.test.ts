import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPublicCertificatesUrl,
  formatCertificateDate,
  getCertificateStatus,
  splitPublicCertificates,
} from '../utils/publicCertificates.ts';

test('getCertificateStatus trata a data de vencimento como válida até o fim do dia', () => {
  assert.equal(getCertificateStatus('2099-12-31'), 'valid');
  assert.equal(getCertificateStatus('2000-01-01'), 'expired');
});

test('splitPublicCertificates separa válidas e vencidas preservando válidas primeiro', () => {
  const result = splitPublicCertificates([
    { id: '1', name: 'Vencida', validUntil: '2000-01-01', fileUrl: 'file-a' },
    { id: '2', name: 'Valida', validUntil: '2099-12-31', fileUrl: 'file-b' },
  ]);

  assert.deepEqual(result.valid.map((certificate) => certificate.id), ['2']);
  assert.deepEqual(result.expired.map((certificate) => certificate.id), ['1']);
});

test('splitPublicCertificates mantém somente a vigente mais recente por tipo na lista principal', () => {
  const result = splitPublicCertificates([
    {
      id: 'federal-antiga',
      name: 'Certidão Federal',
      validUntil: '2099-11-30',
      fileUrl: 'file-a',
      createdAt: '2026-05-01T10:00:00.000Z',
    },
    {
      id: 'federal-atual',
      name: 'Certidão Federal',
      validUntil: '2099-10-30',
      fileUrl: 'file-b',
      createdAt: '2026-06-01T10:00:00.000Z',
    },
  ]);

  assert.deepEqual(result.valid.map((certificate) => certificate.id), ['federal-atual']);
  assert.deepEqual(result.expired.map((certificate) => certificate.id), ['federal-antiga']);
});

test('buildPublicCertificatesUrl usa o slug como endereço principal', () => {
  assert.equal(
    buildPublicCertificatesUrl('https://axsys.app', '/portal/', 'empresa-alpha'),
    'https://axsys.app/portal/#/public/certidoes/empresa-alpha',
  );
});

test('formatCertificateDate converte yyyy-mm-dd para dd/mm/yyyy', () => {
  assert.equal(formatCertificateDate('2026-06-04'), '04/06/2026');
  assert.equal(formatCertificateDate('invalid-date'), 'invalid-date');
});
