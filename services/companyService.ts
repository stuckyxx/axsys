
import { Company } from '../types';

const COMPANIES_DB_KEY = 'axsys_companies_db_v2';

const DEFAULT_COMPANY: Company = {
    id: 'comp-001',
    corporateName: 'Minha Empresa de Serviços Ltda',
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

export const getCompanies = (): Company[] => {
    const stored = localStorage.getItem(COMPANIES_DB_KEY);
    if (stored) {
        return JSON.parse(stored);
    }
    // Initialize with default company
    localStorage.setItem(COMPANIES_DB_KEY, JSON.stringify([DEFAULT_COMPANY]));
    return [DEFAULT_COMPANY];
};

export const getCompanyById = (id: string): Company | undefined => {
    const companies = getCompanies();
    return companies.find(c => c.id === id);
};

export const saveCompany = (company: Company): void => {
    const companies = getCompanies();
    const index = companies.findIndex(c => c.id === company.id);
    if (index !== -1) {
        companies[index] = company;
    } else {
        companies.push(company);
    }
    localStorage.setItem(COMPANIES_DB_KEY, JSON.stringify(companies));
};

export const deleteCompany = (id: string): void => {
    const companies = getCompanies();
    const filtered = companies.filter(c => c.id !== id);
    localStorage.setItem(COMPANIES_DB_KEY, JSON.stringify(filtered));
};

// For backward compatibility during transition, or when a user doesn't have a specific company yet
export const getCompanySettings = (): Company => {
    const companies = getCompanies();
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
