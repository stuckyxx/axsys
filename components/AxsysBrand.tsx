import React, { useId } from 'react';
import { LOGIN_BRANDING } from '../utils/loginBranding.ts';

interface AxsysMarkIconProps {
  className?: string;
  decorative?: boolean;
}

interface AxsysFullLogoProps {
  className?: string;
  size?: 'hero' | 'mobile';
}

export const AxsysMarkIcon: React.FC<AxsysMarkIconProps> = ({ className = '', decorative = false }) => {
  const gradientId = useId();
  const glowId = useId();
  const titleId = useId();

  return (
    <svg
      className={className}
      viewBox="0 0 240 210"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-labelledby={decorative ? undefined : titleId}
    >
      {!decorative && <title id={titleId}>{LOGIN_BRANDING.logoAriaLabel}</title>}
      <defs>
        <linearGradient id={`${gradientId}-ribbon`} x1="32" y1="180" x2="214" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1d4ed8" />
          <stop offset="0.32" stopColor="#7c3aed" />
          <stop offset="0.68" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#f97316" />
        </linearGradient>
        <linearGradient id={`${gradientId}-deep`} x1="28" y1="178" x2="124" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#172554" />
          <stop offset="0.5" stopColor="#2563eb" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
        <linearGradient id={`${gradientId}-accent`} x1="128" y1="120" x2="184" y2="184" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="0.5" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
        <filter id={`${glowId}-soft`} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#0f172a" floodOpacity="0.28" />
          <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#38bdf8" floodOpacity="0.16" />
        </filter>
      </defs>

      <g filter={`url(#${glowId}-soft)`}>
        <path
          d="M34 174L104 42L132 104L113 121L101 93L60 174H34Z"
          fill={`url(#${gradientId}-deep)`}
        />
        <path
          d="M61 174H96L184 72L142 61L213 25L198 103L178 80L109 174H61Z"
          fill={`url(#${gradientId}-ribbon)`}
        />
        <path
          d="M134 122L155 101L197 174H169L134 122Z"
          fill={`url(#${gradientId}-accent)`}
        />
        <path
          d="M104 42L132 104L113 121L101 93L60 174"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M96 174L184 72L142 61L213 25"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
};

export const AxsysFullLogo: React.FC<AxsysFullLogoProps> = ({ className = '', size = 'hero' }) => {
  const isHero = size === 'hero';
  const markClass = isHero ? 'w-[19rem] max-w-full' : 'w-[15rem] max-w-full';
  const wordClass = isHero ? 'text-[4.7rem] leading-none' : 'text-[3.8rem] leading-none';
  const taglineClass = isHero ? 'mt-5 text-base' : 'mt-4 text-sm';

  return (
    <div className={`inline-flex flex-col items-center ${className}`} role="img" aria-label={LOGIN_BRANDING.logoAriaLabel}>
      <AxsysMarkIcon className={markClass} decorative />
      <div className={`mt-4 flex items-baseline font-extrabold text-white ${wordClass}`}>
        <span>A</span>
        <span className="mx-1 bg-[linear-gradient(135deg,#2563eb_0%,#8b5cf6_50%,#22d3ee_100%)] bg-clip-text text-transparent">x</span>
        <span>sys</span>
      </div>
      <p className={`${taglineClass} font-semibold uppercase text-slate-300`}>
        {LOGIN_BRANDING.tagline}
      </p>
    </div>
  );
};
