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
import type { SearchResult } from '@/types';
import SearchResults from './SearchResults';

declare global {
  interface Window {
    google: typeof google;
  }
}

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

// Georgia bounding box for bias
const GEORGIA_BOUNDS = {
  north: 43.6,
  south: 41.0,
  east: 46.7,
  west: 40.0,
};

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
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const placesServiceDivRef = useRef<HTMLDivElement | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  // Initialize Places services once Google Maps is loaded
  const initPlacesServices = useCallback(() => {
    if (
      typeof window === 'undefined' ||
      !window.google?.maps?.places
    ) return false;

    if (!autocompleteServiceRef.current) {
      autocompleteServiceRef.current = new google.maps.places.AutocompleteService();
    }
    if (!placesServiceRef.current) {
      if (!placesServiceDivRef.current) {
        placesServiceDivRef.current = document.createElement('div');
      }
      placesServiceRef.current = new google.maps.places.PlacesService(placesServiceDivRef.current);
    }
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
    }
    return true;
  }, []);

  const performSearch = useCallback(
    async (value: string) => {
      if (value.trim().length < 2) {
        setResults([]);
        setIsOpen(false);
        return;
      }

      setIsLoading(true);
      setHasError(false);

      try {
        // Try to init services (Maps JS API must be loaded)
        if (!initPlacesServices()) {
          // Fallback to server-side geocode API
          const params = new URLSearchParams({ q: value.trim(), lang: language });
          const res = await fetch(`/api/geocode?${params.toString()}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (data.features && Array.isArray(data.features)) {
            const parsed: SearchResult[] = data.features.map((f: {
              id: string;
              text?: string;
              text_ka?: string;
              place_name?: string;
              place_name_ka?: string;
              geometry: { coordinates: [number, number] };
              properties?: { category?: string; maki?: string };
            }) => {
              const name = language === 'ka' ? (f.text_ka || f.text || '') : (f.text || '');
              const placeName = language === 'ka' ? (f.place_name_ka || f.place_name || '') : (f.place_name || '');
              return {
                id: f.id,
                name,
                address: placeName,
                coordinates: f.geometry.coordinates,
                type: 'Feature',
                category: f.properties?.category || f.properties?.maki,
              };
            });
            setResults(parsed);
            setIsOpen(parsed.length > 0);
          } else {
            setResults([]);
            setIsOpen(true);
          }
          return;
        }

        const svc = autocompleteServiceRef.current!;
        const token = sessionTokenRef.current!;

        const request: google.maps.places.AutocompletionRequest = {
          input: value.trim(),
          sessionToken: token,
          language: language === 'ka' ? 'ka' : 'en',
          componentRestrictions: { country: 'ge' },
          locationBias: new google.maps.LatLngBounds(
            { lat: GEORGIA_BOUNDS.south, lng: GEORGIA_BOUNDS.west },
            { lat: GEORGIA_BOUNDS.north, lng: GEORGIA_BOUNDS.east }
          ),
        };

        const predictions = await new Promise<google.maps.places.AutocompletePrediction[]>(
          (resolve, reject) => {
            svc.getPlacePredictions(request, (results, status) => {
              if (
                status === google.maps.places.PlacesServiceStatus.OK ||
                status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS
              ) {
                resolve(results || []);
              } else {
                reject(new Error(`AutocompleteService status: ${status}`));
              }
            });
          }
        );

        if (predictions.length === 0) {
          setResults([]);
          setIsOpen(true); // show empty state
          return;
        }

        // Get place details (lat/lng) for each prediction
        const placesSvc = placesServiceRef.current!;
        const detailPromises = predictions.slice(0, 6).map(
          (pred) =>
            new Promise<SearchResult | null>((resolve) => {
              placesSvc.getDetails(
                {
                  placeId: pred.place_id,
                  fields: ['place_id', 'name', 'formatted_address', 'geometry', 'types'],
                  sessionToken: token,
                  language: language === 'ka' ? 'ka' : 'en',
                },
                (place, status) => {
                  if (
                    status !== google.maps.places.PlacesServiceStatus.OK ||
                    !place?.geometry?.location
                  ) {
                    resolve(null);
                    return;
                  }
                  const lat = place.geometry.location.lat();
                  const lng = place.geometry.location.lng();
                  const name = place.name || pred.structured_formatting?.main_text || '';
                  const address =
                    place.formatted_address ||
                    pred.structured_formatting?.secondary_text ||
                    pred.description ||
                    '';
                  const types = place.types || [];
                  const category = types.find((t) =>
                    ['restaurant', 'gas_station', 'lodging', 'airport', 'store', 'hospital'].includes(t)
                  ) || types[0] || 'place';

                  resolve({
                    id: pred.place_id,
                    name,
                    address,
                    coordinates: [lng, lat],
                    type: 'Feature',
                    category,
                  });
                }
              );
            })
        );

        // Reset session token after getDetails (billing session ends)
        sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();

        const settled = await Promise.all(detailPromises);
        const parsed = settled.filter((r): r is SearchResult => r !== null);
        setResults(parsed);
        setIsOpen(parsed.length > 0 || true);
      } catch (err) {
        console.error('[SearchBar] Error:', err);
        setHasError(true);
        setResults([]);
        setIsOpen(true);
      } finally {
        setIsLoading(false);
      }
    },
    [language, initPlacesServices]
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

      if (value.trim().length >= 2) {
        setIsLoading(true);
      }

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
    setTimeout(() => {
      setIsFocused(false);
      setIsOpen(false);
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (query.trim().length >= 2) {
      performSearch(query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const Icon = getPoiIcon();

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

          {/* Text input */}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder={t.searchPlaceholder}
            disabled={disabled}
            className="flex-1 bg-transparent text-foreground placeholder-muted-foreground text-lg font-medium py-4 outline-none min-w-0"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label={t.searchPlaceholder}
            aria-autocomplete="list"
            aria-expanded={isOpen}
          />

          {/* Clear button */}
          {query.length > 0 && (
            <button
              onClick={handleClear}
              className="flex-shrink-0 ml-2 p-1.5 rounded-full hover:bg-white/10 transition-colors"
              aria-label={t.clearSearch || 'Clear'}
              data-no-map-tap
            >
              <X size={18} className="text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Results dropdown */}
      {isOpen && (
        <div data-no-map-tap>
          <SearchResults
            results={results}
            isLoading={isLoading}
            hasError={hasError}
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