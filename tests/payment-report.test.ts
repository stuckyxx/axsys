import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPaymentReportPrintLabel,
  getPaymentReportSections,
  getPaymentReportTitle,
} from '../utils/paymentReport.ts';

test('getPaymentReportSections retorna somente solicitação e nota quando o modo é somente solicitação', () => {
  assert.deepEqual(getPaymentReportSections('request_only'), ['request', 'invoice']);
});

test('getPaymentReportSections preserva certidões no processo completo', () => {
  assert.deepEqual(getPaymentReportSections('complete'), ['request', 'invoice', 'certificates']);
});

test('labels do relatório acompanham o modo selecionado', () => {
  assert.equal(getPaymentReportTitle('request_only'), 'Solicitação de Pagamento');
  assert.equal(getPaymentReportTitle('complete'), 'Processo Completo de Pagamento');
  assert.equal(getPaymentReportPrintLabel('request_only'), 'Baixar Somente Solicitação');
  assert.equal(getPaymentReportPrintLabel('complete'), 'Baixar Processo Completo');
});
