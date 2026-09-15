'use client';

import React from 'react';
import type { Language } from '@/lib/i18n';

interface LanguageSwitcherProps {
  language: Language;
  onChange: (lang: Language) => void;
}

export default function LanguageSwitcher({
  language,
  onChange,
}: LanguageSwitcherProps) {
  return (
    <div
      className="glass-dark rounded-2xl overflow-hidden flex shadow-xl shadow-black/40"
      role="group"
      aria-label="Language selector"
    >
      <button
        onClick={() => onChange('ka')}
        className={[
          'px-3 py-3 text-sm font-semibold transition-all duration-200',
          'min-h-[52px] min-w-[52px]',
          'active:scale-95',
          language === 'ka' ?'bg-primary text-primary-foreground' :'text-muted-foreground hover:text-foreground hover:bg-muted/60',
        ].join(' ')}
        aria-pressed={language === 'ka'}
        aria-label="ქართული"
      >
        <span className="text-xs leading-none">ქარ</span>
      </button>

      <div className="w-px bg-border/60 self-stretch" />

      <button
        onClick={() => onChange('en')}
        className={[
          'px-3 py-3 text-sm font-semibold transition-all duration-200',
          'min-h-[52px] min-w-[52px]',
          'active:scale-95',
          language === 'en' ?'bg-primary text-primary-foreground' :'text-muted-foreground hover:text-foreground hover:bg-muted/60',
        ].join(' ')}
        aria-pressed={language === 'en'}
        aria-label="English"
      >
        <span className="text-xs leading-none">EN</span>
      </button>
    </div>
  );
}