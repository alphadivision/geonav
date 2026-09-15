import { NextRequest, NextResponse } from 'next/server';

// Backend integration point: Mapbox Geocoding API
// Env: MAPBOX_ACCESS_TOKEN (server-side only, never exposed to client)

const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const lang = searchParams.get('lang') || 'ka';

  if (!query || query.trim().length === 0) {
    return NextResponse.json({ error: 'Query required' }, { status: 400 });
  }

  if (!MAPBOX_TOKEN) {
    return NextResponse.json(
      { error: 'Mapbox token not configured' },
      { status: 500 }
    );
  }

  try {
    const encodedQuery = encodeURIComponent(query.trim());

    // Language preference: Georgian first, then English fallback
    const language = lang === 'ka' ? 'ka,en' : 'en,ka';

    // Bias toward Georgia with proximity to Tbilisi center
    const proximity = '44.8271,41.6938';

    // Country filter includes Georgia (GE) and neighboring countries for cross-border routes
    const country = 'ge';

    const url = [
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedQuery}.json`,
      `?access_token=${MAPBOX_TOKEN}`,
      `&language=${language}`,
      `&country=${country}`,
      `&proximity=${proximity}`,
      `&types=place,locality,neighborhood,address,poi`,
      `&limit=8`,
      `&autoComplete=true`,
    ].join('');

    const response = await fetch(url, {
      headers: { 'Accept-Encoding': 'gzip' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`Mapbox geocoding error: ${response.status}`);
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[geocode] Error:', message);
    return NextResponse.json(
      { error: 'Geocoding failed', detail: message },
      { status: 500 }
    );
  }
}