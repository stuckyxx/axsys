import React from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, description, disabled = false }) => {
  return (
    <div className={`flex items-start ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`} onClick={() => !disabled && onChange(!checked)}>
      <div className="flex items-center h-5">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          className={`
            relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500
            ${checked ? 'bg-brand-600' : 'bg-gray-200'}
          `}
        >
          <span
            aria-hidden="true"
            className={`
              pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200
              ${checked ? 'translate-x-5' : 'translate-x-0'}
            `}
          />
        </button>
      </div>
      {(label || description) && (
        <div className="ml-3 text-sm">
          {label && <label className={`font-medium ${checked ? 'text-gray-900' : 'text-gray-600'}`}>{label}</label>}
          {description && <p className="text-gray-500 text-xs mt-0.5">{description}</p>}
        </div>
      )}
    </div>
  );
};