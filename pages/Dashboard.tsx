
import React from 'react';
import { useAuth } from '../context/AuthContext';
import { SystemModule } from '../types';
import { Link } from 'react-router-dom';

export const Dashboard: React.FC = () => {
  const { user, hasAccess } = useAuth();

  return (
    <div className="max-w-7xl mx-auto space-y-10 animate-fade-in-up">
      {/* Header Banner - Matching the Image */}
      <div>
        <h1 className="text-3xl font-bold text-gray-700 mb-6">Painel Principal</h1>
        
        <div className="bg-gradient-to-r from-blue-500 to-purple-700 rounded-lg shadow-lg p-8 text-white relative overflow-hidden">
           {/* Abstract Decoration */}
           <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -mr-16 -mt-16"></div>
           <div className="absolute bottom-0 left-0 w-32 h-32 bg-white opacity-5 rounded-full -ml-16 -mb-16"></div>
           
           <div className="relative z-10">
              <h2 className="text-2xl font-bold">Olá {user?.name}, seja bem-vindo(a) de volta!</h2>
              <p className="mt-2 text-blue-100 opacity-90">Utilize os módulos abaixo para navegar pelo sistema.</p>
           </div>
        </div>
      </div>

      {/* Main Modules Section */}
      <div>
         <h2 className="text-xl font-bold text-gray-700 mb-6">Principais Módulos</h2>
         
         <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            
            {/* Módulo Financeiro */}
            {hasAccess(SystemModule.FINANCIAL) && (
              <div className="bg-white rounded-xl shadow-md border border-gray-100 p-8 flex flex-col items-center text-center hover:shadow-xl transition-shadow duration-300">
                 <div className="w-16 h-16 mb-4">
                    <span className="text-5xl">💰</span>
                 </div>
                 <h3 className="text-xl font-bold text-gray-800 mb-2">Financeiro</h3>
                 <p className="text-gray-500 text-sm mb-6 flex-1">
                    Controle suas receitas, despesas e veja o balanço geral.
                 </p>
                 <Link to="/finance" className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-8 rounded shadow transition-colors">
                    Acessar
                 </Link>
              </div>
            )}

            {/* Módulo Administrativo */}
            {hasAccess(SystemModule.ADMINISTRATIVE) && (
              <div className="bg-white rounded-xl shadow-md border border-gray-100 p-8 flex flex-col items-center text-center hover:shadow-xl transition-shadow duration-300">
                 <div className="w-16 h-16 mb-4">
                    <span className="text-5xl">📁</span>
                 </div>
                 <h3 className="text-xl font-bold text-gray-800 mb-2">Administrativo</h3>
                 <p className="text-gray-500 text-sm mb-6 flex-1">
                    Gerencie clientes, serviços, propostas e contratos.
                 </p>
                 <Link to="/administrative" className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-8 rounded shadow transition-colors">
                    Acessar
                 </Link>
              </div>
            )}

            {/* Módulo Certidões */}
            {hasAccess(SystemModule.CERTIFICATES) && (
              <div className="bg-white rounded-xl shadow-md border border-gray-100 p-8 flex flex-col items-center text-center hover:shadow-xl transition-shadow duration-300">
                 <div className="w-16 h-16 mb-4">
                    <span className="text-5xl">📜</span>
                 </div>
                 <h3 className="text-xl font-bold text-gray-800 mb-2">Certidões</h3>
                 <p className="text-gray-500 text-sm mb-6 flex-1">
                    Gerencie e consulte as certidões da sua empresa.
                 </p>
                 <Link to="/certificates" className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-8 rounded shadow transition-colors">
                    Acessar
                 </Link>
              </div>
            )}

         </div>

         {/* Fallback if user has no access (Should not happen ideally) */}
         {(!hasAccess(SystemModule.FINANCIAL) && !hasAccess(SystemModule.ADMINISTRATIVE) && !hasAccess(SystemModule.CERTIFICATES)) && (
            <div className="text-center py-10 bg-gray-100 rounded-lg">
               <p className="text-gray-500">Você não possui módulos habilitados. Contate o administrador.</p>
            </div>
         )}
      </div>
    </div>
  );
};
