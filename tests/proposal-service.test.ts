import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteProposal,
  getProposals,
  saveProposal,
} from '../services/proposalService.ts';
import type { Proposal } from '../types.ts';

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

const sampleProposal = (id: string, number: string): Proposal => ({
  id,
  number,
  clientId: 'client-1',
  segment: 'Prefeitura',
  status: 'draft',
  items: [],
  totalValue: 1000,
  date: '2026-06-28',
});

test('deleteProposal remove a proposta da empresa informada mesmo com sessão salva apontando para outra empresa', () => {
  const localStorage = createStorageMock();
  const previousWindow = globalThis.window;

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
  });

  localStorage.setItem(
    'sgi_user_v2',
    JSON.stringify({ id: 'user-1', companyId: 'comp-stale' }),
  );

  localStorage.setItem(
    'company:comp-active:axsys_proposals_db_v2',
    JSON.stringify([
      sampleProposal('prop-1', 'PROP-001'),
      sampleProposal('prop-2', 'PROP-002'),
    ]),
  );

  deleteProposal('prop-1', { companyId: 'comp-active' });

  assert.deepEqual(getProposals({ companyId: 'comp-active' }), [
    sampleProposal('prop-2', 'PROP-002'),
  ]);

  Object.defineProperty(globalThis, 'window', {
    value: previousWindow,
    configurable: true,
  });
});

test('saveProposal atualiza usando sempre o escopo da empresa informada', () => {
  const localStorage = createStorageMock();
  const previousWindow = globalThis.window;

  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
  });

  localStorage.setItem(
    'sgi_user_v2',
    JSON.stringify({ id: 'user-1', companyId: 'comp-stale' }),
  );

  saveProposal(sampleProposal('prop-10', 'PROP-010'), { companyId: 'comp-active' });

  assert.deepEqual(getProposals({ companyId: 'comp-active' }), [
    sampleProposal('prop-10', 'PROP-010'),
  ]);
  assert.equal(localStorage.getItem('company:comp-stale:axsys_proposals_db_v2'), null);

  Object.defineProperty(globalThis, 'window', {
    value: previousWindow,
    configurable: true,
  });
});
