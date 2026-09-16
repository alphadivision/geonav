import { NextRequest, NextResponse } from 'next/server';

// Backend integration point: Google Places Text Search + Geocoding API
// Env: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (also readable server-side)

const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

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
    const encodedQuery = encodeURIComponent(query.trim() + ' Georgia');
    const language = lang === 'ka' ? 'ka' : 'en';

    // Use Google Places Text Search API
    const url = [
      `https://maps.googleapis.com/maps/api/place/textsearch/json`,
      `?query=${encodedQuery}`,
      `&key=${GOOGLE_API_KEY}`,
      `&language=${language}`,
      `&region=ge`,
    ].join('');

    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`Google Places error: ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Google Places status: ${data.status}`);
    }

    // Transform Google Places response to match existing GeocodingFeature shape
    const features = (data.results || []).slice(0, 8).map((place: {
      place_id: string;
      name: string;
      formatted_address: string;
      geometry: { location: { lat: number; lng: number } };
      types?: string[];
    }) => {
      const [lng, lat] = [place.geometry.location.lng, place.geometry.location.lat];
      const placeType = place.types?.[0] || 'place';
      const category = place.types?.find((t: string) =>
        ['restaurant', 'fuel', 'lodging', 'airport', 'store', 'hospital'].includes(t)
      );

      return {
        id: place.place_id,
        type: 'Feature',
        place_name: place.formatted_address,
        place_name_ka: place.formatted_address,
        text: place.name,
        text_ka: place.name,
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