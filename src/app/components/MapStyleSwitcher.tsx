'use client';

import React, { useState, useCallback, useEffect } from 'react';
import type { MapStyle } from '@/types';
import type { Translations } from '@/lib/i18n';
import { MAP_STYLE_KEY } from '@/lib/i18n';
import { DEFAULT_MAP_STYLE } from '@/lib/mapbox';

interface MapStyleSwitcherProps {
  currentStyle: MapStyle;
  onStyleChange: (style: MapStyle) => void;
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

export function getStoredMapStyle(): MapStyle {
  if (typeof window === 'undefined') return DEFAULT_MAP_STYLE;
  const stored = localStorage.getItem(MAP_STYLE_KEY);
  if (stored === 'dark' || stored === 'standard' || stored === 'satellite' || stored === 'streets') {
    return stored as MapStyle;
  }
  return DEFAULT_MAP_STYLE;
}

export function setStoredMapStyle(style: MapStyle): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(MAP_STYLE_KEY, style);
}

export default function MapStyleSwitcher({ currentStyle, onStyleChange, t }: MapStyleSwitcherProps) {
  const [open, setOpen] = useState(false);

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const handleSelect = useCallback(
    (style: MapStyle) => {
      onStyleChange(style);
      setStoredMapStyle(style);
      setOpen(false);
    },
    [onStyleChange]
  );

  // Close on outside tap
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-map-style-switcher]')) {
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
    <div data-map-style-switcher className="relative">
      {/* Toggle button */}
      <button
        onClick={handleToggle}
        className={[
          'glass-dark rounded-2xl',
          'flex items-center justify-center',
          'w-[52px] h-[52px]',
          'text-foreground hover:text-primary',
          'hover:bg-muted/60 transition-all duration-150',
          'active:scale-95 active:bg-muted',
          'shadow-xl shadow-black/40',
          open ? 'text-primary bg-muted/60' : '',
        ].join(' ')}
        aria-label={t.mapStyle}
        title={t.mapStyle}
      >
        <span className="text-lg leading-none">
          {STYLE_OPTIONS.find((s) => s.key === currentStyle)?.icon ?? '🗺️'}
        </span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className={[
            'absolute right-0 bottom-full mb-2',
            'glass-dark rounded-2xl shadow-2xl shadow-black/60',
            'min-w-[180px] overflow-hidden',
            'border border-white/10',
          ].join(' ')}
          style={{ zIndex: 1000 }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-white/10">
            <span className="text-foreground text-sm font-semibold tracking-wide">
              {t.mapStyle}
            </span>
          </div>

          {/* Options */}
          <div className="py-1">
            {STYLE_OPTIONS.map(({ key, icon }) => {
              const isActive = currentStyle === key;
              return (
                <button
                  key={key}
                  onClick={() => handleSelect(key)}
                  className={[
                    'w-full flex items-center gap-3 px-4 py-3',
                    'text-left transition-colors duration-100',
                    'active:bg-white/10',
                    isActive
                      ? 'text-primary bg-primary/10' :'text-foreground hover:bg-white/5',
                  ].join(' ')}
                >
                  <span className="text-base leading-none w-5 text-center">{icon}</span>
                  <span className="text-sm font-medium flex-1">
                    {getStyleLabel(key, t)}
                  </span>
                  {isActive && (
                    <span className="text-primary text-xs">●</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
