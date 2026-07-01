import type { Client, User } from '../types.ts';
import { readCompanyScopedValue, writeCompanyScopedValue } from './storageScope.ts';

const CLIENTS_DB_KEY = 'axsys_clients_db_v2';

const DEFAULT_CLIENTS: Client[] = [];

export const getClients = (
    user?: Pick<User, 'companyId'> | null,
): Client[] => {
    return readCompanyScopedValue(CLIENTS_DB_KEY, DEFAULT_CLIENTS, user);
};

export const saveClient = (
    client: Client,
    user?: Pick<User, 'companyId'> | null,
): void => {
    const clients = getClients(user);
    const index = clients.findIndex(c => c.id === client.id);
    if (index >= 0) {
        clients[index] = client;
    } else {
        clients.push(client);
    }
    writeCompanyScopedValue(CLIENTS_DB_KEY, clients, user);
};

export const deleteClient = (
    id: string,
    user?: Pick<User, 'companyId'> | null,
): void => {
    const clients = getClients(user);
    const filtered = clients.filter(c => c.id !== id);
    writeCompanyScopedValue(CLIENTS_DB_KEY, filtered, user);
};
