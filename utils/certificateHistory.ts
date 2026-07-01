import type { Certificate } from '../types.ts';

export interface CertificateCollections {
  all: Certificate[];
  current: Certificate[];
  relevant: Certificate[];
  history: Certificate[];
  expired: Certificate[];
  latestByType: Certificate[];
}

const normalizeReferenceDate = (referenceDate: Date) => {
  const normalized = new Date(referenceDate);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
};

const getDatePart = (value: string) => value.split('T')[0] || value;

const parseCertificateDate = (value: string, time: 'start' | 'end') => {
  const datePart = getDatePart(value);
  const timePart = time === 'end' ? '23:59:59.999' : '00:00:00.000';
  const parsed = new Date(`${datePart}T${timePart}`);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
};

const getCertificateRecency = (certificate: Certificate) => {
  if (certificate.createdAt) {
    const createdAt = new Date(certificate.createdAt);
    if (!Number.isNaN(createdAt.getTime())) {
      return createdAt.getTime();
    }
  }

  return parseCertificateDate(certificate.validUntil, 'end').getTime();
};

const sortCertificatesByRecency = (certificates: Certificate[]) =>
  [...certificates].sort((left, right) => {
    const recencyDifference = getCertificateRecency(right) - getCertificateRecency(left);
    if (recencyDifference !== 0) {
      return recencyDifference;
    }

    const validUntilDifference =
      parseCertificateDate(right.validUntil, 'end').getTime()
      - parseCertificateDate(left.validUntil, 'end').getTime();
    if (validUntilDifference !== 0) {
      return validUntilDifference;
    }

    const nameDifference = left.name.localeCompare(right.name, 'pt-BR');
    if (nameDifference !== 0) {
      return nameDifference;
    }

    return left.id.localeCompare(right.id, 'pt-BR');
  });

export const isCertificateValid = (
  certificate: Certificate,
  referenceDate: Date = new Date(),
) => {
  const today = normalizeReferenceDate(referenceDate);
  return parseCertificateDate(certificate.validUntil, 'end') >= today;
};

export const buildCertificateCollections = (
  certificates: Certificate[],
  referenceDate: Date = new Date(),
): CertificateCollections => {
  const all = sortCertificatesByRecency(certificates);
  const grouped = new Map<string, Certificate[]>();

  all.forEach((certificate) => {
    const currentGroup = grouped.get(certificate.name) ?? [];
    currentGroup.push(certificate);
    grouped.set(certificate.name, currentGroup);
  });

  const current: Certificate[] = [];
  const relevant: Certificate[] = [];
  const history: Certificate[] = [];
  const expired: Certificate[] = [];
  const latestByType: Certificate[] = [];

  grouped.forEach((groupCertificates) => {
    const latest = groupCertificates[0];
    const currentValid = groupCertificates.find((certificate) =>
      isCertificateValid(certificate, referenceDate),
    );

    latestByType.push(latest);

    if (currentValid) {
      current.push(currentValid);
      relevant.push(currentValid);
    } else {
      relevant.push(latest);
    }

    groupCertificates.forEach((certificate) => {
      if (!currentValid || certificate.id !== currentValid.id) {
        history.push(certificate);
      }

      if (!isCertificateValid(certificate, referenceDate)) {
        expired.push(certificate);
      }
    });
  });

  return {
    all,
    current: sortCertificatesByRecency(current),
    relevant: sortCertificatesByRecency(relevant),
    history: sortCertificatesByRecency(history),
    expired: sortCertificatesByRecency(expired),
    latestByType: sortCertificatesByRecency(latestByType),
  };
};
