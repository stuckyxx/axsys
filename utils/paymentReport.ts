export type PaymentReportMode = 'complete' | 'request_only';
export type PaymentReportSection = 'request' | 'invoice' | 'certificates';

export const getPaymentReportSections = (mode: PaymentReportMode): PaymentReportSection[] => {
    if (mode === 'request_only') {
        return ['request', 'invoice'];
    }

    return ['request', 'invoice', 'certificates'];
};

export const getPaymentReportTitle = (mode: PaymentReportMode) => {
    return mode === 'request_only'
        ? 'Solicitação de Pagamento'
        : 'Processo Completo de Pagamento';
};

export const getPaymentReportPrintLabel = (mode: PaymentReportMode) => {
    return mode === 'request_only'
        ? 'Baixar Somente Solicitação'
        : 'Baixar Processo Completo';
};
