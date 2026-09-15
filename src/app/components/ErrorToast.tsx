'use client';

import React, { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { Translations } from '@/lib/i18n';

interface ErrorToastProps {
  message: string;
  onDismiss: () => void;
  t?: Translations;
}

export default function ErrorToast({ message, onDismiss, t }: ErrorToastProps) {
  const closeLabel = t?.close ?? 'Close';

  // Auto-dismiss after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss, message]);

  return (
    <div
      className={[
        'fixed top-24 left-4 right-4 z-toast',
        'glass-dark border border-warning/40 rounded-2xl',
        'shadow-xl shadow-black/50',
        'flex items-center gap-3 px-4 py-3.5',
        'search-results-enter',
      ].join(' ')}
      role="alert"
      aria-live="assertive"
    >
      <AlertTriangle size={20} className="text-warning flex-shrink-0" />
      <p className="flex-1 text-sm font-medium text-foreground leading-snug">
        {message}
      </p>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 touch-target rounded-xl text-muted-foreground hover:text-foreground transition-colors duration-150 active:scale-95"
        aria-label={closeLabel}
      >
        <X size={18} />
      </button>
    </div>
  );
}