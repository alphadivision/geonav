'use client';

import React from 'react';
import { MapPin, AlertCircle, Search } from 'lucide-react';
import type { SearchResult } from '@/types';
import type { Language } from '@/lib/i18n';
import type { Translations } from '@/lib/i18n';
import type { LucideIcon } from 'lucide-react';
import Icon from '@/components/ui/AppIcon';


interface SearchResultsProps {
  results: SearchResult[];
  hasError: boolean;
  isLoading: boolean;
  query: string;
  language: Language;
  t: Translations;
  onSelect: (result: SearchResult) => void;
  getPoiIcon: (category?: string, maki?: string) => LucideIcon;
}

export default function SearchResults({
  results,
  hasError,
  isLoading,
  query,
  t,
  onSelect,
  getPoiIcon,
}: SearchResultsProps) {
  // Error state
  if (hasError) {
    return (
      <div className="mt-2 glass-dark rounded-2xl overflow-hidden shadow-xl shadow-black/40">
        <div className="flex items-center gap-3 px-5 py-4">
          <AlertCircle size={20} className="text-danger flex-shrink-0" />
          <p className="text-sm text-danger font-medium">{t.searchError}</p>
        </div>
      </div>
    );
  }

  // No results state (not loading)
  if (!isLoading && results.length === 0 && query.trim().length >= 2) {
    return (
      <div className="mt-2 glass-dark rounded-2xl overflow-hidden shadow-xl shadow-black/40">
        <div className="flex items-center gap-3 px-5 py-5">
          <Search size={20} className="text-muted-foreground flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">{t.noResults}</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">
              &ldquo;{query}&rdquo;
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Results list
  if (results.length === 0) return null;

  return (
    <div className="mt-2 glass-dark rounded-2xl overflow-hidden shadow-xl shadow-black/40 max-h-72 overflow-y-auto">
      <ul role="listbox" className="py-2">
        {results.map((result, idx) => {
          const Icon = getPoiIcon(result.category);
          return (
            <li key={`result-${result.id}-${idx}`} role="option">
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(result);
                }}
                className={[
                  'w-full flex items-center gap-3 px-4 py-3.5',
                  'text-left transition-colors duration-100',
                  'hover:bg-muted/60 active:bg-muted',
                  'focus:outline-none focus:bg-muted/60',
                  idx < results.length - 1
                    ? 'border-b border-border/40' :'',
                ].join(' ')}
              >
                {/* Icon */}
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                  <Icon size={18} className="text-primary" />
                </div>

                {/* Text content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm sm:text-base font-semibold text-foreground truncate leading-tight">
                    {result.name}
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground truncate mt-0.5 leading-tight">
                    {result.address}
                  </p>
                </div>

                {/* Arrow indicator */}
                <div className="flex-shrink-0">
                  <MapPin size={16} className="text-muted-foreground/60" />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}