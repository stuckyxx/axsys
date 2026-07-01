import type { Contract, User } from '../types';
import { supabase } from './supabaseClient';
import {
    readCompanyScopedValue,
    resolveCompanyScopedKey,
    writeCompanyScopedValue,
} from './storageScope';
import { persistRecoveredContractsSafely } from '../utils/contractRecovery';

const CONTRACT_DB_KEY = 'axsys_contracts_db_v2';
const APP_STATE_TABLE = 'app_state';

const isContractRecord = (value: unknown): value is Contract => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<Contract>;
    return typeof candidate.id === 'string'
        && typeof candidate.clientId === 'string'
        && typeof candidate.clientName === 'string'
        && typeof candidate.contractNumber === 'string'
        && typeof candidate.object === 'string'
        && typeof candidate.startDate === 'string'
        && typeof candidate.endDate === 'string'
        && typeof candidate.totalValue === 'number'
        && typeof candidate.fileUrl === 'string';
};

const parseContracts = (value: unknown): Contract[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(isContractRecord);
};

const recoverContractsFromRemote = async (
    user?: Pick<User, 'companyId'> | null,
): Promise<Contract[]> => {
    const scopedKey = resolveCompanyScopedKey(CONTRACT_DB_KEY, user);

    const { data, error } = await supabase
        .from(APP_STATE_TABLE)
        .select('key, value, updated_at')
        .in('key', [scopedKey, CONTRACT_DB_KEY])
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('Error recovering contracts from Supabase', error);
        return [];
    }

    const snapshots = (data || [])
        .map((row) => ({
            key: String(row.key),
            updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
            contracts: parseContracts(row.value),
        }))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    const preferredSnapshot = snapshots.find((snapshot) => snapshot.key === scopedKey && snapshot.contracts.length > 0);
    if (preferredSnapshot) {
        return persistRecoveredContractsSafely(
            preferredSnapshot.contracts,
            (contracts) => writeCompanyScopedValue(CONTRACT_DB_KEY, contracts, user),
        );
    }

    const newestSnapshot = snapshots.find((snapshot) => snapshot.contracts.length > 0);
    if (newestSnapshot) {
        return persistRecoveredContractsSafely(
            newestSnapshot.contracts,
            (contracts) => writeCompanyScopedValue(CONTRACT_DB_KEY, contracts, user),
        );
    }

    return [];
};

export const getContracts = async (
    user?: Pick<User, 'companyId'> | null,
): Promise<Contract[]> => {
    try {
        const localContracts = readCompanyScopedValue(CONTRACT_DB_KEY, [], user);
        if (localContracts.length > 0) {
            return localContracts;
        }

        const recoveredContracts = await recoverContractsFromRemote(user);
        if (recoveredContracts.length > 0) {
            return recoveredContracts;
        }

        return localContracts;
    } catch (error) {
        console.error('Error reading contracts', error);
        return [];
    }
};
