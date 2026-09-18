'use client';

import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import type { Translations } from '@/lib/i18n';

export interface TeslaCompassHandle {
  /**
   * Rotates the letter ring so the given TRUE vehicle heading (0-360,
   * degrees clockwise from North) aligns with the fixed arrow tip at top —
   * exactly like a real compass card. Called directly from MapCanvas's
   * existing per-frame position/heading interpolation loop (the same
   * smoothed, shortest-path value already driving the vehicle cursor), via
   * a single `style.setProperty` DOM write. Bypasses React state entirely,
   * so continuous heading updates never trigger a re-render.
   */
  setHeading: (headingDeg: number) => void;
}

interface TeslaCompassProps {
  onRecenter: () => void;
  t: Translations;
  followMode: boolean;
  /** Only used for the accessible label/title (which mode a tap will land
   * on) — the compass itself always shows the true heading in both modes. */
  mapViewMode?: 'northUp' | 'headingUp';
}

// Resting angle (clockwise degrees from top) of each ring mark when heading
// is 0 (North). The ring's own rotation (driven by --heading) then carries
// every mark around the same circle together.
const CARDINALS: readonly { label: string; angle: number }[] = [
  { label: 'N', angle: 0 },
  { label: 'E', angle: 90 },
  { label: 'S', angle: 180 },
  { label: 'W', angle: 270 },
];
const TICK_ANGLES: readonly number[] = [45, 135, 225, 315];

// Distance from center to each ring mark, sized to fit inside the 44px
// (w-11 h-11) button alongside every other toolbar control.
const RING_RADIUS = 14;

const TeslaCompass = forwardRef<TeslaCompassHandle, TeslaCompassProps>(function TeslaCompass(
  { onRecenter, t, followMode, mapViewMode = 'northUp' },
  ref
) {
  const ringRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      setHeading(headingDeg: number) {
        ringRef.current?.style.setProperty('--heading', String(headingDeg));
      },
    }),
    []
  );

  const isNorthUp = mapViewMode === 'northUp';

  return (
    <button
      onClick={onRecenter}
      className={[
        'glass-dark rounded-2xl overflow-hidden',
        'transition-colors duration-150 active:scale-95',
        'shadow-xl shadow-black/40',
        'flex items-center justify-center relative',
        'w-11 h-11',
        followMode ? 'ring-1 ring-primary/50' : 'ring-1 ring-white/5',
      ].join(' ')}
      aria-label={isNorthUp ? t.northUp : t.recenter}
      title={isNorthUp ? t.northUp : t.recenter}
    >
      {/* Rotating dial: cardinal letters + intercardinal ticks. A single
          CSS custom property (--heading, written imperatively via
          setHeading) drives both this ring's rotation and each letter's
          counter-rotation, so the letters swing around the circle while
          staying upright and readable. */}
      <div
        ref={ringRef}
        className="absolute inset-0"
        style={{ transform: 'rotate(calc(var(--heading, 0) * -1deg))', willChange: 'transform' }}
      >
        {TICK_ANGLES.map((angle) => (
          <div
            key={angle}
            className="absolute left-1/2 top-1/2 w-0 h-0"
            style={{ transform: `rotate(${angle}deg) translateY(-${RING_RADIUS}px)` }}
          >
            <span className="block w-px h-1.5 -translate-x-1/2 bg-white/25" />
          </div>
        ))}
        {CARDINALS.map(({ label, angle }) => (
          <div
            key={label}
            className="absolute left-1/2 top-1/2 w-0 h-0"
            style={{ transform: `rotate(${angle}deg) translateY(-${RING_RADIUS}px)` }}
          >
            <span
              className="absolute inline-block text-[9px] font-bold leading-none text-white/85 select-none whitespace-nowrap"
              style={{ transform: `translate(-50%, -50%) rotate(calc(var(--heading, 0) * 1deg - ${angle}deg))` }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Fixed arrow — always points up, marking the reference point the
          rotating ring's current-heading letter aligns to. Never rotates. */}
      <svg width="9" height="11" viewBox="0 0 9 11" className="relative z-10" fill="none">
        <path d="M4.5 0L8.5 8L4.5 6L0.5 8L4.5 0Z" fill={followMode ? '#fff' : 'rgba(255,255,255,0.75)'} />
      </svg>
    </button>
  );
});

export default TeslaCompass;
