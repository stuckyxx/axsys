import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getCompanies,
  getCompanyById,
  getCompanyByPublicCertificatesIdentifier,
  saveCompany,
} from '../services/companyService.ts';

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

test('getCompanies normaliza slug e shareId publicos para empresas legadas', () => {
  const restoreStorage = installStorage();

  globalThis.localStorage.setItem(
    'axsys_companies_db_v2',
    JSON.stringify([
      {
        id: 'comp-001',
        corporateName: 'Assesi Tecnologia Ltda',
        cnpj: '12.345.678/0001-90',
        street: 'Rua A',
        number: '100',
        neighborhood: 'Centro',
        zipCode: '60000-000',
        city: 'Fortaleza',
        state: 'CE',
        address: 'Rua A, 100',
        representative: 'Maria',
        cpf: '000.000.000-00',
        email: 'contato@assesi.com',
        taxRate: 5,
        banks: [],
      },
    ]),
  );

  const [company] = getCompanies();

  assert.equal(company.publicCertificatesSlug, 'assesi-tecnologia-ltda');
  assert.equal(company.publicCertificatesShareId, 'cert-public-comp-001');

  restoreStorage();
});

test('saveCompany garante slug unico e permite buscar por slug ou shareId', () => {
  const restoreStorage = installStorage();

  saveCompany({
    id: 'comp-001',
    corporateName: 'Alpha Servicos',
    cnpj: '11.111.111/0001-11',
    street: 'Rua A',
    number: '1',
    neighborhood: 'Centro',
    zipCode: '60000-000',
    city: 'Fortaleza',
    state: 'CE',
    address: 'Rua A, 1',
    representative: 'Ana',
    cpf: '000.000.000-00',
    email: 'alpha@empresa.com',
    taxRate: 5,
    banks: [],
  });

  saveCompany({
    id: 'comp-002',
    corporateName: 'Alpha Servicos',
    cnpj: '22.222.222/0001-22',
    street: 'Rua B',
    number: '2',
    neighborhood: 'Centro',
    zipCode: '60000-001',
    city: 'Fortaleza',
    state: 'CE',
    address: 'Rua B, 2',
    representative: 'Bia',
    cpf: '111.111.111-11',
    email: 'beta@empresa.com',
    taxRate: 5,
    banks: [],
  });

  const first = getCompanyById('comp-001');
  const second = getCompanyById('comp-002');

  assert.equal(first?.publicCertificatesSlug, 'alpha-servicos');
  assert.equal(second?.publicCertificatesSlug, 'alpha-servicos-2');
  assert.equal(getCompanyByPublicCertificatesIdentifier('alpha-servicos')?.id, 'comp-001');
  assert.equal(getCompanyByPublicCertificatesIdentifier('cert-public-comp-002')?.id, 'comp-002');

  restoreStorage();
});
