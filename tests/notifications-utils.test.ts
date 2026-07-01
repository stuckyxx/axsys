import assert from 'node:assert/strict';
import test from 'node:test';

import type { Certificate, Contract } from '../types.ts';
import {
  buildDeadlineAlerts,
  summarizeDeadlineAlerts,
} from '../utils/notifications.ts';

const today = new Date('2026-05-31T12:00:00.000Z');

const contracts: Contract[] = [
  {
    id: 'contract-active',
    clientId: 'client-1',
    clientName: 'Prefeitura de Exemplo',
    contractNumber: '001/2026',
    object: 'Licenciamento de software',
    startDate: '2026-01-01',
    endDate: '2026-08-10',
    totalValue: 100000,
    fileUrl: '',
  },
  {
    id: 'contract-expiring',
    clientId: 'client-2',
    clientName: 'Câmara de Exemplo',
    contractNumber: '002/2026',
    object: 'Suporte técnico',
    startDate: '2026-02-01',
    endDate: '2026-06-20',
    totalValue: 50000,
    fileUrl: '',
  },
  {
    id: 'contract-overdue',
    clientId: 'client-3',
    clientName: 'Empresa XPTO',
    contractNumber: '003/2026',
    object: 'Infraestrutura',
    startDate: '2025-01-01',
    endDate: '2026-05-20',
    totalValue: 75000,
    fileUrl: '',
  },
  {
    id: 'contract-closed',
    clientId: 'client-4',
    clientName: 'Prefeitura Encerrada',
    contractNumber: '004/2026',
    object: 'Serviço encerrado',
    startDate: '2025-01-01',
    endDate: '2026-06-05',
    totalValue: 30000,
    fileUrl: '',
    closedAt: '2026-05-01T10:00:00.000Z',
  },
];

const certificates: Certificate[] = [
  {
    id: 'cert-safe',
    name: 'Certidão Federal',
    validUntil: '2026-06-20',
    fileUrl: 'data:application/pdf;base64,safe',
    createdAt: '2026-05-30T12:00:00.000Z',
  },
  {
    id: 'cert-safe-historical',
    name: 'Certidão Federal',
    validUntil: '2026-05-28',
    fileUrl: 'data:application/pdf;base64,safe-historical',
    createdAt: '2026-05-15T12:00:00.000Z',
  },
  {
    id: 'cert-expiring',
    name: 'Certidão Trabalhista',
    validUntil: '2026-06-04',
    fileUrl: 'data:application/pdf;base64,expiring',
    createdAt: '2026-05-29T12:00:00.000Z',
  },
  {
    id: 'cert-overdue',
    name: 'Certidão Municipal',
    validUntil: '2026-05-28',
    fileUrl: 'data:application/pdf;base64,overdue',
    createdAt: '2026-05-28T12:00:00.000Z',
  },
];

test('buildDeadlineAlerts inclui contratos com 45 dias ou menos e certidões com 5 dias ou menos', () => {
  const alerts = buildDeadlineAlerts({ contracts, certificates, today });

  assert.deepEqual(
    alerts.map((alert) => ({
      category: alert.category,
      resourceId: alert.resourceId,
      severity: alert.severity,
      daysRemaining: alert.daysRemaining,
    })),
    [
      { category: 'contract', resourceId: 'contract-overdue', severity: 'critical', daysRemaining: -11 },
      { category: 'certificate', resourceId: 'cert-overdue', severity: 'critical', daysRemaining: -3 },
      { category: 'certificate', resourceId: 'cert-expiring', severity: 'warning', daysRemaining: 4 },
      { category: 'contract', resourceId: 'contract-expiring', severity: 'warning', daysRemaining: 20 },
    ],
  );
});

test('summarizeDeadlineAlerts agrega totais críticos e por categoria', () => {
  const summary = summarizeDeadlineAlerts(buildDeadlineAlerts({ contracts, certificates, today }));

  assert.deepEqual(summary, {
    total: 4,
    criticalCount: 2,
    warningCount: 2,
    contractsCount: 2,
    certificatesCount: 2,
  });
});
