'use client';

import React from 'react';
import { Navigation, X } from 'lucide-react';
import type { RouteInfo } from '@/types';
import type { Language, Translations } from '@/lib/i18n';
import { formatDistance, formatDuration } from '@/lib/geolocation';

interface NavigationHUDProps {
  destinationName: string;
  routeInfo: RouteInfo | null;
  language: Language;
  t: Translations;
  onExit: () => void;
}

// Small, always-on-top navigation status bar shown while Navigation Mode is
// active. Deliberately compact — the map stays the main visual element, this
// never grows into a page-covering panel.
export default function NavigationHUD({ destinationName, routeInfo, language, t, onExit }: NavigationHUDProps) {
  return (
    <div
      className="glass-panel rounded-2xl overflow-hidden shadow-2xl shadow-black/70"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center">
          <Navigation size={16} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white leading-tight truncate">{destinationName}</p>
          {routeInfo && (
            <p className="text-xs text-muted-foreground mt-0.5 text-tabular">
              {formatDistance(routeInfo.distance, language)} · {formatDuration(routeInfo.duration, language)}
            </p>
          )}
        </div>
        <button
          onClick={onExit}
          className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl text-muted-foreground hover:text-white hover:bg-white/10 transition-colors active:scale-95"
          aria-label={t.exitNavigation}
          title={t.exitNavigation}
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
