'use client';

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import { Search, X, Loader2, MapPin, Building2, Fuel, Hotel, Utensils, Plane, ShoppingBag } from 'lucide-react';
import type { Language } from '@/lib/i18n';
import type { Translations } from '@/lib/i18n';
import type { SearchResult, GeocodingFeature } from '@/types';
import SearchResults from './SearchResults';

interface SearchBarProps {
  language: Language;
  t: Translations;
  onSelectResult: (result: SearchResult) => void;
  disabled?: boolean;
}

function getPoiIcon(category?: string, maki?: string) {
  const cat = (category || maki || '').toLowerCase();
  if (cat.includes('fuel') || cat.includes('gas') || cat.includes('petrol')) return Fuel;
  if (cat.includes('hotel') || cat.includes('lodging')) return Hotel;
  if (cat.includes('restaurant') || cat.includes('food') || cat.includes('cafe')) return Utensils;
  if (cat.includes('airport') || cat.includes('aerodrome')) return Plane;
  if (cat.includes('shop') || cat.includes('mall') || cat.includes('store')) return ShoppingBag;
  if (cat.includes('building') || cat.includes('office')) return Building2;
  return MapPin;
}

function parseFeature(feature: GeocodingFeature, lang: Language): SearchResult {
  const name =
    lang === 'ka'
      ? feature.text_ka || feature.text
      : feature.text;

  const placeNameFull =
    lang === 'ka'
      ? feature.place_name_ka || feature.place_name
      : feature.place_name;

  // Build address from place_name minus the primary name
  const addressParts = placeNameFull
    .replace(name + ', ', '')
    .replace(name, '')
    .trim();

  return {
    id: feature.id,
    name,
    address: addressParts || placeNameFull,
    coordinates: feature.geometry.coordinates as [number, number],
    type: feature.type,
    category: feature.properties?.category || feature.properties?.maki,
  };
}

export default function SearchBar({
  language,
  t,
  onSelectResult,
  disabled,
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const performSearch = useCallback(
    async (value: string) => {
      if (value.trim().length < 2) {
        setResults([]);
        setIsOpen(false);
        return;
      }

      // Cancel previous request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      abortRef.current = new AbortController();

      setIsLoading(true);
      setHasError(false);

      try {
        // Backend integration: calls /api/geocode which proxies Mapbox Geocoding API
        const params = new URLSearchParams({
          q: value.trim(),
          lang: language,
        });

        const res = await fetch(`/api/geocode?${params.toString()}`, {
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

        if (data.features && Array.isArray(data.features)) {
          const parsed: SearchResult[] = data.features.map(
            (f: GeocodingFeature) => parseFeature(f, language)
          );
          setResults(parsed);
          setIsOpen(parsed.length > 0);
        } else {
          setResults([]);
          setIsOpen(true); // show empty state
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[SearchBar] Error:', err);
        setHasError(true);
        setResults([]);
        setIsOpen(true);
      } finally {
        setIsLoading(false);
      }
    },
    [language]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (value.trim().length === 0) {
        setResults([]);
        setIsOpen(false);
        setIsLoading(false);
        return;
      }

      // Show loading immediately for responsive feel
      if (value.trim().length >= 2) {
        setIsLoading(true);
      }

      // Debounce: 350ms — balanced for Tesla touch + performance
      debounceRef.current = setTimeout(() => {
        performSearch(value);
      }, 350);
    },
    [performSearch]
  );

  const handleClear = useCallback(() => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    setIsLoading(false);
    setHasError(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
    inputRef.current?.focus();
  }, []);

  const handleSelectResult = useCallback(
    (result: SearchResult) => {
      setQuery(result.name);
      setResults([]);
      setIsOpen(false);
      setIsFocused(false);
      inputRef.current?.blur();
      onSelectResult(result);
    },
    [onSelectResult]
  );

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    if (results.length > 0) setIsOpen(true);
  }, [results.length]);

  const handleBlur = useCallback(() => {
    // Delay to allow click on results
    setTimeout(() => {
      setIsFocused(false);
      setIsOpen(false);
    }, 200);
  }, []);

  // Clear debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // Re-search when language changes and there's a query
  useEffect(() => {
    if (query.trim().length >= 2) {
      performSearch(query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  return (
    <div className="relative w-full">
      {/* Search input container */}
      <div
        className={[
          'glass-dark rounded-2xl overflow-hidden transition-all duration-200',
          isFocused
            ? 'ring-2 ring-primary shadow-lg shadow-primary/20'
            : 'shadow-xl shadow-black/40',
        ].join(' ')}
      >
        <div className="flex items-center px-4 py-0">
          {/* Search icon / loading spinner */}
          <div className="flex-shrink-0 mr-3">
            {isLoading ? (
              <Loader2
                size={22}
                className="text-primary spinner"
                aria-label={t.searchingFor}
              />
            ) : (
              <Search
                size={22}
                className={isFocused ? 'text-primary' : 'text-muted-foreground'}
              />
            )}
          </div>

          {/* Text input — large touch target, Georgian font */}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder={t.searchPlaceholder}
            disabled={disabled}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className={[
              'flex-1 bg-transparent py-4 text-base sm:text-lg font-medium',
              'text-foreground placeholder-muted-foreground',
              'outline-none border-none',
              'min-h-[56px]',
              disabled ? 'opacity-50 cursor-not-allowed' : '',
            ].join(' ')}
            aria-label={t.searchPlaceholder}
            role="combobox"
            aria-expanded={isOpen}
            aria-autocomplete="list"
          />

          {/* Clear button — only visible when there's a query */}
          {query.length > 0 && (
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                handleClear();
              }}
              className="flex-shrink-0 ml-2 touch-target rounded-xl text-muted-foreground hover:text-foreground transition-colors duration-150 active:scale-95"
              aria-label={t.clearDestination}
            >
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Search results dropdown */}
      {isOpen && (
        <div className="search-results-enter">
          <SearchResults
            results={results}
            hasError={hasError}
            isLoading={isLoading}
            query={query}
            language={language}
            t={t}
            onSelect={handleSelectResult}
            getPoiIcon={getPoiIcon}
          />
        </div>
      )}
    </div>
  );
}