export interface RegisteredUserInput {
  firstName?: string;
  corporateName?: string;
  username?: string;
  email: string;
  password?: string;
  role?: string;
  companyId?: string;
  allowedModules?: string[];
}

export interface StoredUserRecord {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: string;
  companyId?: string;
  allowedModules: string[];
  avatarUrl: string;
}

export interface SessionUserRecord {
  id: string;
  email: string;
}

export const buildRegisteredUserRecord = (
  data: RegisteredUserInput,
  id: string,
): StoredUserRecord => {
  const displayName = data.firstName || data.corporateName || data.username || 'Usuário';

  return {
    id,
    name: displayName,
    email: data.email,
    password: data.password,
    role: data.role || 'USER',
    companyId: data.companyId,
    allowedModules: data.allowedModules || ['administrative'],
    avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName || 'U')}&background=random&color=fff`,
  };
};

export const applyPasswordReset = <T extends { id: string; password?: string }>(
  users: T[],
  userId: string,
  newPassword: string,
) => users.map((user) => (user.id === userId ? { ...user, password: newPassword } : user));

export const getPostLoginPath = (role?: string) => {
  return role === 'SUPER_ADMIN' ? '/super-admin' : '/dashboard';
};

export const reconcileStoredSessionUser = <T extends SessionUserRecord>(
  storedUser: T | null | undefined,
  currentUsers: T[],
) => {
  if (!storedUser) {
    return null;
  }

  const normalizedEmail = storedUser.email.toLowerCase();
  const freshUser = currentUsers.find((user) => user.id === storedUser.id)
    || currentUsers.find((user) => user.email.toLowerCase() === normalizedEmail);

  return freshUser || null;
};
