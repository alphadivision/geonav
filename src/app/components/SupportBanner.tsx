'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Heart, ChevronRight } from 'lucide-react';
import type { Translations } from '@/lib/i18n';

interface SupportBannerProps {
  t: Translations;
}

export default function SupportBanner({ t }: SupportBannerProps) {
  const [open, setOpen] = useState(false);

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-support-banner]')) {
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
    <div data-support-banner className="relative">
      <button
        onClick={handleToggle}
        className={[
          'glass-dark rounded-full',
          'flex items-center gap-2 pl-3 pr-3.5 h-11',
          'text-foreground text-sm font-semibold',
          'shadow-xl shadow-black/40',
          'transition-all duration-150 active:scale-95 hover:bg-muted/60',
        ].join(' ')}
        aria-label={t.supportProject}
        title={t.supportProject}
      >
        <Heart size={18} className="text-rose-500 fill-rose-500" strokeWidth={2} />
        <span className="whitespace-nowrap">{t.supportProject}</span>
        <ChevronRight size={16} className="text-muted-foreground" />
      </button>

      {open && (
        <div
          className={[
            'absolute left-0 top-full mt-2',
            'glass-dark rounded-2xl shadow-2xl shadow-black/60',
            'w-[260px] px-4 py-3 border border-white/10',
          ].join(' ')}
          style={{ zIndex: 1000 }}
        >
          <p className="text-sm text-foreground leading-relaxed">
            {t.supportMessage}
          </p>
        </div>
      )}
    </div>
  );
}
