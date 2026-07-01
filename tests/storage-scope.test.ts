import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getCompanyScopedBaseKey,
  getScopedStorageKey,
  getScopeCompanyId,
  isCompanyScopedBaseKey,
  isKeyTrackedForPersistence,
  readCompanyScopedValue,
  registerStorageSyncHandler,
  requestTrackedStorageSync,
  SESSION_USER_STORAGE_KEY,
  writeCompanyScopedValue,
} from '../services/storageScope.ts';

const createStorageMock = () => {
  const store = new Map<string, string>();

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
};

test('getScopeCompanyId usa a empresa do usuário e fallback global', () => {
  assert.equal(getScopeCompanyId({ companyId: 'comp-123' }), 'comp-123');
  assert.equal(getScopeCompanyId({ companyId: undefined }), 'global');
  assert.equal(getScopeCompanyId(null), 'global');
});

test('getScopedStorageKey cria chaves isoladas por empresa', () => {
  assert.equal(getScopedStorageKey('axsys_contracts_db_v2', { companyId: 'comp-001' }), 'company:comp-001:axsys_contracts_db_v2');
  assert.equal(getScopedStorageKey('axsys_income_db_v2', null), 'company:global:axsys_income_db_v2');
});

test('getCompanyScopedBaseKey identifica apenas chaves escopadas válidas', () => {
  assert.equal(getCompanyScopedBaseKey('company:comp-001:axsys_payment_requests_v2'), 'axsys_payment_requests_v2');
  assert.equal(getCompanyScopedBaseKey('company:comp-001:unknown_key'), null);
  assert.equal(getCompanyScopedBaseKey('axsys_payment_requests_v2'), null);
});

test('isKeyTrackedForPersistence cobre chaves globais e escopadas', () => {
  assert.equal(isCompanyScopedBaseKey('axsys_clients_db_v2'), true);
  assert.equal(isCompanyScopedBaseKey('axsys_users_db_v3'), false);
  assert.equal(isKeyTrackedForPersistence('axsys_users_db_v3'), true);
  assert.equal(isKeyTrackedForPersistence('company:comp-001:axsys_clients_db_v2'), true);
  assert.equal(isKeyTrackedForPersistence('company:comp-001:random_key'), false);
  assert.equal(isKeyTrackedForPersistence(SESSION_USER_STORAGE_KEY), false);
});

test('readCompanyScopedValue usa fallback legado e espelha para a chave escopada', () => {
  const localStorage = createStorageMock();
  const previousWindow = globalThis.window;

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
  });

  localStorage.setItem('axsys_contracts_db_v2', JSON.stringify([{ id: 'legacy-contract' }]));

  assert.deepEqual(
    readCompanyScopedValue('axsys_contracts_db_v2', [], { companyId: 'comp-legacy' }),
    [{ id: 'legacy-contract' }],
  );
  assert.equal(
    localStorage.getItem('company:comp-legacy:axsys_contracts_db_v2'),
    JSON.stringify([{ id: 'legacy-contract' }]),
  );

  Object.defineProperty(globalThis, 'window', {
    value: previousWindow,
    configurable: true,
  });
});

test('writeCompanyScopedValue grava usando a chave da empresa ativa', () => {
  const localStorage = createStorageMock();
  const previousWindow = globalThis.window;
  const syncCalls: Array<{ key: string; companyId?: string }> = [];

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
  });

  registerStorageSyncHandler((key, user) => {
    syncCalls.push({ key, companyId: user?.companyId });
  });

  writeCompanyScopedValue('axsys_payment_requests_v2', [{ id: 'req-1' }], { companyId: 'comp-777' });

  assert.equal(
    localStorage.getItem('company:comp-777:axsys_payment_requests_v2'),
    JSON.stringify([{ id: 'req-1' }]),
  );
  assert.deepEqual(syncCalls, [
    {
      key: 'company:comp-777:axsys_payment_requests_v2',
      companyId: 'comp-777',
    },
  ]);

  registerStorageSyncHandler(null);
  Object.defineProperty(globalThis, 'window', {
    value: previousWindow,
    configurable: true,
  });
});

test('requestTrackedStorageSync ignora chaves não rastreadas e sincroniza as válidas', () => {
  const syncCalls: Array<{ key: string; companyId?: string }> = [];

  registerStorageSyncHandler((key, user) => {
    syncCalls.push({ key, companyId: user?.companyId });
  });

  requestTrackedStorageSync('adminActiveTab', { companyId: 'comp-ignore' });
  requestTrackedStorageSync('axsys_users_db_v3', { companyId: 'comp-001' });

  assert.deepEqual(syncCalls, [
    {
      key: 'axsys_users_db_v3',
      companyId: 'comp-001',
    },
  ]);

  registerStorageSyncHandler(null);
});
