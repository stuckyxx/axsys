
import React, { useId } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({ label, error, icon, className = '', id, ...props }) => {
  const generatedId = useId();
  const inputId = id || props.name || generatedId;

  return (
    <div className="mb-6">
      <label htmlFor={inputId} className="block text-[13px] font-semibold text-slate-600 mb-2 tracking-tight">
        {label}
      </label>
      <div className="relative group">
        {icon && (
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-brand-500 transition-colors">
            {icon}
          </div>
        )}
        <input
          id={inputId}
          className={`block w-full rounded-xl border sm:text-sm py-3 transition-all duration-200 outline-none ${
            icon ? 'pl-11' : 'pl-4'
          } ${
            error 
              ? 'border-red-200 bg-red-50/30 text-red-900 placeholder-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-500/10' 
              : 'border-slate-200 bg-white text-slate-800 placeholder-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 hover:border-slate-300 shadow-sm'
          } ${className}`}
          {...props}
        />
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-600 flex items-center font-medium animate-in fade-in slide-in-from-top-1" id={`${inputId}-error`}>
          <svg className="w-3.5 h-3.5 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
};
