'use client';

import React, { useCallback } from 'react';
import type { PinDestination } from '@/types';
import type { Translations } from '@/lib/i18n';
import { MapPin, Navigation, X, Loader2 } from 'lucide-react';

interface PinDestinationCardProps {
  pin: PinDestination;
  t: Translations;
  onNavigate: () => void;
  onCancel: () => void;
  isCalculating?: boolean;
}

export default function PinDestinationCard({
  pin,
  t,
  onNavigate,
  onCancel,
  isCalculating = false,
}: PinDestinationCardProps) {
  const handleNavigate = useCallback(() => { onNavigate(); }, [onNavigate]);
  const handleCancel = useCallback(() => { onCancel(); }, [onCancel]);

  const coordLabel = `${pin.coordinates[1].toFixed(5)}, ${pin.coordinates[0].toFixed(5)}`;

  return (
    <div
      className="glass-panel mx-3 mb-3 rounded-2xl overflow-hidden shadow-2xl shadow-black/70"
    >
      <div className="px-4 py-3">
        <div className="flex items-center gap-3 mb-3">
          {/* Icon */}
          <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-danger/20 flex items-center justify-center">
            <MapPin size={17} className="text-danger" />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-none mb-0.5">
              {t.tapDestination}
            </p>
            {pin.address ? (
              <p className="text-sm font-bold text-white leading-tight truncate">{pin.address}</p>
            ) : (
              <p className="text-xs text-muted-foreground font-mono">{coordLabel}</p>
            )}
            {pin.address && (
              <p className="text-[10px] text-muted-foreground font-mono">{coordLabel}</p>
            )}
          </div>

          {/* Cancel */}
          <button
            onClick={handleCancel}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors active:scale-95"
            aria-label={t.cancelPin}
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigate button */}
        <button
          onClick={handleNavigate}
          disabled={isCalculating}
          className={[
            'w-full flex items-center justify-center gap-2',
            'py-3 rounded-xl text-sm font-bold',
            'transition-all duration-200 active:scale-[0.98]',
            isCalculating
              ? 'bg-primary/50 text-primary-foreground/70 cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/30',
          ].join(' ')}
        >
          {isCalculating
            ? <><Loader2 size={16} className="spinner" /><span>{t.calculating}</span></>
            : <><Navigation size={16} strokeWidth={2.5} /><span>{t.navigateHere}</span></>}
        </button>
      </div>
    </div>
  );
}
