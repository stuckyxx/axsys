import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useDailyDeadlineNotifications } from '../hooks/useDailyDeadlineNotifications.ts';
import { SystemModule, UserRole } from '../types';
import { Button } from './Button';
import { Link, useLocation } from 'react-router-dom';
import { NotificationBell } from './notifications/NotificationBell.tsx';

const AxsysLogo = ({ className = "w-8 h-8" }) => (
  <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="axsysGradient" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="50%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#f97316" />
      </linearGradient>
    </defs>
    <path d="M20 90 L45 20 L55 20 L80 90" stroke="url(#axsysGradient)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M30 65 L70 65" stroke="url(#axsysGradient)" strokeWidth="8" strokeLinecap="round" />
    <path d="M55 45 L85 15 M85 15 L65 15 M85 15 L85 35" stroke="#f97316" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Icons = {
  Home: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>,
  Admin: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>,
  Finance: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>,
  Cert: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>,
  Users: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
};

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout, hasAccess } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { alerts, unreadCount, unreadIdsSet, markAllAsReadToday } = useDailyDeadlineNotifications(user);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex font-sans">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-900 bg-opacity-75 md:hidden"
          onClick={() => setSidebarOpen(false)}
        ></div>
      )}

      <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-brand-900 shadow-xl transform transition-transform duration-300 ease-in-out md:translate-x-0 md:static md:inset-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} flex flex-col`}>
        <div className="flex items-center justify-center h-20 border-b border-gray-800 bg-brand-950">
          <div className="flex items-center space-x-3">
             <AxsysLogo className="w-8 h-8" />
             <span className="text-xl font-bold text-white tracking-widest font-sans">Axsys</span>
          </div>
        </div>

        <div className="flex flex-col flex-1 h-full overflow-y-auto pt-4">
          <nav className="flex-1 px-4 space-y-4">
            <Link
              to="/dashboard"
              className={`flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-all duration-200 group ${
                location.pathname === '/dashboard'
                  ? 'bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-md'
                  : 'text-gray-400 hover:bg-brand-800 hover:text-white'
              }`}
            >
              <span className="mr-3"><Icons.Home /></span>
              Painel Principal
            </Link>

            {user.role === UserRole.SUPER_ADMIN && (
              <div className="pt-4 mt-4 border-t border-gray-800">
                <Link
                  to="/super-admin"
                  className={`flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors group ${
                    location.pathname.includes('/super-admin')
                      ? 'bg-red-600 text-white shadow-md'
                      : 'text-gray-400 hover:bg-brand-800 hover:text-white'
                  }`}
                >
                  <span className="mr-3">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                  </span>
                  Gestão de Empresas
                </Link>
              </div>
            )}

            {hasAccess(SystemModule.ADMINISTRATIVE) && (
              <div>
                <p className="px-4 text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Administrativo</p>
                <div className="space-y-1">
                   <Link to="/administrative" className={`flex items-center px-4 py-2 text-sm font-medium rounded-lg ${location.pathname.includes('/administrative') ? 'bg-brand-800 text-white' : 'text-gray-400 hover:text-white hover:bg-brand-800'}`}>
                      <span className="mr-3"><Icons.Admin /></span>
                      Gestão Geral
                   </Link>
                </div>
              </div>
            )}

            {hasAccess(SystemModule.FINANCIAL) && (
              <div>
                <p className="px-4 text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Financeiro</p>
                <div className="space-y-1">
                   <Link to="/finance" className={`flex items-center px-4 py-2 text-sm font-medium rounded-lg ${location.pathname.includes('/finance') ? 'bg-brand-800 text-white' : 'text-gray-400 hover:text-white hover:bg-brand-800'}`}>
                      <span className="mr-3"><Icons.Finance /></span>
                      Controle Financeiro
                   </Link>
                </div>
              </div>
            )}

             {hasAccess(SystemModule.CERTIFICATES) && (
              <div>
                <p className="px-4 text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Contabilidade</p>
                <div className="space-y-1">
                   <Link to="/certificates" className={`flex items-center px-4 py-2 text-sm font-medium rounded-lg ${location.pathname.includes('/certificates') ? 'bg-brand-800 text-white' : 'text-gray-400 hover:text-white hover:bg-brand-800'}`}>
                      <span className="mr-3"><Icons.Cert /></span>
                      Certidões
                   </Link>
                </div>
              </div>
            )}

            {hasAccess(SystemModule.SYSTEM_ADMIN) && user.role !== UserRole.SUPER_ADMIN && (
              <div className="pt-4 mt-4 border-t border-gray-800">
                <Link
                  to="/admin/permissions"
                  className={`flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors group ${
                    location.pathname === '/admin/permissions'
                      ? 'bg-accent-purple text-white shadow-md'
                      : 'text-gray-400 hover:bg-brand-800 hover:text-white'
                  }`}
                >
                  <span className="mr-3"><Icons.Users /></span>
                  Gestão de Usuários
                </Link>
              </div>
            )}
          </nav>

          <div className="border-t border-gray-800 p-4 bg-brand-950 mt-auto">
            <Link to="/settings" className="flex items-center group cursor-pointer hover:bg-brand-900 p-2 -mx-2 rounded-lg transition-colors">
              <div className="relative">
                <img
                  className="h-9 w-9 rounded-full object-cover ring-2 ring-brand-700 group-hover:ring-brand-500 transition-all"
                  src={user.avatarUrl}
                  alt={user.name}
                />
                <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-brand-950"></div>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-white group-hover:text-blue-100 transition-colors">
                  {user.name}
                </p>
                <p className="text-xs font-medium text-gray-500 group-hover:text-gray-400 truncate w-32">
                  {user.role}
                </p>
              </div>
              <div className="ml-auto">
                  <svg className="w-4 h-4 text-gray-500 group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
              </div>
            </Link>
            <div className="mt-2">
              <Button variant="ghost" fullWidth onClick={logout} className="text-xs justify-start px-2 text-red-400 hover:text-red-300 hover:bg-red-900/20">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                Sair
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        <header className="relative z-[70] hidden overflow-visible border-b border-slate-200/80 bg-white/80 backdrop-blur md:block">
          <div className="flex items-center justify-end gap-3 px-6 py-4">
            <NotificationBell
              alerts={alerts}
              unreadCount={unreadCount}
              unreadIdsSet={unreadIdsSet}
              canAccessContracts={hasAccess(SystemModule.ADMINISTRATIVE)}
              canAccessCertificates={hasAccess(SystemModule.CERTIFICATES)}
              onOpen={markAllAsReadToday}
            />
            <Link
              to="/settings"
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">Sessao</p>
                <p className="text-sm font-semibold text-slate-800">{user.name}</p>
              </div>
              <img
                className="h-10 w-10 rounded-full object-cover ring-2 ring-slate-100"
                src={user.avatarUrl}
                alt={user.name}
              />
            </Link>
          </div>
        </header>

        <header className="relative z-[70] flex items-center justify-between overflow-visible border-b border-brand-800 bg-brand-900 p-4 shadow-md md:hidden">
          <div className="flex items-center space-x-2">
            <AxsysLogo className="w-6 h-6" />
            <span className="text-lg font-bold text-white">Axsys</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell
              alerts={alerts}
              unreadCount={unreadCount}
              unreadIdsSet={unreadIdsSet}
              canAccessContracts={hasAccess(SystemModule.ADMINISTRATIVE)}
              canAccessCertificates={hasAccess(SystemModule.CERTIFICATES)}
              onOpen={markAllAsReadToday}
            />
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-md text-gray-300 hover:text-white hover:bg-brand-800 focus:outline-none"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </header>

        <main className="relative z-0 flex-1 overflow-x-hidden overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
};
