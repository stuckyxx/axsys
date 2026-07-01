import assert from 'node:assert/strict';
import test from 'node:test';

import type { Certificate } from '../types.ts';
import { selectCertificateSnapshot } from '../utils/certificateSnapshots.ts';

const makeCertificates = (validUntil: string): Certificate[] => [
  {
    id: 'cert-1',
    name: 'Certidão Federal',
    validUntil,
    fileUrl: 'data:application/pdf;base64,AAA',
  },
];

test('selectCertificateSnapshot prioriza a empresa do usuario quando existe snapshot escopado', () => {
  const selected = selectCertificateSnapshot({
    scopedKey: 'company:comp-001:axsys_certificates_db_v2',
    globalScopedKey: 'company:global:axsys_certificates_db_v2',
    snapshots: [
      {
        key: 'company:global:axsys_certificates_db_v2',
        updatedAt: '2026-06-17T00:59:28.867Z',
        certificates: makeCertificates('2026-06-03'),
      },
      {
        key: 'company:comp-001:axsys_certificates_db_v2',
        updatedAt: '2026-06-08T13:35:12.442Z',
        certificates: makeCertificates('2026-12-02'),
      },
    ],
  });

  assert.equal(selected?.key, 'company:comp-001:axsys_certificates_db_v2');
  assert.deepEqual(selected?.certificates, makeCertificates('2026-12-02'));
});

test('selectCertificateSnapshot usa company:global quando o snapshot da empresa estiver vazio', () => {
  const selected = selectCertificateSnapshot({
    scopedKey: 'company:comp-001:axsys_certificates_db_v2',
    globalScopedKey: 'company:global:axsys_certificates_db_v2',
    snapshots: [
      {
        key: 'company:comp-001:axsys_certificates_db_v2',
        updatedAt: '2026-06-08T13:35:12.442Z',
        certificates: [],
      },
      {
        key: 'company:global:axsys_certificates_db_v2',
        updatedAt: '2026-06-17T00:59:28.867Z',
        certificates: makeCertificates('2026-06-22'),
      },
    ],
  });

  assert.equal(selected?.key, 'company:global:axsys_certificates_db_v2');
  assert.deepEqual(selected?.certificates, makeCertificates('2026-06-22'));
});
