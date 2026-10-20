import React, { useId } from 'react';

/**
 * StudyHub Official Logo Component
 * 
 * Concept: The Trust Nexus
 * Elements:
 *  1. Shield Crest (Trustworthiness, institutional integrity, verified resources)
 *  2. Ascending Open Book (Knowledge, education, boundless learning)
 *  3. Dynamic Growth Chevron (Upward momentum, "Improve", student success)
 *  4. Intelligence Star Node (Enlightenment, smart discovery, academic beacon)
 *  5. Integrated S-H Monogram flow (Study + Hub)
 * 
 * Slogan: "ACCESS · LEARN · IMPROVE"
 * Theme Color: StudyHub Royal Purple (#aa3bff) paired with Trust Indigo & Cyan
 */

export const StudyHubIconMark = ({
  size = 48,
  theme = 'purple',
  animated = false,
  className = '',
  idPrefix: customIdPrefix,
}) => {
  const generatedId = useId().replace(/:/g, '');
  const id = customIdPrefix || `sh-${generatedId}`;

  // Theme gradient definitions
  const themeGradients = {
    purple: {
      primaryStart: '#aa3bff',
      primaryEnd: '#6366f1',
      secondaryStart: '#c084fc',
      secondaryEnd: '#818cf8',
      accent: '#38bdf8',
      glow: 'rgba(170, 59, 255, 0.45)',
      deepBase: '#4c1d95',
    },
    'trust-navy': {
      primaryStart: '#1d4ed8',
      primaryEnd: '#aa3bff',
      secondaryStart: '#60a5fa',
      secondaryEnd: '#c084fc',
      accent: '#06b6d4',
      glow: 'rgba(37, 99, 235, 0.4)',
      deepBase: '#1e1b4b',
    },
    'cyan-glow': {
      primaryStart: '#06b6d4',
      primaryEnd: '#aa3bff',
      secondaryStart: '#38bdf8',
      secondaryEnd: '#d8b4fe',
      accent: '#f43f5e',
      glow: 'rgba(6, 182, 212, 0.45)',
      deepBase: '#0e7490',
    },
    emerald: {
      primaryStart: '#059669',
      primaryEnd: '#2563eb',
      secondaryStart: '#34d399',
      secondaryEnd: '#60a5fa',
      accent: '#aa3bff',
      glow: 'rgba(16, 185, 129, 0.4)',
      deepBase: '#064e3b',
    },
    white: {
      primaryStart: '#ffffff',
      primaryEnd: '#e2e8f0',
      secondaryStart: '#f8fafc',
      secondaryEnd: '#cbd5e1',
      accent: '#ffffff',
      glow: 'rgba(255, 255, 255, 0.3)',
      deepBase: '#94a3b8',
    },
    dark: {
      primaryStart: '#0f172a',
      primaryEnd: '#334155',
      secondaryStart: '#1e293b',
      secondaryEnd: '#475569',
      accent: '#aa3bff',
      glow: 'rgba(15, 23, 42, 0.15)',
      deepBase: '#020617',
    },
  };

  const currentTheme = themeGradients[theme] || themeGradients.purple;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`inline-block select-none overflow-visible transition-transform duration-300 ${
        animated ? 'hover:scale-105' : ''
      } ${className}`}
      role="img"
      aria-label="StudyHub Logo Emblem"
    >
      <defs>
        {/* Glow drop filter */}
        <filter id={`${id}-glow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy="8"
            stdDeviation="10"
            floodColor={currentTheme.glow}
            floodOpacity="0.6"
          />
        </filter>

        {/* Primary gradient: Left wing & outer shield curve */}
        <linearGradient
          id={`${id}-primary`}
          x1="18"
          y1="18"
          x2="102"
          y2="106"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor={currentTheme.primaryStart} />
          <stop offset="50%" stopColor={currentTheme.primaryEnd} />
          <stop offset="100%" stopColor={currentTheme.deepBase} />
        </linearGradient>

        {/* Secondary gradient: Right wing & ascension flow */}
        <linearGradient
          id={`${id}-secondary`}
          x1="102"
          y1="24"
          x2="30"
          y2="108"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor={currentTheme.secondaryStart} />
          <stop offset="60%" stopColor={currentTheme.primaryStart} />
          <stop offset="100%" stopColor={currentTheme.primaryEnd} />
        </linearGradient>

        {/* Central Arrow / Spire gradient (The "Improve" pillar) */}
        <linearGradient
          id={`${id}-chevron`}
          x1="60"
          y1="24"
          x2="60"
          y2="94"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor={currentTheme.accent} />
          <stop offset="40%" stopColor="#ffffff" />
          <stop offset="100%" stopColor={currentTheme.primaryStart} />
        </linearGradient>

        {/* Subtle glass reflection highlight */}
        <linearGradient
          id={`${id}-highlight`}
          x1="30"
          y1="20"
          x2="80"
          y2="60"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>

        {/* Shield background gradient for container */}
        <radialGradient
          id={`${id}-shield-plate`}
          cx="60"
          cy="56"
          r="54"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor={currentTheme.primaryStart} stopOpacity="0.12" />
          <stop offset="100%" stopColor={currentTheme.primaryEnd} stopOpacity="0.02" />
        </radialGradient>
      </defs>

      {/* Decorative Outer Aura / Subtle Shield Base */}
      <path
        d="M60 8 L100 24 C100 68 84 96 60 112 C36 96 20 68 20 24 Z"
        fill={`url(#${id}-shield-plate)`}
        stroke={currentTheme.primaryStart}
        strokeOpacity="0.22"
        strokeWidth="1.5"
        strokeDasharray="4 2"
      />

      {/* Group with filter glow */}
      <g filter={`url(#${id}-glow)`}>
        {/* LEFT BOOK WING / SHIELD CREST (Represents "ACCESS") */}
        <path
          d="M60 86
             C48 78 30 74 24 50
             C20 34 32 24 44 26
             C52 27.5 57 32 60 40
             C56 50 54 64 60 86 Z"
          fill={`url(#${id}-primary)`}
        />

        {/* Glass specular overlay on left wing */}
        <path
          d="M60 86
             C48 78 30 74 24 50
             C20 34 32 24 44 26
             C52 27.5 57 32 60 40 Z"
          fill={`url(#${id}-highlight)`}
        />

        {/* RIGHT BOOK WING / GRADUATION FLIGHT (Represents "LEARN") */}
        <path
          d="M60 86
             C72 78 90 74 96 50
             C100 34 88 24 76 26
             C68 27.5 63 32 60 40
             C64 50 66 64 60 86 Z"
          fill={`url(#${id}-secondary)`}
        />

        {/* CENTRAL ASCENDING SPIRE / GROWTH ARROW (Represents "IMPROVE") */}
        <path
          d="M60 22
             L71 44
             C66 43 64 45 60 52
             C56 45 54 43 49 44
             Z"
          fill={`url(#${id}-chevron)`}
        />

        {/* Upward Chevron Ribbons (The Stepping Stones of Learning) */}
        <path
          d="M60 52 L68 64 C64 63 62 65 60 70 C58 65 56 63 52 64 Z"
          fill="#ffffff"
          fillOpacity="0.9"
        />

        <path
          d="M60 70 L66 80 C63 79.5 62 81 60 85 C58 81 57 79.5 54 80 Z"
          fill={currentTheme.accent}
        />

        {/* THE SCHOLAR'S SPARK / DISCOVERY STAR AT APEX */}
        <g transform="translate(60, 16)">
          {/* 4-pointed radiant star */}
          <path
            d="M0 -6 C0.5 -1.5 1.5 -0.5 6 0 C1.5 0.5 0.5 1.5 0 6 C-0.5 1.5 -1.5 0.5 -6 0 C-1.5 -0.5 -0.5 -1.5 0 -6 Z"
            fill="#ffffff"
          />
          <circle cx="0" cy="0" r="1.8" fill={currentTheme.accent} />
        </g>

        {/* FOUNDATION ARCH (Institutional Stability & Trust anchor) */}
        <path
          d="M44 94 C52 98 68 98 76 94 C71 100 49 100 44 94 Z"
          fill={currentTheme.primaryStart}
          fillOpacity="0.75"
        />
      </g>
    </svg>
  );
};

