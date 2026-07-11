
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { AxsysFullLogo, AxsysMarkIcon } from '../components/AxsysBrand';
import { getPostLoginPath } from '../utils/auth.ts';
import { LOGIN_BRANDING } from '../utils/loginBranding.ts';

const EmailIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
  </svg>
);

const PasswordIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
);

export const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
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
      const user = await login(email, password);
      navigate(getPostLoginPath(user.role), { replace: true });
    } catch (err: any) {
      setError(err.message || 'Falha ao realizar login');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-slate-50 text-slate-900 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(460px,0.95fr)]">
      <section className="login-brand-panel relative hidden min-h-[100dvh] overflow-hidden bg-[#111820] lg:flex lg:items-center lg:justify-center">
        <div className="relative z-10 flex w-full max-w-[560px] flex-col px-12">
          <div className="login-logo-glow flex justify-center">
            <AxsysFullLogo />
          </div>

          <div className="mt-20 h-1 w-44 bg-[linear-gradient(90deg,#38bdf8_0%,#8b5cf6_50%,#f97316_100%)]" aria-hidden="true" />
          <p className="mt-7 text-sm font-semibold text-slate-300">{LOGIN_BRANDING.securityLabel}</p>
          <p className="mt-3 max-w-[34rem] text-sm leading-6 text-slate-400">{LOGIN_BRANDING.securityText}</p>
        </div>
      </section>

      <section className="login-surface-grid flex min-h-[100dvh] w-full items-center justify-center px-6 py-10 sm:px-8 lg:px-16 xl:px-24">
        <div className="w-full max-w-[430px]">
          <div className="mb-9 flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-950 p-2.5 shadow-[0_18px_34px_-22px_rgba(15,23,42,0.9)]">
              <AxsysMarkIcon className="h-full w-full" decorative />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-950">AXSYS</p>
              <p className="mt-1 text-sm text-slate-500">{LOGIN_BRANDING.formEyebrow}</p>
            </div>
          </div>

          <div className="login-brand-panel relative -mx-6 mb-10 flex justify-center overflow-hidden px-6 py-10 sm:-mx-8 sm:px-8 lg:hidden">
            <AxsysFullLogo className="login-logo-glow relative z-10" size="mobile" />
          </div>

          <div className="mb-10">
            <h1 className="text-4xl font-extrabold leading-tight text-slate-950 sm:text-[2.65rem]">
              {LOGIN_BRANDING.title}
            </h1>
            <p className="mt-4 max-w-[28rem] text-base leading-6 text-slate-600">
              {LOGIN_BRANDING.subtitle}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <Input
              label="E-mail corporativo"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@axsys.com"
              required
              icon={<EmailIcon />}
            />

            <div>
              <Input
                label="Senha"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                icon={<PasswordIcon />}
              />
              <div className="mt-2 flex items-center justify-between gap-4">
                <div className="flex items-center">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-700">
                    Lembrar-me
                  </label>
                </div>
                <button type="button" className="text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700">
                  Esqueceu a senha?
                </button>
              </div>
            </div>

            {error && (
              <div className="animate-fade-in-down rounded-xl border border-red-100 bg-red-50 p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <h2 className="text-sm font-semibold text-red-800">{error}</h2>
                  </div>
                </div>
              </div>
            )}

            <Button
              type="submit"
              fullWidth
              isLoading={isLoading}
              className="h-14 rounded-xl border-0 bg-[linear-gradient(100deg,#3b82f6_0%,#7c3aed_48%,#f97316_100%)] py-3 font-bold shadow-[0_18px_38px_-18px_rgba(37,99,235,0.65)] transition-all duration-200 hover:-translate-y-0.5 hover:opacity-95 hover:shadow-[0_22px_44px_-20px_rgba(249,115,22,0.55)] active:translate-y-0"
            >
              Entrar no Sistema
            </Button>
          </form>

          <div className="mt-8 flex flex-col gap-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>Acesso protegido por autenticação corporativa</p>
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
              {LOGIN_BRANDING.connectionLabel}
            </span>
          </div>
        </div>
      </section>
    </main>
  );
};
