'use client';

import React, { useState } from 'react';
import { MapPin, Navigation, X, Loader2, CheckCircle2, Route, ChevronDown, ChevronUp } from 'lucide-react';
import type { SearchResult, RouteInfo, AppState } from '@/types';
import type { Language } from '@/lib/i18n';
import type { Translations } from '@/lib/i18n';
import { formatDistance, formatDuration } from '@/lib/geolocation';

interface DestinationCardProps {
  destination: SearchResult;
  routeInfo: RouteInfo | null;
  appState: AppState;
  language: Language;
  t: Translations;
  onShowRoute: () => void;
  onClear: () => void;
}

export default function DestinationCard({
  destination,
  routeInfo,
  appState,
  language,
  t,
  onShowRoute,
  onClear,
}: DestinationCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isCalculating = appState === 'calculatingRoute';
  const isRouteActive = appState === 'routeActive';

  // ── Collapsed bar ──────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div
        className="glass-panel mx-3 mb-3 rounded-2xl overflow-hidden shadow-2xl shadow-black/70"
      >
        <button
          onClick={() => setCollapsed(false)}
          className="w-full flex items-center gap-3 px-4 py-3 active:opacity-80 transition-opacity"
          aria-label="Expand destination panel"
        >
          {/* Icon */}
          <div className={[
            'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center',
            isRouteActive ? 'bg-primary/20' : 'bg-danger/20',
          ].join(' ')}>
            {isRouteActive
              ? <Route size={15} className="text-primary" />
              : <MapPin size={15} className="text-danger" />}
          </div>

          {/* Destination name */}
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-bold text-white leading-tight truncate">
              {destination.name}
            </p>
            {isRouteActive && routeInfo && (
              <p className="text-xs text-muted-foreground font-medium mt-0.5">
                {formatDistance(routeInfo.distance, language)} · {formatDuration(routeInfo.duration, language)}
              </p>
            )}
          </div>

          {/* Expand icon */}
          <ChevronUp size={18} className="flex-shrink-0 text-muted-foreground" />

          {/* Close */}
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors active:scale-95"
            aria-label={t.clearDestination}
          >
            <X size={16} />
          </button>
        </button>
      </div>
    );
  }

  // ── Expanded compact panel ─────────────────────────────────────────────────
  return (
    <div
      className="glass-panel mx-3 mb-3 rounded-2xl overflow-hidden shadow-2xl shadow-black/70"
    >
      {/* Active route indicator */}
      {isRouteActive && <div className="h-0.5 bg-primary w-full" />}

      <div className="px-4 py-3">
        {/* Header row */}
        <div className="flex items-center gap-2 mb-2">
          {/* Icon */}
          <div className={[
            'flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center',
            isRouteActive ? 'bg-primary/20' : 'bg-danger/20',
          ].join(' ')}>
            {isRouteActive
              ? <Route size={17} className="text-primary" />
              : <MapPin size={17} className="text-danger" />}
          </div>

          {/* Destination info */}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-none mb-0.5">
              {isRouteActive ? t.drivingRoute : t.destination}
            </p>
            <p className="text-sm font-bold text-white leading-tight truncate">
              {destination.name}
            </p>
            {!isRouteActive && (
              <p className="text-xs text-muted-foreground truncate leading-tight">
                {destination.address}
              </p>
            )}
          </div>

          {/* Collapse button */}
          <button
            onClick={() => setCollapsed(true)}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors active:scale-95"
            aria-label="Minimize destination panel"
          >
            <ChevronDown size={18} />
          </button>

          {/* Close button */}
          <button
            onClick={onClear}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors active:scale-95"
            aria-label={t.clearDestination}
          >
            <X size={18} />
          </button>
        </div>

        {/* Route stats — visible when route is active */}
        {isRouteActive && routeInfo && (
          <div className="flex items-center gap-3 mb-2 px-1">
            <div className="flex-1">
              <p className="text-[10px] text-muted-foreground font-medium mb-0.5">{t.distance}</p>
              <p className="text-lg font-bold text-white text-tabular leading-tight">
                {formatDistance(routeInfo.distance, language)}
              </p>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="flex-1">
              <p className="text-[10px] text-muted-foreground font-medium mb-0.5">{t.duration}</p>
              <p className="text-lg font-bold text-accent text-tabular leading-tight">
                {formatDuration(routeInfo.duration, language)}
              </p>
            </div>
            <div className="flex-shrink-0 flex items-center gap-1 bg-accent/15 rounded-lg px-2.5 py-1.5">
              <CheckCircle2 size={13} className="text-accent" />
              <span className="text-[11px] font-semibold text-accent">{t.routeReady}</span>
            </div>
          </div>
        )}

        {/* Navigate action */}
        {!isRouteActive && (
          <button
            onClick={onShowRoute}
            disabled={isCalculating}
            className={[
              'w-full flex items-center justify-center gap-2',
              'py-3 rounded-xl',
              'text-sm font-bold',
              'transition-all duration-200 active:scale-[0.98]',
              isCalculating
                ? 'bg-primary/50 text-primary-foreground/70 cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/30',
            ].join(' ')}
            aria-label={isCalculating ? t.calculating : t.showRoute}
          >
            {isCalculating ? (
              <><Loader2 size={18} className="spinner" /><span>{t.calculating}</span></>
            ) : (
              <><Navigation size={18} strokeWidth={2.5} /><span>{t.showRoute}</span></>
            )}
          </button>
        )}

        {/* Clear route option when route is active */}
        {isRouteActive && (
          <button
            onClick={onClear}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:text-white hover:bg-white/5 transition-colors active:scale-[0.98]"
          >
            <X size={13} />
            <span>{t.clearRoute}</span>
          </button>
        )}
      </div>
    </div>
  );
}