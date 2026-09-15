'use client';

import React from 'react';
import { MapPin, Navigation, X, Loader2, CheckCircle2, Route } from 'lucide-react';
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
  const isCalculating = appState === 'calculatingRoute';
  const isRouteActive = appState === 'routeActive';

  return (
    <div className="glass-dark border-t border-border/40 shadow-2xl shadow-black/60">
      {/* Route active indicator bar */}
      {isRouteActive && (
        <div className="h-1 bg-primary w-full" />
      )}

      <div className="px-4 sm:px-6 py-4 sm:py-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Icon */}
            <div
              className={[
                'flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center mt-0.5',
                isRouteActive ? 'bg-primary/20' : 'bg-danger/20',
              ].join(' ')}
            >
              {isRouteActive ? (
                <Route size={20} className="text-primary" />
              ) : (
                <MapPin size={20} className="text-danger" />
              )}
            </div>

            {/* Destination info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                {isRouteActive ? t.drivingRoute : t.destination}
              </p>
              <p className="text-base sm:text-lg font-bold text-foreground leading-tight truncate">
                {destination.name}
              </p>
              {!isRouteActive && (
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 truncate">
                  {destination.address}
                </p>
              )}
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClear}
            className="flex-shrink-0 touch-target rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors duration-150 active:scale-95"
            aria-label={t.clearDestination}
          >
            <X size={20} />
          </button>
        </div>

        {/* Route stats row — visible when route is active */}
        {isRouteActive && routeInfo && (
          <div className="flex items-center gap-4 mb-4 px-1">
            {/* Distance */}
            <div className="flex-1">
              <p className="text-xs text-muted-foreground font-medium mb-0.5">
                {t.distance}
              </p>
              <p className="text-xl sm:text-2xl font-bold text-foreground text-tabular">
                {formatDistance(routeInfo.distance, language)}
              </p>
            </div>

            {/* Divider */}
            <div className="w-px h-10 bg-border/60" />

            {/* Duration */}
            <div className="flex-1">
              <p className="text-xs text-muted-foreground font-medium mb-0.5">
                {t.duration}
              </p>
              <p className="text-xl sm:text-2xl font-bold text-accent text-tabular">
                {formatDuration(routeInfo.duration, language)}
              </p>
            </div>

            {/* Route ready badge */}
            <div className="flex-shrink-0 flex items-center gap-1.5 bg-accent/15 rounded-xl px-3 py-2">
              <CheckCircle2 size={16} className="text-accent" />
              <span className="text-xs font-semibold text-accent">
                {t.routeReady}
              </span>
            </div>
          </div>
        )}

        {/* Action button */}
        {!isRouteActive && (
          <button
            onClick={onShowRoute}
            disabled={isCalculating}
            className={[
              'w-full flex items-center justify-center gap-3',
              'py-4 sm:py-4.5 rounded-xl',
              'text-base sm:text-lg font-bold',
              'transition-all duration-200',
              'active:scale-[0.98]',
              isCalculating
                ? 'bg-primary/50 text-primary-foreground/70 cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/30',
            ].join(' ')}
            aria-label={isCalculating ? t.calculating : t.showRoute}
          >
            {isCalculating ? (
              <>
                <Loader2 size={22} className="spinner" />
                <span>{t.calculating}</span>
              </>
            ) : (
              <>
                <Navigation size={22} strokeWidth={2.5} />
                <span>{t.showRoute}</span>
              </>
            )}
          </button>
        )}

        {/* When route is active — clear route option */}
        {isRouteActive && (
          <button
            onClick={onClear}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors duration-150 active:scale-[0.98]"
          >
            <X size={16} />
            <span>{t.clearRoute}</span>
          </button>
        )}
      </div>
    </div>
  );
}