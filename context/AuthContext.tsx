import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { User, AuthState, SystemModule } from '../types';
import { getAllUsers, loginMock } from '../services/authService';
import { initializeRemotePersistence, resetRemotePersistenceScope } from '../services/remotePersistence';
import { reconcileStoredSessionUser } from '../utils/auth.ts';

interface AuthContextType extends AuthState {
  login: (email: string, password?: string) => Promise<User>;
  logout: () => void;
  hasAccess: (module: SystemModule) => boolean;
  refreshUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>(() => {
    const storedUser = localStorage.getItem('sgi_user_v2');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        return { user, isAuthenticated: true, isLoading: false };
      } catch {
        return { user: null, isAuthenticated: false, isLoading: false };
      }
    }
    return { user: null, isAuthenticated: false, isLoading: false };
  });

  const login = async (email: string, password?: string) => {
    setState(prev => ({ ...prev, isLoading: true }));
    try {
      const user = await loginMock(email, password);
      localStorage.setItem('sgi_user_v2', JSON.stringify(user));
      setState({ user, isAuthenticated: true, isLoading: false });
      void initializeRemotePersistence(user).catch((error) => {
        console.error('Falha ao inicializar persistência remota após login', error);
      });
      // In a real app, we would store the JWT token here
      return user;
    } catch (error) {
      setState(prev => ({ ...prev, isLoading: false }));
      throw error;
    }
  };

  const logout = useCallback(() => {
    resetRemotePersistenceScope();
    localStorage.removeItem('sgi_user_v2');
    setState({ user: null, isAuthenticated: false, isLoading: false });
  }, []);

  const hasAccess = useCallback((module: SystemModule) => {
    if (!state.user) return false;
    return state.user.allowedModules.includes(module);
  }, [state.user]);

  const refreshUser = useCallback((updatedUser: User) => {
    // If the currently logged in user is updated (e.g. via admin panel), reflect changes immediately
    if (state.user?.id === updatedUser.id) {
       localStorage.setItem('sgi_user_v2', JSON.stringify(updatedUser));
       void initializeRemotePersistence(updatedUser);
       setState(prev => ({ ...prev, user: updatedUser }));
    }
  }, [state.user]);

  useEffect(() => {
    if (!state.user) {
      return;
    }

    let cancelled = false;

    const syncStoredSession = async () => {
      try {
        const users = await getAllUsers();
        const freshUser = reconcileStoredSessionUser(state.user, users);

        if (cancelled) {
          return;
        }

        if (!freshUser) {
          resetRemotePersistenceScope();
          localStorage.removeItem('sgi_user_v2');
          setState({ user: null, isAuthenticated: false, isLoading: false });
          return;
        }

        const currentSnapshot = JSON.stringify(state.user);
        const freshSnapshot = JSON.stringify(freshUser);

        if (currentSnapshot !== freshSnapshot) {
          localStorage.setItem('sgi_user_v2', JSON.stringify(freshUser));
          await initializeRemotePersistence(freshUser);

          if (!cancelled) {
            setState(prev => ({ ...prev, user: freshUser }));
          }
          return;
        }

        await initializeRemotePersistence(freshUser);
      } catch (error) {
        console.error('Falha ao sincronizar sessão salva com a base de usuários', error);
      }
    };

    void syncStoredSession();

    return () => {
      cancelled = true;
    };
  }, [state.user]);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, hasAccess, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
