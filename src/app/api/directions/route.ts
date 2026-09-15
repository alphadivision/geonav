import { NextRequest, NextResponse } from 'next/server';

// Backend integration point: Mapbox Directions API
// Env: MAPBOX_ACCESS_TOKEN (server-side only, never exposed to client)

const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const originLng = searchParams.get('olng');
  const originLat = searchParams.get('olat');
  const destLng = searchParams.get('dlng');
  const destLat = searchParams.get('dlat');

  if (!originLng || !originLat || !destLng || !destLat) {
    return NextResponse.json(
      { error: 'Origin and destination coordinates required' },
      { status: 400 }
    );
  }

  if (!MAPBOX_TOKEN) {
    return NextResponse.json(
      { error: 'Mapbox token not configured' },
      { status: 500 }
    );
  }

  try {
    const coordinates = `${originLng},${originLat};${destLng},${destLat}`;

    const url = [
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}`,
      `?access_token=${MAPBOX_TOKEN}`,
      `&geometries=geojson`,
      `&overview=full`,
      `&steps=true`,
      `&alternatives=true`,
      `&annotations=congestion`,
      `&language=ka`,
    ].join('');

    const response = await fetch(url, {
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      throw new Error(`Mapbox directions error: ${response.status}`);
    }

    const data = await response.json();

    if (data.code !== 'Ok') {
      return NextResponse.json(
        { error: data.message || 'Route calculation failed' },
        { status: 422 }
      );
    }

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=120',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[directions] Error:', message);
    return NextResponse.json(
      { error: 'Directions failed', detail: message },
      { status: 500 }
    );
  }
}