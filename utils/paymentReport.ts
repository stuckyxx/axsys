export type PaymentReportMode = 'complete' | 'request_only';
export type PaymentReportSection = 'request' | 'invoice' | 'certificates';

export const getPaymentLetterLayoutRules = () => ({
    content: {
        paddingBottom: '4.6cm',
    },
    signature: {
        footerClearance: '1.35cm',
        imageMaxHeight: '1.5cm',
        imageMaxWidth: '7.2cm',
    },
    footer: {
        position: 'absolute',
        bottom: '0.85cm',
        maxHeight: '1.85cm',
    },
} as const);

export const getPaymentReportSections = (mode: PaymentReportMode): PaymentReportSection[] => {
    if (mode === 'request_only') {
        return ['request'];
    }

    return ['request', 'invoice', 'certificates'];
};

export const hasPaymentReportAttachments = (mode: PaymentReportMode) => {
    return getPaymentReportSections(mode).some((section) => section !== 'request');
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
