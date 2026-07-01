import type { Certificate } from '../types.ts';
import { buildCertificateCollections, isCertificateValid } from './certificateHistory.ts';

export type CertificateStatus = 'valid' | 'expired';

export const getCertificateStatus = (
  dateString: string,
  referenceDate: Date = new Date(),
): CertificateStatus => {
  return isCertificateValid(
    { id: 'status', name: 'status', validUntil: dateString, fileUrl: '' },
    referenceDate,
  )
    ? 'valid'
    : 'expired';
};

export const buildPublicCertificatesSections = (
  certificates: Certificate[],
  referenceDate: Date = new Date(),
) => {
  const collections = buildCertificateCollections(certificates, referenceDate);
  return {
    current: collections.current,
    history: collections.history,
  };
};

export const splitPublicCertificates = (
  certificates: Certificate[],
  referenceDate: Date = new Date(),
) => {
  const sections = buildPublicCertificatesSections(certificates, referenceDate);
  return { valid: sections.current, expired: sections.history };
};

export const formatCertificateDate = (value: string) => {
  try {
    const [year, month, day] = value.split('T')[0].split('-');
    if (!year || !month || !day) {
      return value;
    }

    return `${day}/${month}/${year}`;
  } catch {
    return value;
  }
};

export const buildPublicCertificatesUrl = (
  origin: string,
  pathname: string,
  identifier: string,
) => {
  const normalizedPathname = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${origin}${normalizedPathname}#/public/certidoes/${identifier}`;
};
