import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPaymentLetterLayoutRules,
  getPaymentReportPrintLabel,
  getPaymentReportSections,
  getPaymentReportTitle,
  hasPaymentReportAttachments,
} from '../utils/paymentReport.ts';

test('getPaymentReportSections retorna somente a solicitação quando o modo é somente solicitação', () => {
  assert.deepEqual(getPaymentReportSections('request_only'), ['request']);
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

test('hasPaymentReportAttachments diferencia solicitação avulsa do processo completo', () => {
  assert.equal(hasPaymentReportAttachments('request_only'), false);
  assert.equal(hasPaymentReportAttachments('complete'), true);
});

test('layout da carta reserva rodapé e limita a assinatura ao espaço interno da página', () => {
  const layout = getPaymentLetterLayoutRules();

  assert.equal(layout.content.paddingBottom, '4.6cm');
  assert.equal(layout.signature.footerClearance, '1.35cm');
  assert.equal(layout.signature.imageMaxHeight, '1.5cm');
  assert.equal(layout.signature.imageMaxWidth, '7.2cm');
  assert.equal(layout.footer.position, 'absolute');
  assert.equal(layout.footer.bottom, '0.85cm');
  assert.equal(layout.footer.maxHeight, '1.85cm');
});
