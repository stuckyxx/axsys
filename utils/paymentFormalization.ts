import type { Certificate } from '../types.ts';
import { buildCertificateCollections, isCertificateValid } from './certificateHistory.ts';

const REQUIRED_CERTIFICATE_TYPES = [
  'Certidão Federal',
  'Certidão Trabalhista',
  'Certificado de Regularidade do FGTS',
  'Certidão Estadual (Débitos)',
  'Certidão Estadual (Dívida Ativa)',
  'Certidão Municipal',
] as const;

export const evaluatePaymentRequestCertificates = (
  certificates: Certificate[],
  referenceDate: Date = new Date(),
) => {
  const collections = buildCertificateCollections(certificates, referenceDate);
  const latestCertificateNames = new Set(
    collections.latestByType.map((certificate) => certificate.name),
  );
  const expiredCertificates = collections.relevant.filter((certificate) =>
    REQUIRED_CERTIFICATE_TYPES.includes(certificate.name as (typeof REQUIRED_CERTIFICATE_TYPES)[number])
    && !isCertificateValid(certificate, referenceDate),
  );

  const missingCertificates = REQUIRED_CERTIFICATE_TYPES.filter((type) =>
    !latestCertificateNames.has(type),
  );

  return {
    expiredCertificates,
    missingCertificates,
  };
};
