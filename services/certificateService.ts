
import type { Certificate, User } from '../types';
import { supabase } from './supabaseClient';
import {
    getScopedStorageKey,
    readCompanyScopedValue,
    resolveCompanyScopedKey,
    writeCompanyScopedValue,
} from './storageScope';
import { persistRecoveredCertificatesSafely } from '../utils/certificateRecovery';
import { resolveCertificatesForLoad } from '../utils/certificateLoad';
import { selectCertificateSnapshot } from '../utils/certificateSnapshots';

const CERT_DB_KEY = 'axsys_certificates_db_v2';
const APP_STATE_TABLE = 'app_state';

// Lista padrão exigida para validação
export const REQUIRED_CERTIFICATE_TYPES = [
    'Certidão Federal',
    'Certidão Trabalhista',
    'Certificado de Regularidade do FGTS',
    'Certidão Estadual (Débitos)',
    'Certidão Estadual (Dívida Ativa)',
    'Certidão Municipal'
];

const isCertificateRecord = (value: unknown): value is Certificate => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<Certificate>;
    return typeof candidate.id === 'string'
        && typeof candidate.name === 'string'
        && typeof candidate.validUntil === 'string'
        && typeof candidate.fileUrl === 'string'
        && (typeof candidate.createdAt === 'undefined' || typeof candidate.createdAt === 'string');
};

const parseCertificates = (value: unknown): Certificate[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(isCertificateRecord);
};

const recoverCertificatesFromRemote = async (
    user?: Pick<User, 'companyId'> | null,
): Promise<Certificate[]> => {
    const scopedKey = resolveCompanyScopedKey(CERT_DB_KEY, user);
    const globalScopedKey = getScopedStorageKey(CERT_DB_KEY, { companyId: 'global' });

    const { data, error } = await supabase
        .from(APP_STATE_TABLE)
        .select('key, value, updated_at')
        .in('key', [scopedKey, globalScopedKey, CERT_DB_KEY])
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('Error recovering certificates from Supabase', error);
        return [];
    }

    const snapshots = (data || [])
        .map((row) => ({
            key: String(row.key),
            updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
            certificates: parseCertificates(row.value),
        }))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    const preferredSnapshot = selectCertificateSnapshot({
        scopedKey,
        globalScopedKey,
        snapshots,
    });
    if (preferredSnapshot) {
        return persistRecoveredCertificatesSafely(
            preferredSnapshot.certificates,
            (certificates) => writeCompanyScopedValue(CERT_DB_KEY, certificates, user),
        );
    }

    return [];
};

export const getCertificates = async (
    user?: Pick<User, 'companyId'> | null,
    options?: { preferRemote?: boolean },
): Promise<Certificate[]> => {
    try {
        const localCertificates = readCompanyScopedValue(CERT_DB_KEY, [], user);
        return await resolveCertificatesForLoad({
            localCertificates,
            preferRemote: options?.preferRemote ?? false,
            recoverRemote: () => recoverCertificatesFromRemote(user),
        });
    } catch (e) {
        console.error("Error reading certificates", e);
    }
    return []; // Começa zerado conforme solicitado
};

export const saveCertificate = async (
    cert: Certificate,
    user?: Pick<User, 'companyId'> | null,
): Promise<void> => {
    const current = await getCertificates(user);
    const normalizedCertificate: Certificate = {
        ...cert,
        createdAt: cert.createdAt || new Date().toISOString(),
    };
    const index = current.findIndex(c => c.id === normalizedCertificate.id);
    let updated;
    if (index >= 0) {
        updated = [...current];
        updated[index] = normalizedCertificate;
    } else {
        updated = [...current, normalizedCertificate];
    }
    
    try {
        writeCompanyScopedValue(CERT_DB_KEY, updated, user);
    } catch (e) {
        console.error("Storage error", e);
        throw e;
    }
};

export const deleteCertificate = async (
    id: string,
    user?: Pick<User, 'companyId'> | null,
): Promise<void> => {
    const current = await getCertificates(user);
    const updated = current.filter(c => c.id !== id);
    writeCompanyScopedValue(CERT_DB_KEY, updated, user);
};

// Helper para converter File para Base64 (para persistir no LocalStorage neste demo)
export const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
};
