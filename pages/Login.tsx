
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';
import { Input } from '../components/Input';

// Axsys Large Logo Component for Login
const AxsysLogoLarge = () => (
    <svg className="w-24 h-24 mb-6" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="axsysGradientLarge" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#f97316" />
        </linearGradient>
      </defs>
      <path d="M20 90 L45 20 L55 20 L80 90" stroke="url(#axsysGradientLarge)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M30 65 L70 65" stroke="url(#axsysGradientLarge)" strokeWidth="6" strokeLinecap="round" />
      <path d="M55 45 L85 15 M85 15 L65 15 M85 15 L85 35" stroke="#f97316" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

export const Login: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if(password.length < 3) {
        throw new Error("Senha deve ter no mínimo 3 caracteres");
      }
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Falha ao realizar login');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Left Column - Branding (Dark) */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-brand-900 overflow-hidden items-center justify-center">
        <div className="absolute inset-0 opacity-10" 
             style={{
                backgroundImage: `radial-gradient(#3b82f6 1px, transparent 1px), radial-gradient(#3b82f6 1px, transparent 1px)`,
                backgroundSize: '40px 40px',
                backgroundPosition: '0 0, 20px 20px'
             }}>
        </div>
        <div className="absolute inset-0 bg-gradient-to-br from-brand-900 via-brand-900 to-brand-800 opacity-90"></div>
        
        <div className="relative z-10 p-12 text-center flex flex-col items-center">
          <AxsysLogoLarge />
          
          <h1 className="text-5xl font-extrabold text-white tracking-tight mb-4 font-sans">
            Axsys
          </h1>
          <div className="h-1 w-24 bg-gradient-to-r from-blue-500 via-purple-500 to-orange-500 rounded-full mb-6"></div>
          
          <p className="text-lg text-brand-200 tracking-widest font-light uppercase">
            Technology <span className="text-accent-orange mx-2">|</span> Growth <span className="text-accent-purple mx-2">|</span> Design
          </p>

          <p className="mt-8 text-brand-300 max-w-md mx-auto text-sm leading-relaxed opacity-80">
            Advanced ERP solutions designed to streamline your business operations with cutting-edge technology and intuitive design.
          </p>
        </div>
      </div>

      {/* Right Column - Form (Light) */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-20 xl:px-24 bg-white">
        <div className="mx-auto w-full max-w-sm lg:w-96">
          <div className="lg:hidden mb-10 text-center flex flex-col items-center">
             <AxsysLogoLarge />
             <h2 className="text-3xl font-extrabold text-brand-900">Axsys</h2>
          </div>

          <div>
            <h2 className="text-3xl font-bold text-gray-900">Portal do Usuário</h2>
            <p className="mt-2 text-sm text-gray-600">
              Acesse sua conta para gerenciar seu negócio.
            </p>
          </div>

          <div className="mt-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <Input
                label="E-mail Corporativo"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@axsys.com"
                required
                icon={
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                  </svg>
                }
              />

              <div>
                <Input
                  label="Senha"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  icon={
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  }
                />
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center">
                    <input id="remember-me" name="remember-me" type="checkbox" className="h-4 w-4 text-brand-600 focus:ring-brand-500 border-gray-300 rounded" />
                    <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-900">Lembrar-me</label>
                  </div>
                  <div className="text-sm">
                    <a href="#" className="font-medium text-brand-600 hover:text-brand-500">
                      Esqueceu a senha?
                    </a>
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-md bg-red-50 p-4 border border-red-100 animate-fade-in-down">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-red-800">{error}</h3>
                    </div>
                  </div>
                </div>
              )}

              <Button type="submit" fullWidth isLoading={isLoading} className="py-3 bg-axsys-gradient border-0 hover:opacity-90 transition-opacity">
                Entrar no Sistema
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
