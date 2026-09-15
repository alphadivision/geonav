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
    <div className="glass-dark rounded-2xl overflow-hidden shadow-xl shadow-black/40 flex flex-col">
      <button
        onClick={onZoomIn}
        className="touch-target-lg text-foreground hover:text-primary hover:bg-muted/60 transition-colors duration-150 active:scale-95 active:bg-muted"
        aria-label={t.zoomIn}
        title={t.zoomIn}
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>

      <div className="h-px bg-border/60 mx-3" />

      <button
        onClick={onZoomOut}
        className="touch-target-lg text-foreground hover:text-primary hover:bg-muted/60 transition-colors duration-150 active:scale-95 active:bg-muted"
        aria-label={t.zoomOut}
        title={t.zoomOut}
      >
        <Minus size={24} strokeWidth={2.5} />
      </button>
    </div>
  );
}