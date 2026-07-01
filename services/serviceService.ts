import type { Service, User } from '../types.ts';
import { readCompanyScopedValue, writeCompanyScopedValue } from './storageScope.ts';

const SERVICES_DB_KEY = 'axsys_services_db_v2';

const DEFAULT_SERVICES: Service[] = [];

export const getServices = (
    user?: Pick<User, 'companyId'> | null,
): Service[] => {
    return readCompanyScopedValue(SERVICES_DB_KEY, DEFAULT_SERVICES, user);
};

export const saveService = (
    service: Service,
    user?: Pick<User, 'companyId'> | null,
): void => {
    const services = getServices(user);
    const index = services.findIndex(s => s.id === service.id);
    if (index >= 0) {
        services[index] = service;
    } else {
        services.push(service);
    }
    writeCompanyScopedValue(SERVICES_DB_KEY, services, user);
};

export const deleteService = (
    id: string,
    user?: Pick<User, 'companyId'> | null,
): void => {
    const services = getServices(user);
    const filtered = services.filter(s => s.id !== id);
    writeCompanyScopedValue(SERVICES_DB_KEY, filtered, user);
};
