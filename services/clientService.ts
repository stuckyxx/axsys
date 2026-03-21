import { Client } from '../types';

const CLIENTS_DB_KEY = 'axsys_clients_db_v2';

const DEFAULT_CLIENTS: Client[] = [];

export const getClients = (): Client[] => {
    const data = localStorage.getItem(CLIENTS_DB_KEY);
    if (data) {
        return JSON.parse(data);
    }
    // Set default if not exists
    localStorage.setItem(CLIENTS_DB_KEY, JSON.stringify(DEFAULT_CLIENTS));
    return DEFAULT_CLIENTS;
};

export const saveClient = (client: Client): void => {
    const clients = getClients();
    const index = clients.findIndex(c => c.id === client.id);
    if (index >= 0) {
        clients[index] = client;
    } else {
        clients.push(client);
    }
    localStorage.setItem(CLIENTS_DB_KEY, JSON.stringify(clients));
};

export const deleteClient = (id: string): void => {
    const clients = getClients();
    const filtered = clients.filter(c => c.id !== id);
    localStorage.setItem(CLIENTS_DB_KEY, JSON.stringify(filtered));
};
