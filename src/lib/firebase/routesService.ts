import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './config';

// Stored as a capped array field on the SAME users/{uid} document
// (userService.ts) rather than a subcollection — there are never more than
// 5 entries, so a subcollection (with its extra queries/deletes to enforce
// the cap) would be more moving parts for no benefit. One read + one merge
// write per saved route.
export interface RecentRoute {
  id: string;
  destinationName: string;
  destinationAddress?: string;
  originCoordinates: [number, number]; // [lng, lat]
  destinationCoordinates: [number, number]; // [lng, lat]
  distance: number; // meters
  duration: number; // seconds
  createdAt: number; // client-side ms timestamp (for sorting/display)
}

const MAX_RECENT_ROUTES = 5;

export async function saveRecentRoute(
  uid: string,
  route: Omit<RecentRoute, 'id' | 'createdAt'>
): Promise<void> {
  if (!db) return;
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  const existing: RecentRoute[] = (snap.exists() ? (snap.data().recentRoutes as RecentRoute[]) : []) || [];

  const newRoute: RecentRoute = {
    ...route,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };

  // Drop any existing entry for the same destination so re-navigating
  // somewhere recent doesn't just pile up duplicates, then keep only the
  // newest MAX_RECENT_ROUTES.
  const deduped = existing.filter(
    (r) =>
      r.destinationCoordinates[0] !== newRoute.destinationCoordinates[0] ||
      r.destinationCoordinates[1] !== newRoute.destinationCoordinates[1]
  );
  const updated = [newRoute, ...deduped].slice(0, MAX_RECENT_ROUTES);

  await setDoc(ref, { recentRoutes: updated, updatedAt: serverTimestamp() }, { merge: true });
}

export async function getRecentRoutes(uid: string): Promise<RecentRoute[]> {
  if (!db) return [];
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return [];
  return (snap.data().recentRoutes as RecentRoute[]) || [];
}
