import assert from 'node:assert/strict';
import test from 'node:test';

import { getSafeAdministrativeTab, getSafeFinanceTab } from '../utils/moduleTabs.ts';

test('getSafeAdministrativeTab remove aba antiga de pagamentos e volta para cadastros', () => {
  assert.equal(getSafeAdministrativeTab('payments'), 'registrations');
  assert.equal(getSafeAdministrativeTab('contracts'), 'contracts');
  assert.equal(getSafeAdministrativeTab('unknown'), 'registrations');
});

test('getSafeFinanceTab aceita pagamentos e usa dashboard como fallback', () => {
  assert.equal(getSafeFinanceTab('payments'), 'payments');
  assert.equal(getSafeFinanceTab('income'), 'income');
  assert.equal(getSafeFinanceTab('registrations'), 'dashboard');
});
