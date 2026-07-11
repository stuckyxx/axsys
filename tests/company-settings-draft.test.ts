import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCompanySettingsDraft,
  buildCompanySettingsDraftKey,
  clearCompanySettingsDraft,
  saveCompanySettingsDraft,
} from '../utils/companySettingsDraft.ts';
import type { Company } from '../types.ts';

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

const installStorage = () => {
  const localStorage = createStorageMock();
  const previousLocalStorage = globalThis.localStorage;

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorage,
    configurable: true,
  });

  return () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: previousLocalStorage,
      configurable: true,
    });
  };
};

const company: Company = {
  id: 'comp-001',
  corporateName: 'Empresa Salva',
  cnpj: '11.111.111/0001-11',
  street: 'Rua Salva',
  number: '10',
  neighborhood: 'Centro',
  zipCode: '60000-000',
  city: 'Fortaleza',
  state: 'CE',
  address: 'Rua Salva, 10 - Centro, Fortaleza - CE, 60000-000',
  representative: 'Ana',
  cpf: '000.000.000-00',
  email: 'contato@empresa.com',
  taxRate: 5,
  banks: [],
};

test('applyCompanySettingsDraft restaura rascunho digitado ao reabrir configuracoes', () => {
  const restoreStorage = installStorage();
  const draft = {
    ...company,
    street: 'Rua Digitada',
    number: '250',
    address: 'Rua Digitada, 250 - Centro, Fortaleza - CE, 60000-000',
  };

  saveCompanySettingsDraft(draft);

  assert.equal(globalThis.localStorage.getItem(buildCompanySettingsDraftKey(company.id)) !== null, true);
  assert.deepEqual(applyCompanySettingsDraft(company), draft);

  restoreStorage();
});

test('clearCompanySettingsDraft remove rascunho depois que os dados sao salvos', () => {
  const restoreStorage = installStorage();
  const draft = { ...company, street: 'Rua Temporaria' };

  saveCompanySettingsDraft(draft);
  clearCompanySettingsDraft(company.id);

  assert.equal(globalThis.localStorage.getItem(buildCompanySettingsDraftKey(company.id)), null);
  assert.deepEqual(applyCompanySettingsDraft(company), company);

  restoreStorage();
});
