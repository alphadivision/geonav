'use client';

import React from 'react';
import type { Translations } from '@/lib/i18n';

interface LoadingOverlayProps {
  t: Translations;
}

export default function LoadingOverlay({ t }: LoadingOverlayProps) {
  return (
    <div
      className="fixed inset-0 bg-background z-modal flex items-center justify-center"
      aria-label={t.loading}
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-5">
        {/* Logo mark */}
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-2xl bg-primary/20 flex items-center justify-center">
            <svg
              width="36"
              height="36"
              viewBox="0 0 36 36"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              {/* Navigation arrow pointing northeast */}
              <path
                d="M18 4L28 28L18 23L8 28L18 4Z"
                fill="var(--primary)"
                opacity="0.9"
              />
              <path
                d="M18 4L28 28L18 23L8 28L18 4Z"
                stroke="var(--primary)"
                strokeWidth="1"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* App name */}
        <div className="text-center">
          <p className="text-xl font-bold text-foreground tracking-wide">
            {t.appName}
          </p>
          <p className="text-sm text-muted-foreground mt-1 font-medium">
            {t.loading}
          </p>
        </div>

        {/* Loading bar */}
        <div className="w-48 h-1 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full animate-pulse w-2/3" />
        </div>
      </div>
    </div>
  );
}