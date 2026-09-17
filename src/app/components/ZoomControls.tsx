'use client';

import React from 'react';
import { Plus, Minus } from 'lucide-react';
import type { Translations } from '@/lib/i18n';

interface ZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  t: Translations;
}

export default function ZoomControls({ onZoomIn, onZoomOut, t }: ZoomControlsProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onZoomOut}
        className={[
          'glass-dark rounded-full w-11 h-11 flex items-center justify-center',
          'text-foreground hover:text-primary hover:bg-muted/60',
          'shadow-xl shadow-black/40',
          'transition-all duration-150 active:scale-95 active:bg-muted',
        ].join(' ')}
        aria-label={t.zoomOut}
        title={t.zoomOut}
      >
        <Minus size={20} strokeWidth={2.5} />
      </button>

      <button
        onClick={onZoomIn}
        className={[
          'glass-dark rounded-full w-11 h-11 flex items-center justify-center',
          'text-foreground hover:text-primary hover:bg-muted/60',
          'shadow-xl shadow-black/40',
          'transition-all duration-150 active:scale-95 active:bg-muted',
        ].join(' ')}
        aria-label={t.zoomIn}
        title={t.zoomIn}
      >
        <Plus size={20} strokeWidth={2.5} />
      </button>
    </div>
  );
}