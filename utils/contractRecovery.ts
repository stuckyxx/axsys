import type { Contract } from '../types';

export const persistRecoveredContractsSafely = (
    contracts: Contract[],
    persist: (contracts: Contract[]) => void,
): Contract[] => {
    try {
        persist(contracts);
    } catch (error) {
        console.error('Falha ao armazenar contratos recuperados no cache local', error);
    }

    return contracts;
};
