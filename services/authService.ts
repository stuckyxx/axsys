
import { User, UserRole, SystemModule } from '../types.ts';
import { applyPasswordReset, buildRegisteredUserRecord } from '../utils/auth.ts';
import { requestTrackedStorageSync } from './storageScope.ts';

const DB_KEY = 'axsys_users_db_v3'; // Changed key to reset DB

// Mock Data - Base Users (Seeds for the DB)
const ADMIN_USER: User = {
  id: 'u-admin-001',
  name: 'Gicivaldo Machado',
  email: 'admin@axsys.com',
  password: 'g1c1v4ld0',
  role: UserRole.SUPER_ADMIN,
  allowedModules: [
    SystemModule.ADMINISTRATIVE, 
    SystemModule.FINANCIAL, 
    SystemModule.CERTIFICATES, 
    SystemModule.SYSTEM_ADMIN
  ], 
  avatarUrl: 'https://i.pravatar.cc/150?u=admin'
};

const GABRIEL_USER: User = {
  id: 'u-gabriel-001',
  name: 'Gabriel Machado',
  email: 'gabrielmachado.tkd@gmail.com',
  password: 'g1c1v4ld0',
  role: UserRole.SUPER_ADMIN,
  allowedModules: [
    SystemModule.ADMINISTRATIVE, 
    SystemModule.FINANCIAL, 
    SystemModule.CERTIFICATES, 
    SystemModule.SYSTEM_ADMIN
  ], 
  avatarUrl: 'https://i.pravatar.cc/150?u=gabriel'
};

// --- Database Helper Functions ---

const loadDatabase = (): User[] => {
  const stored = localStorage.getItem(DB_KEY);
  if (stored) {
    return JSON.parse(stored);
  }
  // Initialize DB if empty
  const initialDB = [ADMIN_USER, GABRIEL_USER];
  localStorage.setItem(DB_KEY, JSON.stringify(initialDB));
  requestTrackedStorageSync(DB_KEY);
  return initialDB;
};

const saveDatabase = (users: User[]) => {
  localStorage.setItem(DB_KEY, JSON.stringify(users));
  requestTrackedStorageSync(DB_KEY);
  // Update the exported mutable array to keep sync in memory
  MOCK_USERS_DB.length = 0;
  MOCK_USERS_DB.push(...users);
};

// Mutable array exposing the current state (initialized from DB)
export const MOCK_USERS_DB: User[] = loadDatabase();

/**
 * Helper to get fresh data from DB
 */
export const getAllUsers = async (): Promise<User[]> => {
  return new Promise((resolve) => {
    // Simulate network delay
    setTimeout(() => {
      resolve(loadDatabase());
    }, 300);
  });
};

/**
 * Simulates Login by checking against the Persistent Database
 */
export const loginMock = async (email: string, password?: string): Promise<User> => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const currentDB = loadDatabase();
      // Case-insensitive email check
      const user = currentDB.find(u => u.email.toLowerCase() === email.toLowerCase());
      
      if (user) {
        if (user.password && user.password !== password) {
          reject(new Error('Credenciais inválidas. Senha incorreta.'));
        } else {
          resolve(user);
        }
      } else {
        reject(new Error('Credenciais inválidas. Usuário não encontrado.'));
      }
    }, 800);
  });
};

/**
 * Register User - Persists to LocalStorage
 */
export const registerMock = async (data: any): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const currentDB = loadDatabase();

      const newUser: User = buildRegisteredUserRecord(
        {
          firstName: data.firstName,
          corporateName: data.corporateName,
          username: data.username,
          email: data.email,
          password: data.password,
          role: data.role || UserRole.USER,
          companyId: data.companyId,
          allowedModules: data.allowedModules || [SystemModule.ADMINISTRATIVE],
        },
        `u-${Date.now().toString(36)}`,
      ) as User;

      currentDB.push(newUser);
      saveDatabase(currentDB);
      
      console.log("User Registered & Saved to DB:", newUser);
      resolve();
    }, 1500);
  });
};

/**
 * Update User Permissions - Persists to LocalStorage
 */
export const updateUserModulesMock = async (userId: string, modules: SystemModule[]): Promise<User> => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const currentDB = loadDatabase();
      const userIndex = currentDB.findIndex(u => u.id === userId);
      
      if (userIndex !== -1) {
        currentDB[userIndex].allowedModules = modules;
        saveDatabase(currentDB); // Persist changes
        resolve({ ...currentDB[userIndex] });
      } else {
        reject(new Error("User not found"));
      }
    }, 500);
  });
};

/**
 * Update User Details (Name, Email, etc)
 */
export const updateUserDetailsMock = async (userId: string, data: Partial<User>): Promise<User> => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const currentDB = loadDatabase();
      const userIndex = currentDB.findIndex(u => u.id === userId);
      
      if (userIndex !== -1) {
        const updatedUser = { ...currentDB[userIndex], ...data };
        currentDB[userIndex] = updatedUser;
        saveDatabase(currentDB);
        resolve(updatedUser);
      } else {
        reject(new Error("User not found"));
      }
    }, 600);
  });
};

/**
 * Admin: Reset User Password (Simulation)
 */
export const resetUserPasswordMock = async (userId: string, newPassword: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
        const currentDB = loadDatabase();
        const user = currentDB.find(u => u.id === userId);
        
        if (user) {
            const updatedUsers = applyPasswordReset(currentDB, userId, newPassword) as User[];
            saveDatabase(updatedUsers);
            resolve();
        } else {
            reject(new Error("Usuário não encontrado para redefinir senha."));
        }
    }, 800);
  });
};

/**
 * Admin: Delete User
 */
export const deleteUserMock = async (userId: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
        const currentDB = loadDatabase();
        const initialLength = currentDB.length;
        const newDB = currentDB.filter(u => u.id !== userId);
        
        if (newDB.length < initialLength) {
            saveDatabase(newDB);
            resolve();
        } else {
            reject(new Error("Usuário não encontrado."));
        }
    }, 600);
  });
};
