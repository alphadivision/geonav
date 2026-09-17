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
      style={{ touchAction: 'manipulation', cursor: 'pointer' }}
      className={[
        'glass-dark rounded-full',
        'transition-all duration-150',
        'active:scale-95',
        'shadow-xl shadow-black/40',
        'flex items-center justify-center',
        'w-11 h-11',
        followMode
          ? 'text-primary bg-primary/20 border border-primary/40' :'text-foreground hover:text-primary hover:bg-muted/60 active:bg-muted',
      ].join(' ')}
      aria-label={t.locateMe}
      title={t.locateMe}
    >
      {/* Navigation arrow icon — filled when follow mode active */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill={followMode ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="3 11 22 2 13 21 11 13 3 11" />
      </svg>
    </button>
  );
}