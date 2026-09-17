'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';
import type { Translations } from '@/lib/i18n';

interface HelpButtonProps {
  t: Translations;
}

export default function HelpButton({ t }: HelpButtonProps) {
  const [open, setOpen] = useState(false);

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-help-button]')) {
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
    <div data-help-button className="relative">
      <button
        onClick={handleToggle}
        className={[
          'glass-dark rounded-full',
          'w-11 h-11 flex items-center justify-center',
          'text-foreground hover:text-primary hover:bg-muted/60',
          'shadow-xl shadow-black/40',
          'transition-all duration-150 active:scale-95',
          open ? 'text-primary bg-muted/60' : '',
        ].join(' ')}
        aria-label={t.help}
        title={t.help}
      >
        <HelpCircle size={20} strokeWidth={2} />
      </button>

      {open && (
        <div
          className={[
            'absolute left-0 bottom-full mb-2',
            'glass-dark rounded-2xl shadow-2xl shadow-black/60',
            'w-[260px] px-4 py-3 border border-white/10',
          ].join(' ')}
          style={{ zIndex: 1000 }}
        >
          <p className="text-sm text-foreground leading-relaxed">{t.helpText}</p>
        </div>
      )}
    </div>
  );
}
