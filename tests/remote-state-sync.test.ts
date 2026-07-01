import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLocalStorageKeysForRemoteStateRow,
  getRelevantRemoteStateKeys,
} from '../utils/remoteStateSync.ts';

test('getRelevantRemoteStateKeys inclui chaves globais, escopadas da empresa e legadas da empresa', () => {
  const keys = getRelevantRemoteStateKeys({ companyId: 'comp-001' });

  assert.equal(keys.includes('axsys_users_db_v3'), true);
  assert.equal(keys.includes('axsys_companies_db_v2'), true);
  assert.equal(keys.includes('company:comp-001:axsys_certificates_db_v2'), true);
  assert.equal(keys.includes('axsys_certificates_db_v2'), true);
});

test('getRelevantRemoteStateKeys limita escopo anonimo a chaves globais', () => {
  const keys = getRelevantRemoteStateKeys(null);

  assert.deepEqual(keys, ['axsys_users_db_v3', 'axsys_companies_db_v2']);
});

test('getLocalStorageKeysForRemoteStateRow espelha chave legada da empresa para a chave escopada atual', () => {
  assert.deepEqual(
    getLocalStorageKeysForRemoteStateRow('axsys_certificates_db_v2', { companyId: 'comp-001' }),
    ['axsys_certificates_db_v2', 'company:comp-001:axsys_certificates_db_v2'],
  );
});

test('getLocalStorageKeysForRemoteStateRow preserva chave escopada valida sem duplicar destinos', () => {
  assert.deepEqual(
    getLocalStorageKeysForRemoteStateRow('company:comp-001:axsys_certificates_db_v2', { companyId: 'comp-001' }),
    ['company:comp-001:axsys_certificates_db_v2'],
  );
});
