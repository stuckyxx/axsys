import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeRecordArraysById,
  mergeRemoteBootstrapCollection,
  shouldMergeRemoteBootstrapKey,
} from '../utils/bootstrapMerge.ts';

test('mergeRecordArraysById preserva remotos e sobrescreve conflitos locais', () => {
  const merged = mergeRecordArraysById(
    [
      { id: 'u-admin', name: 'Admin Remoto' },
      { id: 'u-gabriel', name: 'Gabriel Remoto' },
    ],
    [
      { id: 'u-gabriel', name: 'Gabriel Local' },
      { id: 'u-thilia', name: 'Thilia Local' },
    ],
  );

  assert.deepEqual(merged, [
    { id: 'u-admin', name: 'Admin Remoto' },
    { id: 'u-gabriel', name: 'Gabriel Local' },
    { id: 'u-thilia', name: 'Thilia Local' },
  ]);
});

test('mergeRemoteBootstrapCollection retorna merge e sinaliza ressync quando o local traz registros novos', () => {
  const result = mergeRemoteBootstrapCollection(
    [
      { id: 'comp-001', corporateName: 'Empresa Remota' },
    ],
    JSON.stringify([
      { id: 'comp-001', corporateName: 'Empresa Local' },
      { id: 'comp-002', corporateName: 'Assesi Local' },
    ]),
  );

  assert.ok(result);
  assert.equal(result?.shouldSync, true);
  assert.deepEqual(result?.mergedValue, [
    { id: 'comp-001', corporateName: 'Empresa Local' },
    { id: 'comp-002', corporateName: 'Assesi Local' },
  ]);
});

test('mergeRemoteBootstrapCollection ignora payloads não mergeáveis', () => {
  assert.equal(mergeRemoteBootstrapCollection({ id: 'x' }, JSON.stringify([{ id: 'x' }])), null);
  assert.equal(mergeRemoteBootstrapCollection([{ id: 'x' }], '{"id":"x"}'), null);
});

test('shouldMergeRemoteBootstrapKey cobre coleções globais e chaves escopadas por empresa', () => {
  assert.equal(shouldMergeRemoteBootstrapKey('axsys_users_db_v3'), true);
  assert.equal(shouldMergeRemoteBootstrapKey('company:global:axsys_contracts_db_v2'), true);
  assert.equal(shouldMergeRemoteBootstrapKey('company:comp-001:axsys_certificates_db_v2'), true);
  assert.equal(shouldMergeRemoteBootstrapKey('sgi_user_v2'), false);
});
