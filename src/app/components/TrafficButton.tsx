'use client';

import React, { useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Translations } from '@/lib/i18n';

interface TrafficButtonProps {
  trafficEnabled: boolean;
  onToggle: () => void;
  t: Translations;
}

export default function TrafficButton({ trafficEnabled, onToggle, t }: TrafficButtonProps) {
  const handleClick = useCallback(() => {
    onToggle();
  }, [onToggle]);

  return (
    <button
      onClick={handleClick}
      className={[
        'rounded-full h-11 px-4',
        'flex items-center gap-2',
        'transition-all duration-150 active:scale-95',
        'shadow-xl shadow-black/40 font-bold text-sm whitespace-nowrap',
        trafficEnabled
          ? 'bg-warning text-black'
          : 'glass-dark text-foreground hover:bg-muted/60',
      ].join(' ')}
      aria-pressed={trafficEnabled}
      aria-label={t.traffic}
      title={t.traffic}
    >
      <AlertTriangle size={18} strokeWidth={2.25} className={trafficEnabled ? 'text-black' : 'text-warning'} />
      {t.traffic}
    </button>
  );
}
