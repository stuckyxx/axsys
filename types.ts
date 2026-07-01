
export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN', // Painel geral
  COMPANY_ADMIN = 'COMPANY_ADMIN', // Admin da empresa
  USER = 'USER' // Usuário comum da empresa
}

export enum SystemModule {
  ADMINISTRATIVE = 'administrative',
  FINANCIAL = 'financial',
  CERTIFICATES = 'certificates',
  SYSTEM_ADMIN = 'system_admin' // Acesso à tela de gestão de usuários da empresa
}

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  companyId?: string; // ID da empresa vinculada
  avatarUrl?: string;
  allowedModules: SystemModule[];
}

export interface BankAccount {
  id: string;
  name: string;
  agency: string;
  account: string;
}

export interface Company {
  id: string;
  corporateName: string;
  publicCertificatesSlug?: string;
  publicCertificatesShareId?: string;
  cnpj: string;
  street: string;
  number: string;
  neighborhood: string;
  zipCode: string;
  city: string;
  state: string;
  address: string;
  representative: string;
  cpf: string;
  email: string;
  taxRate: number;
  banks: BankAccount[]; // Gerenciado pelo Super Admin
  logoUrl?: string;
  letterheadUrl?: string;
  signatureUrl?: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginResponse {
  token: string;
  user: User;
}

// --- Business Types ---

export interface Client {
  id: string;
  city: string;
  segment: string;
  cnpj: string;
  used?: boolean;
}

export interface Service {
  id: string;
  name: string;
  segment: string;
  description: string;
  used?: boolean;
}

export interface ProposalItem {
  id: string;
  serviceId: string;
  serviceDescription?: string;
  type?: 'service' | 'product';
  validityMonths?: number;
  monthlyValue?: number;
  quantity?: number;
  unitValue?: number;
  total: number;
}

export interface Proposal {
  id: string;
  number: string;
  clientId: string;
  segment: string;
  date: string;
  status: 'draft' | 'sent' | 'approved' | 'rejected';
  totalValue: number;
  items: ProposalItem[];
}

export interface Order {
  id: string;
  fileName: string;
  uploadDate: string;
  status: 'pending' | 'signed';
  signedUrl?: string;
}

// Financeiro
export interface Expense {
  id: string;
  description: string;
  amount: number;
  type: 'fixed' | 'variable'; // Fixa ou Variável
  date: string;
  category: string;
  isPaid?: boolean; // Flag para controle de pagamento
}

export interface Income {
  id: string;
  description: string;
  amount: number;
  date: string;
  origin: 'payment_request' | 'manual';
  paymentRequestId?: string;
  category?: string; // Campo opcional para categorização
}

// Administrativo -> Solicitação de Pagamento
export interface PaymentRequest {
  id: string;
  invoiceFile: string; // Nome do arquivo NF
  invoiceFileContent?: string; // Conteúdo Base64 do arquivo NF
  providerName?: string; // Nome do Prestador (Extraído)
  takerName?: string; // Nome do Tomador (Extraído - Quem recebe o ofício)
  invoiceNumber: string; // Extraído via "OCR"
  verificationCode?: string; // Código de Verificação
  description: string; // Objeto extraído
  amount: number; // Valor extraído
  issueDate?: string; // Data de emissão extraída
  status: 'pending' | 'approved' | 'formalized' | 'paid';
  createdAt: string;
  contractId?: string; // Vínculo opcional com contrato
  clientId?: string; // Vínculo com cliente
}

export interface Certificate {
  id: string;
  name: string;
  validUntil: string;
  fileUrl: string;
  createdAt?: string;
}

export interface ContractAttachment {
  name: string;
  content: string;
  mimeType: string;
  attachedAt: string;
}

export interface Contract {
  id: string;
  clientId: string;
  clientName: string;
  contractNumber: string;
  object: string;
  startDate: string;
  endDate: string;
  totalValue: number;
  fileUrl: string;
  attachment?: ContractAttachment;
  publicShareId?: string;
  closedAt?: string;
}
