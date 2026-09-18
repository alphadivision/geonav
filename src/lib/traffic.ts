import type { TrafficSegment, TrafficSpeedCategory } from '@/types';

// Converts the Routes API's real `travelAdvisory.speedReadingIntervals` into
// our TrafficSegment[] shape. Shared by both call sites that hit the Routes
// API (NavigationMapClient's direct browser call and the /api/directions
// server fallback) so the interval → segment logic can't drift between them.
//
// Per Google's docs, `endPolylinePointIndex` is exclusive of the interval and
// `startPolylinePointIndex` is optional (defaults to the previous interval's
// end, 0 for the first) — this reconstructs the implied start explicitly,
// and treats `end` as also belonging to this segment (rather than strictly
// exclusive) so adjacent colored polylines share their boundary vertex with
// no visual gap between them. Returns undefined (never a fabricated single
// segment) when the API didn't return this data at all — e.g. if the
// `extraComputations: ['TRAFFIC_ON_POLYLINE']` request flag is missing.
export function buildTrafficSegments(
  intervals: Array<{ startPolylinePointIndex?: number; endPolylinePointIndex: number; speed: TrafficSpeedCategory }> | undefined,
  coordCount: number
): TrafficSegment[] | undefined {
  if (!intervals || intervals.length === 0) return undefined;
  const segments: TrafficSegment[] = [];
  let cursor = 0;
  for (const interval of intervals) {
    const start = interval.startPolylinePointIndex ?? cursor;
    const end = Math.min(interval.endPolylinePointIndex, coordCount - 1);
    if (end > start) {
      segments.push({ startIdx: start, endIdx: end, category: interval.speed });
    }
    cursor = interval.endPolylinePointIndex;
  }
  return segments.length > 0 ? segments : undefined;
}
