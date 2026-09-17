import React from 'react';
import { Navigation } from 'lucide-react';

export default function BrandBadge() {
  return (
    <div
      className={[
        'glass-dark rounded-2xl',
        'flex items-center gap-2.5 h-11 px-3',
        'shadow-xl shadow-black/40',
      ].join(' ')}
    >
      <span className="flex items-center justify-center w-6 h-6 rounded-md bg-danger/15">
        <Navigation size={14} className="text-danger fill-danger" strokeWidth={2} />
      </span>
      <div className="flex flex-col leading-none">
        <span className="text-sm font-bold text-foreground tracking-wide">TeslaNav</span>
        <span className="text-[10px] text-muted-foreground mt-0.5">v1.0.0</span>
      </div>
    </div>
  );
}
