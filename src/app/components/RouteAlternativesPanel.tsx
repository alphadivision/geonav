'use client';

import React, { useCallback } from 'react';
import type { RouteAlternative } from '@/types';
import type { Translations } from '@/lib/i18n';
import type { Language } from '@/lib/i18n';
import { formatDistance, formatDuration } from '@/lib/geolocation';
import { Zap, Navigation, X } from 'lucide-react';

interface RouteAlternativesPanelProps {
  routes: RouteAlternative[];
  selectedIndex: number;
  language: Language;
  t: Translations;
  onSelectRoute: (index: number) => void;
  onClear: () => void;
  destinationName: string;
}

function getRoadTypeLabel(roadType: RouteAlternative['roadType'], t: Translations): string {
  switch (roadType) {
    case 'highway': return t.highway;
    case 'mainRoad': return t.mainRoad;
    case 'localRoad': return t.localRoad;
  }
}

function getRoadTypeIcon(roadType: RouteAlternative['roadType']): string {
  switch (roadType) {
    case 'highway': return '🛣️';
    case 'mainRoad': return '🚗';
    case 'localRoad': return '🏘️';
  }
}

export default function RouteAlternativesPanel({
  routes,
  selectedIndex,
  language,
  t,
  onSelectRoute,
  onClear,
  destinationName,
}: RouteAlternativesPanelProps) {
  const handleSelect = useCallback(
    (index: number) => {
      onSelectRoute(index);
    },
    [onSelectRoute]
  );

  if (routes.length === 0) return null;

  return (
    <div className="glass-dark border-t border-border/40 shadow-2xl shadow-black/60">
      {/* Active route indicator bar */}
      <div className="h-1 bg-primary w-full" />

      <div className="px-4 sm:px-5 py-3 sm:py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Navigation size={16} className="text-primary" />
            <span className="text-sm font-semibold text-foreground truncate max-w-[180px] sm:max-w-[280px]">
              {destinationName}
            </span>
          </div>
          <button
            onClick={onClear}
            className="touch-target rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors duration-150 active:scale-95"
            aria-label={t.clearDestination}
          >
            <X size={18} />
          </button>
        </div>

        {/* Route options */}
        <div className="flex flex-col gap-2">
          {routes.map((route) => {
            const isSelected = route.index === selectedIndex;
            return (
              <button
                key={route.index}
                onClick={() => handleSelect(route.index)}
                className={[
                  'w-full flex items-center gap-3 px-3 py-3 rounded-xl',
                  'text-left transition-all duration-150',
                  'active:scale-[0.98]',
                  isSelected
                    ? 'bg-primary/20 border border-primary/50 shadow-sm shadow-primary/20'
                    : 'bg-white/5 border border-white/10 hover:bg-white/10',
                ].join(' ')}
              >
                {/* Route type icon */}
                <div
                  className={[
                    'flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-base',
                    isSelected ? 'bg-primary/30' : 'bg-white/10',
                  ].join(' ')}
                >
                  {route.isFastest ? (
                    <Zap size={16} className={isSelected ? 'text-primary' : 'text-yellow-400'} />
                  ) : (
                    <span>{getRoadTypeIcon(route.roadType)}</span>
                  )}
                </div>

                {/* Route info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className={[
                        'text-sm font-semibold',
                        isSelected ? 'text-primary' : 'text-foreground',
                      ].join(' ')}
                    >
                      {route.isFastest ? t.fastest : t.alternative}
                    </span>
                    {route.isFastest && (
                      <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-md font-medium">
                        ★
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{getRoadTypeLabel(route.roadType, t)}</span>
                  </div>
                </div>

                {/* Distance + Duration */}
                <div className="flex-shrink-0 text-right">
                  <p
                    className={[
                      'text-sm font-bold text-tabular',
                      isSelected ? 'text-foreground' : 'text-foreground/80',
                    ].join(' ')}
                  >
                    {formatDistance(route.distance, language)}
                  </p>
                  <p
                    className={[
                      'text-xs font-semibold text-tabular',
                      isSelected ? 'text-accent' : 'text-muted-foreground',
                    ].join(' ')}
                  >
                    {formatDuration(route.duration, language)}
                  </p>
                </div>

                {/* Selected indicator */}
                {isSelected && (
                  <div className="flex-shrink-0 w-2 h-2 rounded-full bg-primary ml-1" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
