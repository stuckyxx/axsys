
import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { PermissionPanel } from './pages/PermissionPanel';
import { Administrative } from './pages/Administrative';
import { Finance } from './pages/Finance';
import { Certificates } from './pages/Certificates';
import { Settings } from './pages/Settings';
import { SuperAdminPanel } from './pages/SuperAdminPanel';
import { UserRole } from './types';

const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  return isAuthenticated ? (
    <Layout>{children}</Layout>
  ) : (
    <Navigate to="/login" />
  );
};

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) return null;

  if (!isAuthenticated) return <Navigate to="/login" />;
  
  if (user?.role !== UserRole.COMPANY_ADMIN && user?.role !== UserRole.SUPER_ADMIN) {
    return <Navigate to="/dashboard" />;
  }

  return <Layout>{children}</Layout>;
};

const SuperAdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) return null;

  if (!isAuthenticated) return <Navigate to="/login" />;
  
  if (user?.role !== UserRole.SUPER_ADMIN) {
    return <Navigate to="/dashboard" />;
  }

  return <Layout>{children}</Layout>;
};

const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) return null;

  if (isAuthenticated) {
    if (user?.role === UserRole.SUPER_ADMIN) {
      return <Navigate to="/super-admin" />;
    }
    return <Navigate to="/dashboard" />;
  }

  return <>{children}</>;
};

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route 
            path="/login" 
            element={
              <PublicRoute>
                <Login />
              </PublicRoute>
            } 
          />
          
          <Route 
            path="/dashboard" 
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            } 
          />

          <Route
            path="/admin/permissions"
            element={
              <AdminRoute>
                <PermissionPanel />
              </AdminRoute>
            }
          />

          {/* Hidden Admin-only user creation */}
          <Route
            path="/admin/create-user"
            element={
              <AdminRoute>
                <Register />
              </AdminRoute>
            }
          />

          {/* Super Admin Zone */}
          <Route
            path="/super-admin"
            element={
              <SuperAdminRoute>
                <SuperAdminPanel />
              </SuperAdminRoute>
            }
          />

          {/* New Consolidated Routes */}
          <Route path="/administrative" element={<PrivateRoute><Administrative /></PrivateRoute>} />
          <Route path="/finance" element={<PrivateRoute><Finance /></PrivateRoute>} />
          <Route path="/certificates" element={<PrivateRoute><Certificates /></PrivateRoute>} />
          <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />

          <Route path="*" element={<Navigate to="/dashboard" />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
