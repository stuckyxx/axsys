
import type { Company } from '../types.ts';
import { getStoredSessionUser, requestTrackedStorageSync } from './storageScope.ts';

const COMPANIES_DB_KEY = 'axsys_companies_db_v2';

const DEFAULT_COMPANY: Company = {
    id: 'comp-001',
    corporateName: 'Minha Empresa de Serviços Ltda',
    publicCertificatesSlug: 'minha-empresa-de-servicos-ltda',
    publicCertificatesShareId: 'cert-public-comp-001',
    cnpj: '12.345.678/0001-90',
    street: 'Av. Paulista',
    number: '1000',
    neighborhood: 'Bela Vista',
    zipCode: '01310-100',
    city: 'São Paulo',
    state: 'SP',
    address: 'Av. Paulista, 1000 - Bela Vista, São Paulo - SP, 01310-100',
    banks: [
        {
            id: 'bank-001',
            name: 'BANCO DO BRASIL',
            agency: '1611-0',
            account: '64.280-0'
        }
    ],
    representative: 'Representante Legal',
    cpf: '000.000.000-00',
    email: 'contato@empresa.com.br',
    taxRate: 5.0,
    letterheadUrl: '', 
    signatureUrl: ''
};

const slugifyCompanyName = (value: string) =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'empresa';

const buildPublicCertificatesShareId = (companyId: string) => `cert-public-${companyId}`;

const ensureUniqueSlug = (baseSlug: string, companies: Company[], currentCompanyId: string) => {
    const usedSlugs = new Set(
        companies
            .filter((company) => company.id !== currentCompanyId)
            .map((company) => company.publicCertificatesSlug)
            .filter((slug): slug is string => Boolean(slug)),
    );

    if (!usedSlugs.has(baseSlug)) {
        return baseSlug;
    }

    let suffix = 2;
    while (usedSlugs.has(`${baseSlug}-${suffix}`)) {
        suffix += 1;
    }

    return `${baseSlug}-${suffix}`;
};

const normalizeCompanyPublicFields = (company: Company, companies: Company[]): Company => {
    const baseSlug = slugifyCompanyName(company.publicCertificatesSlug || company.corporateName);

    return {
        ...company,
        publicCertificatesSlug: ensureUniqueSlug(baseSlug, companies, company.id),
        publicCertificatesShareId: company.publicCertificatesShareId || buildPublicCertificatesShareId(company.id),
    };
};

const normalizeCompanies = (companies: Company[]) => companies.map((company) => normalizeCompanyPublicFields(company, companies));

export const getCompanies = (): Company[] => {
    const stored = localStorage.getItem(COMPANIES_DB_KEY);
    if (stored) {
        const parsedCompanies = JSON.parse(stored) as Company[];
        const normalizedCompanies = normalizeCompanies(parsedCompanies);
        const normalizedSnapshot = JSON.stringify(normalizedCompanies);
        if (normalizedSnapshot !== stored) {
            localStorage.setItem(COMPANIES_DB_KEY, normalizedSnapshot);
            requestTrackedStorageSync(COMPANIES_DB_KEY);
        }
        return normalizedCompanies;
    }
    // Initialize with default company
    localStorage.setItem(COMPANIES_DB_KEY, JSON.stringify([DEFAULT_COMPANY]));
    requestTrackedStorageSync(COMPANIES_DB_KEY);
    return [DEFAULT_COMPANY];
};

export const getCompanyById = (id: string): Company | undefined => {
    const companies = getCompanies();
    return companies.find(c => c.id === id);
};

export const getCompanyByPublicCertificatesIdentifier = (identifier: string): Company | undefined => {
    const companies = getCompanies();
    return companies.find((company) =>
        company.publicCertificatesSlug === identifier || company.publicCertificatesShareId === identifier,
    );
};

export const saveCompany = (company: Company): void => {
    const companies = getCompanies();
    const index = companies.findIndex(c => c.id === company.id);
    if (index !== -1) {
        companies[index] = company;
    } else {
        companies.push(company);
    }
    const normalizedCompanies = normalizeCompanies(companies);
    localStorage.setItem(COMPANIES_DB_KEY, JSON.stringify(normalizedCompanies));
    requestTrackedStorageSync(COMPANIES_DB_KEY);
};

export const deleteCompany = (id: string): void => {
    const companies = getCompanies();
    const filtered = companies.filter(c => c.id !== id);
    localStorage.setItem(COMPANIES_DB_KEY, JSON.stringify(filtered));
    requestTrackedStorageSync(COMPANIES_DB_KEY);
};

// For backward compatibility during transition, or when a user doesn't have a specific company yet
export const getCompanySettings = (): Company => {
    const companies = getCompanies();
    const sessionUser = getStoredSessionUser();
    if (sessionUser?.companyId) {
        return companies.find(company => company.id === sessionUser.companyId) || DEFAULT_COMPANY;
    }
    return companies[0] || DEFAULT_COMPANY;
};

export const saveCompanySettings = (settings: Partial<Company>): void => {
    const current = getCompanySettings();
    const updated = { ...current, ...settings };
    saveCompany(updated as Company);
};

export const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
};
