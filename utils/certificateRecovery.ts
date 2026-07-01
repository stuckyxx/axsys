import type { Certificate } from '../types';

export const persistRecoveredCertificatesSafely = (
    certificates: Certificate[],
    persist: (certificates: Certificate[]) => void,
): Certificate[] => {
    try {
        persist(certificates);
    } catch (error) {
        console.error('Falha ao armazenar certidões recuperadas no cache local', error);
    }

    return certificates;
};
