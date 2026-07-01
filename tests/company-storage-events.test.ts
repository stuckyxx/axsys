import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesCompanyStorageUpdate } from '../utils/companyStorageEvents.ts';

test('matchesCompanyStorageUpdate aceita chave base da empresa ativa', () => {
  assert.equal(
    matchesCompanyStorageUpdate({
      detail: {
        key: 'axsys_contracts_db_v2',
        scopedKey: 'company:comp-001:axsys_contracts_db_v2',
        companyId: 'comp-001',
      },
      trackedKeys: ['axsys_contracts_db_v2'],
      companyId: 'comp-001',
    }),
    true,
  );
});

test('matchesCompanyStorageUpdate aceita chave escopada quando a tela observa essa chave', () => {
  assert.equal(
    matchesCompanyStorageUpdate({
      detail: {
        key: 'axsys_contracts_db_v2',
        scopedKey: 'company:comp-001:axsys_contracts_db_v2',
        companyId: 'comp-001',
      },
      trackedKeys: ['company:comp-001:axsys_contracts_db_v2'],
      companyId: 'comp-001',
    }),
    true,
  );
});

test('matchesCompanyStorageUpdate ignora evento de outra empresa', () => {
  assert.equal(
    matchesCompanyStorageUpdate({
      detail: {
        key: 'axsys_contracts_db_v2',
        scopedKey: 'company:comp-002:axsys_contracts_db_v2',
        companyId: 'comp-002',
      },
      trackedKeys: ['axsys_contracts_db_v2'],
      companyId: 'comp-001',
    }),
    false,
  );
});

test('matchesCompanyStorageUpdate ignora chaves nao observadas', () => {
  assert.equal(
    matchesCompanyStorageUpdate({
      detail: {
        key: 'axsys_income_db_v2',
        scopedKey: 'company:comp-001:axsys_income_db_v2',
        companyId: 'comp-001',
      },
      trackedKeys: ['axsys_contracts_db_v2'],
      companyId: 'comp-001',
    }),
    false,
  );
});
