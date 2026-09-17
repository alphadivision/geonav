'use client';

import React from 'react';
import type { Translations } from '@/lib/i18n';

interface RecenterButtonProps {
  onRecenter: () => void;
  t: Translations;
  followMode: boolean;
  /** North-Up shows a fixed "N"; Heading-Up shows the rotating-compass arrow
   * icon. Only meaningfully distinguishable while followMode is active — see
   * handleRecenter in NavigationMapClient (tap to recenter, tap again to
   * cycle mode once already following). */
  mapViewMode?: 'northUp' | 'headingUp';
}

export default function RecenterButton({ onRecenter, t, followMode, mapViewMode = 'headingUp' }: RecenterButtonProps) {
  const isNorthUp = followMode && mapViewMode === 'northUp';
  return (
    <button
      onClick={onRecenter}
      className={[
        'glass-dark rounded-full',
        'transition-all duration-150',
        'active:scale-95',
        'shadow-xl shadow-black/40',
        'flex items-center justify-center',
        'w-11 h-11',
        followMode
          ? 'text-primary bg-primary/20 border border-primary/40' :'text-foreground hover:text-primary hover:bg-muted/60 active:bg-muted border border-white/10',
      ].join(' ')}
      aria-label={isNorthUp ? t.northUp : t.recenter}
      title={isNorthUp ? t.northUp : t.recenter}
    >
      {isNorthUp ? (
        <span className="text-sm font-bold leading-none select-none">N</span>
      ) : (
        /* Compass / recenter icon — filled ring with arrow when follow active */
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Outer circle */}
          <circle cx="12" cy="12" r="10" />
          {/* North arrow (filled when follow active) */}
          <polygon
            points="12,4 15,12 12,10 9,12"
            fill={followMode ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.5"
          />
          {/* South arrow */}
          <polygon
            points="12,20 9,12 12,14 15,12"
            fill={followMode ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.5"
            opacity={followMode ? 0.5 : 1}
          />
        </svg>
      )}
    </button>
  );
}
