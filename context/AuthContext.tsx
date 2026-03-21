import React, { createContext, useContext, useState, useCallback } from 'react';
import { User, AuthState, SystemModule } from '../types';
import { loginMock } from '../services/authService';

interface AuthContextType extends AuthState {
  login: (email: string, password?: string) => Promise<void>;
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
      // In a real app, we would store the JWT token here
      setState({ user, isAuthenticated: true, isLoading: false });
    } catch (error) {
      setState(prev => ({ ...prev, isLoading: false }));
      throw error;
    }
  };

  const logout = useCallback(() => {
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
       setState(prev => ({ ...prev, user: updatedUser }));
    }
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