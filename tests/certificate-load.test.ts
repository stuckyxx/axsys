import assert from 'node:assert/strict';
import test from 'node:test';

import type { Certificate } from '../types.ts';
import { resolveCertificatesForLoad } from '../utils/certificateLoad.ts';

const localCertificates: Certificate[] = [
  {
    id: 'cert-1',
    name: 'Certidão Federal',
    validUntil: '2026-06-15',
    fileUrl: 'data:application/pdf;base64,OLD',
  },
];

const remoteCertificates: Certificate[] = [
  {
    id: 'cert-1',
    name: 'Certidão Federal',
    validUntil: '2026-07-15',
    fileUrl: 'data:application/pdf;base64,NEW',
  },
];

test('resolveCertificatesForLoad prioriza remoto quando a tela pede refresh mesmo com cache local preenchido', async () => {
  const recovered = await resolveCertificatesForLoad({
    localCertificates,
    preferRemote: true,
    recoverRemote: async () => remoteCertificates,
  });

  assert.deepEqual(recovered, remoteCertificates);
});

test('resolveCertificatesForLoad preserva cache local quando refresh remoto nao retorna nada', async () => {
  const recovered = await resolveCertificatesForLoad({
    localCertificates,
    preferRemote: true,
    recoverRemote: async () => [],
  });

  assert.deepEqual(recovered, localCertificates);
});
