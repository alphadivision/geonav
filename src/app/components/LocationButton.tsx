'use client';

import React from 'react';
import type { Translations } from '@/lib/i18n';

interface LocationButtonProps {
  onLocate: () => void;
  t: Translations;
  followMode?: boolean;
}

export default function LocationButton({ onLocate, t, followMode = false }: LocationButtonProps) {
  return (
    <button
      onClick={onLocate}
      className={[
        'glass-dark rounded-2xl touch-target-lg',
        'transition-all duration-150',
        'active:scale-95',
        'shadow-xl shadow-black/40',
        'flex flex-col items-center justify-center gap-0.5',
        'px-2 py-2 min-w-[52px]',
        followMode
          ? 'text-primary bg-primary/20 border border-primary/40' :'text-foreground hover:text-primary hover:bg-muted/60 active:bg-muted',
      ].join(' ')}
      aria-label={t.locateMe}
      title={t.locateMe}
    >
      {/* Navigation arrow icon — filled when follow mode active */}
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill={followMode ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="3 11 22 2 13 21 11 13 3 11" />
      </svg>
      {/* Label: "ჩემი მდებარეობა" / "My Location" — compact two-line */}
      <span
        className={[
          'text-[8px] font-semibold leading-tight text-center max-w-[48px] break-words',
          followMode ? 'text-primary' : 'text-muted-foreground',
        ].join(' ')}
        style={{ wordBreak: 'break-word', hyphens: 'auto' }}
      >
        {t.locateMe}
      </span>
    </button>
  );
}