/**
 * Main StudyHub Logo Component
 */
export default function StudyHubLogo({
  variant = 'horizontal', // 'horizontal' | 'stacked' | 'mark' | 'badge' | 'minimal'
  theme = 'purple',       // 'purple' | 'trust-navy' | 'cyan-glow' | 'emerald' | 'white' | 'dark'
  size = 'md',            // 'sm' | 'md' | 'lg' | 'xl' | number
  showSlogan = true,
  sloganText = 'ACCESS · LEARN · IMPROVE',
  animated = false,
  className = '',
  onClick,
}) {
  const sizeMap = {
    xs: { icon: 28, text: 'text-lg', slogan: 'text-[9px]' },
    sm: { icon: 36, text: 'text-xl', slogan: 'text-[10px]' },
    md: { icon: 48, text: 'text-2xl', slogan: 'text-xs' },
    lg: { icon: 68, text: 'text-4xl', slogan: 'text-sm' },
    xl: { icon: 96, text: 'text-5xl', slogan: 'text-base' },
  };

  const resolvedSize = typeof size === 'number'
    ? { icon: size, text: size > 60 ? 'text-4xl' : 'text-2xl', slogan: size > 60 ? 'text-sm' : 'text-xs' }
    : sizeMap[size] || sizeMap.md;

  const getTextColor = () => {
    if (theme === 'white') return { primary: 'text-white', secondary: 'text-white/80', slogan: 'text-purple-200' };
    if (theme === 'dark') return { primary: 'text-slate-900', secondary: 'text-slate-700', slogan: 'text-slate-500' };
    return {
      primary: 'text-slate-900 dark:text-white',
      secondary: 'text-purple-600 dark:text-purple-400',
      slogan: 'text-slate-500 dark:text-slate-400',
    };
  };

  const textColors = getTextColor();

  if (variant === 'mark' || variant === 'icon') {
    return (
      <StudyHubIconMark
        size={resolvedSize.icon}
        theme={theme}
        animated={animated}
        className={className}
      />
    );
  }

  if (variant === 'badge') {
    return (
      <div
        onClick={onClick}
        className={`inline-flex flex-col items-center justify-center p-6 rounded-3xl backdrop-blur-xl border transition-all duration-300 ${
          theme === 'white'
            ? 'bg-white/10 border-white/20 text-white'
            : 'bg-white/90 dark:bg-slate-900/90 border-purple-200/50 dark:border-purple-900/50 shadow-2xl shadow-purple-500/10'
        } ${onClick ? 'cursor-pointer hover:scale-102' : ''} ${className}`}
      >
        <StudyHubIconMark
          size={resolvedSize.icon * 1.2}
          theme={theme}
          animated={animated}
        />
        <div className="mt-3 flex items-center gap-0.5 tracking-tight">
          <span className={`font-bold ${resolvedSize.text} ${textColors.primary}`}>Study</span>
          <span className={`font-extrabold ${resolvedSize.text} bg-gradient-to-r from-purple-500 to-indigo-500 bg-clip-text text-transparent`}>
            Hub
          </span>
        </div>
        {showSlogan && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
            <p className={`font-semibold tracking-[0.25em] uppercase text-center ${resolvedSize.slogan} ${textColors.slogan}`}>
              {sloganText}
            </p>
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
          </div>
        )}
      </div>
    );
  }

  if (variant === 'stacked') {
    return (
      <div
        onClick={onClick}
        className={`inline-flex flex-col items-center text-center select-none ${
          onClick ? 'cursor-pointer' : ''
        } ${className}`}
      >
        <StudyHubIconMark
          size={resolvedSize.icon * 1.3}
          theme={theme}
          animated={animated}
        />
        <div className="mt-2.5 flex items-center justify-center tracking-tight">
          <span className={`font-bold ${resolvedSize.text} ${textColors.primary}`}>
            Study
          </span>
          <span className={`font-extrabold ${resolvedSize.text} bg-gradient-to-r from-purple-500 to-indigo-600 bg-clip-text text-transparent ml-0.5`}>
            Hub
          </span>
        </div>
        {showSlogan && (
          <p className={`mt-1 font-semibold tracking-[0.22em] uppercase ${resolvedSize.slogan} ${textColors.slogan}`}>
            {sloganText}
          </p>
        )}
      </div>
    );
  }

  if (variant === 'minimal') {
    return (
      <div
        onClick={onClick}
        className={`inline-flex items-center gap-3 select-none ${
          onClick ? 'cursor-pointer' : ''
        } ${className}`}
      >
        <StudyHubIconMark
          size={resolvedSize.icon}
          theme={theme}
          animated={animated}
        />
        <div className="flex items-center tracking-tight">
          <span className={`font-bold ${resolvedSize.text} ${textColors.primary}`}>
            Study
          </span>
          <span className={`font-extrabold ${resolvedSize.text} bg-gradient-to-r from-purple-500 to-indigo-500 bg-clip-text text-transparent ml-0.5`}>
            Hub
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center gap-3.5 select-none ${
        onClick ? 'cursor-pointer' : ''
      } ${className}`}
    >
      <StudyHubIconMark
        size={resolvedSize.icon}
        theme={theme}
        animated={animated}
      />
      <div className="flex flex-col justify-center">
        <div className="flex items-center tracking-tight leading-none">
          <span className={`font-bold ${resolvedSize.text} ${textColors.primary}`}>
            Study
          </span>
          <span className={`font-extrabold ${resolvedSize.text} bg-gradient-to-r from-purple-500 via-fuchsia-500 to-indigo-500 bg-clip-text text-transparent ml-0.5`}>
            Hub
          </span>
        </div>
        {showSlogan && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-1 h-1 rounded-full bg-purple-500" />
            <span className={`font-semibold tracking-[0.24em] uppercase leading-none ${resolvedSize.slogan} ${textColors.slogan}`}>
              {sloganText}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
