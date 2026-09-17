'use client';

import React, { useState, useCallback } from 'react';
import type { RouteAlternative } from '@/types';
import type { Translations } from '@/lib/i18n';
import type { Language } from '@/lib/i18n';
import { formatDistance, formatDuration } from '@/lib/geolocation';
import { Zap, Navigation, X, ChevronDown, ChevronUp } from 'lucide-react';

interface RouteAlternativesPanelProps {
  routes: RouteAlternative[];
  selectedIndex: number;
  language: Language;
  t: Translations;
  onSelectRoute: (index: number) => void;
  onClear: () => void;
  onStartNavigation: () => void;
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
  onStartNavigation,
  destinationName,
}: RouteAlternativesPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const handleSelect = useCallback(
    (index: number) => { onSelectRoute(index); },
    [onSelectRoute]
  );

  if (routes.length === 0) return null;

  const selectedRoute = routes.find((r) => r.index === selectedIndex) ?? routes[0];

  const cardStyle = {
    backdropFilter: 'blur(16px)',
    background: 'rgba(18,18,24,0.88)',
    border: '1px solid rgba(255,255,255,0.10)',
  };

  // ── Collapsed bar ──────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div
        className="mx-3 mb-3 rounded-2xl overflow-hidden shadow-2xl shadow-black/70"
        style={cardStyle}
      >
        <div
          onClick={() => setCollapsed(false)}
          className="w-full flex items-center gap-3 px-4 py-3 active:opacity-80 transition-opacity cursor-pointer"
          aria-label="Expand route panel"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setCollapsed(false); }}
        >
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Navigation size={15} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-bold text-white leading-tight truncate">{destinationName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatDistance(selectedRoute.distance, language)} · {formatDuration(selectedRoute.duration, language)}
            </p>
          </div>
          <ChevronUp size={18} className="flex-shrink-0 text-muted-foreground" />
          <button
            onClick={(e) => { e.stopPropagation(); onStartNavigation(); }}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-bold active:scale-95 transition-transform"
            aria-label={t.startRoute}
          >
            <Navigation size={13} />
            {t.startRoute}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors active:scale-95"
            aria-label={t.clearDestination}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  // ── Expanded panel ─────────────────────────────────────────────────────────
  return (
    <div
      className="mx-3 mb-3 rounded-2xl overflow-hidden shadow-2xl shadow-black/70"
      style={cardStyle}
    >
      {/* Active route indicator */}
      <div className="h-0.5 bg-primary w-full" />

      <div className="px-4 py-3">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <Navigation size={15} className="text-primary flex-shrink-0" />
          <span className="flex-1 text-sm font-semibold text-white truncate">{destinationName}</span>
          <button
            onClick={() => setCollapsed(true)}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors active:scale-95"
            aria-label="Minimize route panel"
          >
            <ChevronDown size={18} />
          </button>
          <button
            onClick={onClear}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors active:scale-95"
            aria-label={t.clearDestination}
          >
            <X size={18} />
          </button>
        </div>

        {/* Route options */}
        <div className="flex flex-col gap-1.5">
          {routes.map((route) => {
            const isSelected = route.index === selectedIndex;
            return (
              <button
                key={route.index}
                onClick={() => handleSelect(route.index)}
                className={[
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl',
                  'text-left transition-all duration-150 active:scale-[0.98]',
                  isSelected
                    ? 'bg-primary/20 border border-primary/50' :'bg-white/5 border border-white/8 hover:bg-white/10',
                ].join(' ')}
              >
                <div className={[
                  'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm',
                  isSelected ? 'bg-primary/30' : 'bg-white/10',
                ].join(' ')}>
                  {route.isFastest
                    ? <Zap size={14} className={isSelected ? 'text-primary' : 'text-yellow-400'} />
                    : <span className="text-xs">{getRoadTypeIcon(route.roadType)}</span>}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={['text-xs font-semibold', isSelected ? 'text-primary' : 'text-white'].join(' ')}>
                      {route.isFastest ? t.fastest : t.alternative}
                    </span>
                    {route.isFastest && (
                      <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1 py-0.5 rounded font-medium">★</span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">{getRoadTypeLabel(route.roadType, t)}</p>
                </div>

                <div className="flex-shrink-0 text-right">
                  <p className={['text-xs font-bold text-tabular', isSelected ? 'text-white' : 'text-white/80'].join(' ')}>
                    {formatDistance(route.distance, language)}
                  </p>
                  <p className={['text-[10px] font-semibold text-tabular', isSelected ? 'text-accent' : 'text-muted-foreground'].join(' ')}>
                    {formatDuration(route.duration, language)}
                  </p>
                </div>

                {isSelected && <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-primary ml-0.5" />}
              </button>
            );
          })}
        </div>

        {/* Start Route — enters live turn-by-turn Navigation Mode */}
        <button
          onClick={onStartNavigation}
          className="w-full mt-3 flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-lg shadow-primary/30 hover:bg-primary/90 active:scale-[0.98] transition-all"
        >
          <Navigation size={17} />
          {t.startRoute}
        </button>
      </div>
    </div>
  );
}
