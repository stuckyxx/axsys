import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNotificationReadsStorageKey,
  computeUnreadNotificationIds,
  formatNotificationReadsDay,
  mergeReadNotificationIds,
} from '../utils/notificationReads.ts';

test('formatNotificationReadsDay usa calendário local no formato yyyy-mm-dd', () => {
  assert.equal(formatNotificationReadsDay(new Date('2026-06-01T10:30:00.000Z')), '2026-06-01');
});

test('buildNotificationReadsStorageKey separa leitura por usuário e por dia', () => {
  assert.equal(
    buildNotificationReadsStorageKey('user-1', '2026-06-01'),
    'axsys_notification_reads_v1:user-1:2026-06-01',
  );
});

test('mergeReadNotificationIds evita duplicidade ao marcar como visto', () => {
  assert.deepEqual(
    mergeReadNotificationIds(['contract:1'], ['contract:1', 'certificate:2']),
    ['certificate:2', 'contract:1'],
  );
});

test('computeUnreadNotificationIds reseta no dia seguinte ao depender de outra chave diária', () => {
  assert.deepEqual(
    computeUnreadNotificationIds(
      ['contract:1', 'certificate:2'],
      ['contract:1'],
    ),
    ['certificate:2'],
  );

  assert.deepEqual(
    computeUnreadNotificationIds(
      ['contract:1', 'certificate:2'],
      [],
    ),
    ['contract:1', 'certificate:2'],
  );
});
