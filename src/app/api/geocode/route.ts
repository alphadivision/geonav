import { NextRequest, NextResponse } from 'next/server';

// Backend integration point: Google Places API (New) - Text Search
// Env: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (also readable server-side)

const GOOGLE_API_KEY =
  process.env.GOOGLE_MAPS_SERVER_KEY ||
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const lang = searchParams.get('lang') || 'ka';

  if (!query || query.trim().length === 0) {
    return NextResponse.json({ error: 'Query required' }, { status: 400 });
  }

  if (!GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: 'Google Maps API key not configured' },
      { status: 500 }
    );
  }

  try {
    const language = lang === 'ka' ? 'ka' : 'en';
    const textQuery = query.trim() + ' Georgia';

    // Use Places API (New) - Text Search
    const url = 'https://places.googleapis.com/v1/places:searchText';

    const requestBody = {
      textQuery,
      languageCode: language,
      regionCode: 'GE',
      pageSize: 8,
      locationBias: {
        rectangle: {
          low: { latitude: 41.0, longitude: 40.0 },
          high: { latitude: 43.6, longitude: 46.7 },
        },
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Places API (New) error: ${response.status} - ${errText}`);
    }

    const data = await response.json();

    // Transform Places API (New) response to match existing GeocodingFeature shape
    const places = data.places || [];
    const features = places.map((place: {
      id: string;
      displayName?: { text: string; languageCode?: string };
      formattedAddress?: string;
      location?: { latitude: number; longitude: number };
      types?: string[];
      primaryType?: string;
    }) => {
      const lat = place.location?.latitude ?? 0;
      const lng = place.location?.longitude ?? 0;
      const name = place.displayName?.text || place.formattedAddress || '';
      const address = place.formattedAddress || name;
      const placeType = place.primaryType || place.types?.[0] || 'place';
      const category = place.types?.find((t: string) =>
        ['restaurant', 'gas_station', 'lodging', 'airport', 'store', 'hospital'].includes(t)
      );

      return {
        id: place.id,
        type: 'Feature',
        place_name: address,
        place_name_ka: address,
        text: name,
        text_ka: name,
        properties: {
          category: category || placeType,
          maki: placeType,
        },
        geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
        context: [],
      };
    });

    return NextResponse.json(
      { features, type: 'FeatureCollection' },
      {
        headers: {
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[geocode] Error:', message);
    return NextResponse.json(
      { error: 'Geocoding failed', detail: message },
      { status: 500 }
    );
  }
}