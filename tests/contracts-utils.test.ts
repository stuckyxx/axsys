import assert from 'node:assert/strict';
import test from 'node:test';

import type { Contract } from '../types.ts';
import {
  deriveContractEntity,
  filterContracts,
  getContractProgress,
  getContractStatus,
  paginateContracts,
  summarizeContracts,
} from '../utils/contracts.ts';

const today = new Date('2026-05-31T12:00:00.000Z');

const contracts: Contract[] = [
  {
    id: 'contract-1',
    clientId: 'client-1',
    clientName: 'Prefeitura Municipal de Aurora',
    contractNumber: '001/2026',
    object: 'Licenciamento de software para gestão tributária.',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    totalValue: 120000,
    fileUrl: '#',
  },
  {
    id: 'contract-2',
    clientId: 'client-2',
    clientName: 'Câmara Municipal de Cedro',
    contractNumber: '014/2026',
    object: 'Locação de plataforma legislativa.',
    startDate: '2025-07-01',
    endDate: '2026-06-15',
    totalValue: 48000,
    fileUrl: '#',
  },
  {
    id: 'contract-3',
    clientId: 'client-3',
    clientName: 'Empresa Vale Verde S.A.',
    contractNumber: '203/2025',
    object: 'Suporte contínuo e manutenção especializada.',
    startDate: '2025-01-01',
    endDate: '2026-05-01',
    totalValue: 75000,
    fileUrl: '#',
  },
  {
    id: 'contract-4',
    clientId: 'client-4',
    clientName: 'Prefeitura Municipal de Lago Azul',
    contractNumber: '099/2024',
    object: 'Serviços de migração e encerramento assistido.',
    startDate: '2024-03-01',
    endDate: '2025-03-01',
    totalValue: 36000,
    fileUrl: '#',
    closedAt: '2025-02-15T10:00:00.000Z',
  },
];

test('getContractStatus classifica contratos ativos, a vencer, vencidos e encerrados', () => {
  assert.equal(getContractStatus(contracts[0], today), 'Ativo');
  assert.equal(getContractStatus(contracts[1], today), 'A vencer');
  assert.equal(getContractStatus(contracts[2], today), 'Vencido');
  assert.equal(getContractStatus(contracts[3], today), 'Encerrado');
});

test('deriveContractEntity reconhece prefeitura, câmara e empresa a partir do nome do órgão', () => {
  assert.equal(deriveContractEntity(contracts[0].clientName), 'Prefeitura');
  assert.equal(deriveContractEntity(contracts[1].clientName), 'Câmara');
  assert.equal(deriveContractEntity(contracts[2].clientName), 'Empresa');
});

test('summarizeContracts agrega métricas coerentes com status e valor total', () => {
  assert.deepEqual(summarizeContracts(contracts, today), {
    activeCount: 1,
    expiringCount: 1,
    expiredCount: 1,
    closedCount: 1,
    totalValue: 279000,
  });
});

test('filterContracts combina busca textual, status e entidade', () => {
  assert.deepEqual(
    filterContracts(
      contracts,
      { search: 'plataforma', status: 'A vencer', entity: 'Câmara' },
      today,
    ).map((contract) => contract.id),
    ['contract-2'],
  );

  assert.deepEqual(
    filterContracts(contracts, { search: 'prefeitura', status: 'Todos', entity: 'Todos' }, today).map(
      (contract) => contract.id,
    ),
    ['contract-1', 'contract-4'],
  );
});

test('paginateContracts retorna recorte e metadados de paginação', () => {
  assert.deepEqual(paginateContracts(contracts, 1, 2).items.map((contract) => contract.id), [
    'contract-1',
    'contract-2',
  ]);
  assert.deepEqual(paginateContracts(contracts, 2, 2), {
    items: [contracts[2], contracts[3]],
    page: 2,
    pageSize: 2,
    totalItems: 4,
    totalPages: 2,
  });
});

test('getContractProgress respeita contratos futuros, vigentes e encerrados', () => {
  const futureContract: Contract = {
    id: 'future',
    clientId: 'client-9',
    clientName: 'Empresa Horizonte',
    contractNumber: '888/2026',
    object: 'Implantação futura.',
    startDate: '2026-12-01',
    endDate: '2027-12-01',
    totalValue: 9000,
    fileUrl: '#',
  };

  assert.equal(getContractProgress(futureContract, today), 0);
  assert.equal(getContractProgress(contracts[2], today), 100);
  assert.equal(getContractProgress(contracts[0], today), 41);
});
