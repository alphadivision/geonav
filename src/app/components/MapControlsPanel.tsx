'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { SlidersHorizontal, AlertTriangle, MapPin } from 'lucide-react';
import type { MapStyle } from '@/types';
import type { Language, Translations } from '@/lib/i18n';
import AccountSection from './AccountSection';

interface MapControlsPanelProps {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  currentStyle: MapStyle;
  onStyleChange: (style: MapStyle) => void;
  trafficEnabled: boolean;
  onTrafficToggle: () => void;
  placesEnabled: boolean;
  onPlacesToggle: () => void;
  t: Translations;
}

const STYLE_OPTIONS: { key: MapStyle; icon: string }[] = [
  { key: 'dark', icon: '🌙' },
  { key: 'standard', icon: '🗺️' },
  { key: 'satellite', icon: '🛰️' },
  { key: 'streets', icon: '🛣️' },
];

function getStyleLabel(key: MapStyle, t: Translations): string {
  switch (key) {
    case 'dark': return t.styleDark;
    case 'standard': return t.styleStandard;
    case 'satellite': return t.styleSatellite;
    case 'streets': return t.styleStreets;
  }
}

// Secondary controls (language, map style, traffic, help) that aren't needed
// every time — tucked behind one small toggle so the map stays uncluttered
// by default, matching the clean reference layout.
export default function MapControlsPanel({
  language,
  onLanguageChange,
  currentStyle,
  onStyleChange,
  trafficEnabled,
  onTrafficToggle,
  placesEnabled,
  onPlacesToggle,
  t,
}: MapControlsPanelProps) {
  const [open, setOpen] = useState(false);

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-map-controls-panel]')) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  return (
    <div data-map-controls-panel className="relative">
      <button
        onClick={handleToggle}
        className={[
          'glass-dark rounded-full',
          'w-11 h-11 flex items-center justify-center',
          'text-foreground hover:text-primary hover:bg-muted/60',
          'shadow-xl shadow-black/40',
          'transition-all duration-150 active:scale-95',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          open ? 'text-primary bg-muted/60' : '',
        ].join(' ')}
        aria-label={t.mapControls}
        title={t.mapControls}
      >
        <SlidersHorizontal size={18} strokeWidth={2} />
      </button>

      {open && (
        <div
          className={[
            'absolute right-0 bottom-full mb-2',
            'glass-dark rounded-2xl shadow-2xl shadow-black/60',
            'w-[240px] overflow-hidden border border-white/10',
          ].join(' ')}
          style={{ zIndex: 1000 }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-white/10">
            <span className="text-foreground text-sm font-semibold tracking-wide">
              {t.mapControls}
            </span>
          </div>

          {/* Account (Google sign-in) */}
          <AccountSection t={t} />

          {/* Language */}
          <div className="px-4 py-3 border-b border-white/10">
            <div className="text-xs text-muted-foreground mb-2">{t.language}</div>
            <div className="flex rounded-xl overflow-hidden border border-white/10">
              <button
                onClick={() => onLanguageChange('ka')}
                className={[
                  'flex-1 py-2 text-xs font-semibold transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset',
                  language === 'ka' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-white/5',
                ].join(' ')}
                aria-pressed={language === 'ka'}
              >
                ქარ
              </button>
              <button
                onClick={() => onLanguageChange('en')}
                className={[
                  'flex-1 py-2 text-xs font-semibold transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset',
                  language === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-white/5',
                ].join(' ')}
                aria-pressed={language === 'en'}
              >
                EN
              </button>
            </div>
          </div>

          {/* Map style */}
          <div className="px-4 py-3 border-b border-white/10">
            <div className="text-xs text-muted-foreground mb-2">{t.mapStyle}</div>
            <div className="grid grid-cols-4 gap-1.5">
              {STYLE_OPTIONS.map(({ key, icon }) => {
                const isActive = currentStyle === key;
                return (
                  <button
                    key={key}
                    onClick={() => onStyleChange(key)}
                    className={[
                      'flex flex-col items-center justify-center gap-0.5 rounded-lg py-2',
                      'transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                      isActive ? 'bg-primary/15 text-primary' : 'hover:bg-white/5 text-muted-foreground',
                    ].join(' ')}
                    aria-pressed={isActive}
                    title={getStyleLabel(key, t)}
                  >
                    <span className="text-base leading-none">{icon}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Traffic */}
          <div className="px-4 py-3 border-b border-white/10">
            <button
              onClick={onTrafficToggle}
              className="w-full flex items-center justify-between rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              aria-pressed={trafficEnabled}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <AlertTriangle size={16} className={trafficEnabled ? 'text-warning' : 'text-muted-foreground'} />
                {t.traffic}
              </span>
              <span
                className={[
                  'inline-block w-9 h-5 rounded-full relative transition-colors flex-shrink-0',
                  trafficEnabled ? 'bg-warning' : 'bg-white/10',
                ].join(' ')}
              >
                <span
                  className={[
                    'absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                    trafficEnabled ? 'translate-x-4' : 'translate-x-0',
                  ].join(' ')}
                />
              </span>
            </button>
          </div>

          {/* Show Places (native map POI visibility) */}
          <div className="px-4 py-3">
            <button
              onClick={onPlacesToggle}
              className="w-full flex items-center justify-between rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              aria-pressed={placesEnabled}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <MapPin size={16} className={placesEnabled ? 'text-primary' : 'text-muted-foreground'} />
                {t.showPlaces}
              </span>
              <span
                className={[
                  'inline-block w-9 h-5 rounded-full relative transition-colors flex-shrink-0',
                  placesEnabled ? 'bg-primary' : 'bg-white/10',
                ].join(' ')}
              >
                <span
                  className={[
                    'absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                    placesEnabled ? 'translate-x-4' : 'translate-x-0',
                  ].join(' ')}
                />
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
