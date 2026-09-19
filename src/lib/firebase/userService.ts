import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './config';

// Firestore layout: users/{uid} — the profile fields live at the document
// root (this same doc also holds `recentRoutes`, see routesService.ts, and
// will hold subscription/billing fields later for Stripe).
export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  lastLoginAt: unknown; // Firestore server timestamp — not read back client-side
}

// Upserts the signed-in user's profile fields. Called every time auth state
// resolves to a real user (see authService's subscribeToAuthState) — cheap,
// merge-only write, so it's safe to call on every sign-in/session restore,
// not just the very first sign-up.
export async function upsertUserProfile(user: User): Promise<void> {
  if (!db) return;
  const ref = doc(db, 'users', user.uid);
  await setDoc(
    ref,
    {
      uid: user.uid,
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
      lastLoginAt: serverTimestamp(),
    },
    { merge: true }
  );
}
