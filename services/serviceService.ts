import { Service } from '../types';

const SERVICES_DB_KEY = 'axsys_services_db_v2';

const DEFAULT_SERVICES: Service[] = [];

export const getServices = (): Service[] => {
    const data = localStorage.getItem(SERVICES_DB_KEY);
    if (data) {
        return JSON.parse(data);
    }
    // Set default if not exists
    localStorage.setItem(SERVICES_DB_KEY, JSON.stringify(DEFAULT_SERVICES));
    return DEFAULT_SERVICES;
};

export const saveService = (service: Service): void => {
    const services = getServices();
    const index = services.findIndex(s => s.id === service.id);
    if (index >= 0) {
        services[index] = service;
    } else {
        services.push(service);
    }
    localStorage.setItem(SERVICES_DB_KEY, JSON.stringify(services));
};

export const deleteService = (id: string): void => {
    const services = getServices();
    const filtered = services.filter(s => s.id !== id);
    localStorage.setItem(SERVICES_DB_KEY, JSON.stringify(filtered));
};
