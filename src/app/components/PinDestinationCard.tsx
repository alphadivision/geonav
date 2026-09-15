'use client';

import React, { useCallback } from 'react';
import type { PinDestination } from '@/types';
import type { Translations } from '@/lib/i18n';
import { MapPin, Navigation, X } from 'lucide-react';

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
  const handleNavigate = useCallback(() => {
    onNavigate();
  }, [onNavigate]);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const coordLabel = `${pin.coordinates[1].toFixed(5)}, ${pin.coordinates[0].toFixed(5)}`;

  return (
    <div className="glass-dark border-t border-border/40 shadow-2xl shadow-black/60">
      <div className="px-4 sm:px-5 py-3 sm:py-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-danger/20 flex items-center justify-center mt-0.5">
            <MapPin size={18} className="text-danger" />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
              {t.tapDestination}
            </p>
            {pin.address ? (
              <p className="text-sm font-semibold text-foreground leading-tight truncate">
                {pin.address}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {coordLabel}
              </p>
            )}
            {pin.address && (
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {coordLabel}
              </p>
            )}
          </div>

          {/* Cancel */}
          <button
            onClick={handleCancel}
            className="flex-shrink-0 touch-target rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors duration-150 active:scale-95"
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
            'w-full mt-3 flex items-center justify-center gap-2',
            'py-3.5 rounded-xl',
            'text-sm font-bold',
            'transition-all duration-200 active:scale-[0.98]',
            isCalculating
              ? 'bg-primary/50 text-primary-foreground/70 cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/30',
          ].join(' ')}
        >
          <Navigation size={18} strokeWidth={2.5} />
          <span>{isCalculating ? t.calculating : t.navigateHere}</span>
        </button>
      </div>
    </div>
  );
}
