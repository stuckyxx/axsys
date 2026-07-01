import assert from 'node:assert/strict';
import test from 'node:test';

import { getClients, saveClient } from '../services/clientService.ts';
import { getExpenses, getIncomes, saveExpense, saveIncome } from '../services/financeService.ts';
import { getServices, saveService } from '../services/serviceService.ts';
import type { Client, Expense, Income, Service } from '../types.ts';

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

const client: Client = {
  id: 'client-1',
  city: 'Fortaleza',
  segment: 'Prefeitura',
  cnpj: '00.000.000/0001-00',
};

const income: Income = {
  id: 'income-1',
  description: 'Receita teste',
  amount: 1500,
  date: '2026-06-28',
  origin: 'manual',
  category: 'Serviços',
};

const expense: Expense = {
  id: 'expense-1',
  description: 'Despesa teste',
  amount: 250,
  date: '2026-06-28',
  type: 'variable',
  category: 'Impostos',
  isPaid: false,
};

const service: Service = {
  id: 'service-1',
  name: 'Assessoria',
  segment: 'Prefeitura',
  description: 'Acompanhamento técnico',
};

test('clientService respeita a empresa informada mesmo com sessão salva em outra empresa', () => {
  const localStorage = createStorageMock();
  const previousWindow = globalThis.window;

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
  });

  localStorage.setItem('sgi_user_v2', JSON.stringify({ id: 'user-1', companyId: 'comp-stale' }));

  saveClient(client, { companyId: 'comp-active' });

  assert.deepEqual(getClients({ companyId: 'comp-active' }), [client]);
  assert.equal(localStorage.getItem('company:comp-stale:axsys_clients_db_v2'), null);

  Object.defineProperty(globalThis, 'window', {
    value: previousWindow,
    configurable: true,
  });
});

test('serviceService respeita a empresa informada mesmo com sessão salva em outra empresa', () => {
  const localStorage = createStorageMock();
  const previousWindow = globalThis.window;

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
  });

  localStorage.setItem('sgi_user_v2', JSON.stringify({ id: 'user-1', companyId: 'comp-stale' }));

  saveService(service, { companyId: 'comp-active' });

  assert.deepEqual(getServices({ companyId: 'comp-active' }), [service]);
  assert.equal(localStorage.getItem('company:comp-stale:axsys_services_db_v2'), null);

  Object.defineProperty(globalThis, 'window', {
    value: previousWindow,
    configurable: true,
  });
});

test('financeService grava receitas e despesas na empresa informada', () => {
  const localStorage = createStorageMock();
  const previousWindow = globalThis.window;

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
  });

  localStorage.setItem('sgi_user_v2', JSON.stringify({ id: 'user-1', companyId: 'comp-stale' }));

  saveIncome(income, { companyId: 'comp-active' });
  saveExpense(expense, { companyId: 'comp-active' });

  assert.deepEqual(getIncomes({ companyId: 'comp-active' }), [income]);
  assert.deepEqual(getExpenses({ companyId: 'comp-active' }), [expense]);
  assert.equal(localStorage.getItem('company:comp-stale:axsys_income_db_v2'), null);
  assert.equal(localStorage.getItem('company:comp-stale:axsys_expense_db_v2'), null);

  Object.defineProperty(globalThis, 'window', {
    value: previousWindow,
    configurable: true,
  });
});
