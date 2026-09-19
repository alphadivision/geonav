import type { ChargingStation } from '@/types';

// Shared between the client-side direct Places API (New) call (MapCanvas's
// fetchChargingStations — the primary path, same pattern as fetchRoutes in
// NavigationMapClient) and the server-side /api/charging-stations fallback,
// so the raw-place → ChargingStation transform can't drift between them.

export const CHARGING_STATION_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,places.evChargeOptions,places.rating,places.currentOpeningHours.openNow';

export interface RawPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  currentOpeningHours?: { openNow?: boolean };
  evChargeOptions?: {
    connectorCount?: number;
    connectorAggregation?: Array<{ type?: string }>;
  };
}

export function parseChargingStations(places: RawPlace[]): ChargingStation[] {
  return places
    .filter((p) => p.location)
    .map((p) => {
      const name = p.displayName?.text || 'EV Charging Station';
      const isTeslaSupercharger =
        /tesla/i.test(name) ||
        (p.evChargeOptions?.connectorAggregation || []).some(
          (c) => c.type === 'EV_CONNECTOR_TYPE_TESLA'
        );
      return {
        id: p.id,
        name,
        address: p.formattedAddress,
        coordinates: [p.location!.longitude, p.location!.latitude] as [number, number],
        isTeslaSupercharger,
        connectorCount: p.evChargeOptions?.connectorCount,
        rating: p.rating,
        openNow: p.currentOpeningHours?.openNow,
      };
    });
}
