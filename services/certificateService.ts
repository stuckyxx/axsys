
import { Certificate } from '../types';
import localforage from 'localforage';

const CERT_DB_KEY = 'axsys_certificates_db_v2';

// Lista padrão exigida para validação
export const REQUIRED_CERTIFICATE_TYPES = [
    'Certidão Federal',
    'Certidão Trabalhista',
    'Certificado de Regularidade do FGTS',
    'Certidão Estadual (Débitos)',
    'Certidão Estadual (Dívida Ativa)',
    'Certidão Municipal'
];

export const getCertificates = async (): Promise<Certificate[]> => {
    try {
        const stored = await localforage.getItem<Certificate[]>(CERT_DB_KEY);
        if (stored) {
            return stored;
        }
        
        // Fallback to localStorage for migration
        const oldStored = localStorage.getItem(CERT_DB_KEY);
        if (oldStored) {
            const parsed = JSON.parse(oldStored);
            await localforage.setItem(CERT_DB_KEY, parsed);
            return parsed;
        }
    } catch (e) {
        console.error("Error reading certificates", e);
    }
    return []; // Começa zerado conforme solicitado
};

export const saveCertificate = async (cert: Certificate): Promise<void> => {
    const current = await getCertificates();
    const index = current.findIndex(c => c.id === cert.id);
    let updated;
    if (index >= 0) {
        updated = [...current];
        updated[index] = cert;
    } else {
        updated = [...current, cert];
    }
    
    try {
        await localforage.setItem(CERT_DB_KEY, updated);
    } catch (e) {
        console.error("Storage error", e);
        throw e;
    }
};

export const deleteCertificate = async (id: string): Promise<void> => {
    const current = await getCertificates();
    const updated = current.filter(c => c.id !== id);
    await localforage.setItem(CERT_DB_KEY, updated);
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
