'use client';

import React, { useCallback } from 'react';
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
        'glass-dark rounded-2xl touch-target-lg',
        'transition-all duration-150',
        'active:scale-95',
        'shadow-xl shadow-black/40',
        trafficEnabled
          ? 'text-orange-400 bg-orange-500/20 border border-orange-500/40' :'text-foreground hover:text-primary hover:bg-muted/60',
      ].join(' ')}
      aria-label={t.traffic}
      title={t.traffic}
    >
      <span className="text-lg leading-none">🚦</span>
    </button>
  );
}
