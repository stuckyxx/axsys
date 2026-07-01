export type FinanceTabId = 'dashboard' | 'income' | 'expenses' | 'payments';
export type AdministrativeModuleTabId = 'registrations' | 'proposals' | 'contracts';

export const FINANCE_ACTIVE_TAB_STORAGE_KEY = 'financeActiveTab';
export const ADMIN_ACTIVE_TAB_STORAGE_KEY = 'adminActiveTab';

const ADMINISTRATIVE_TABS: AdministrativeModuleTabId[] = ['registrations', 'proposals', 'contracts'];
const FINANCE_TABS: FinanceTabId[] = ['dashboard', 'income', 'expenses', 'payments'];

export const getSafeAdministrativeTab = (value?: string | null): AdministrativeModuleTabId =>
  ADMINISTRATIVE_TABS.includes(value as AdministrativeModuleTabId) ? (value as AdministrativeModuleTabId) : 'registrations';

export const getSafeFinanceTab = (value?: string | null): FinanceTabId =>
  FINANCE_TABS.includes(value as FinanceTabId) ? (value as FinanceTabId) : 'dashboard';
