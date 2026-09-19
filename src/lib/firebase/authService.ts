import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth } from './config';
import { upsertUserProfile } from './userService';

export type { User };

// Redirect flow (not signInWithPopup) — a popup can be blocked or behave
// unpredictably in an embedded/kiosk-style browser like Tesla's; a full
// redirect is the more robust choice there, same reasoning as the previous
// Supabase implementation's redirect-based OAuth flow.
const googleProvider = new GoogleAuthProvider();

// Subscribes to auth state and keeps the signed-in user's Firestore profile
// up to date. Fires once immediately with the current state, then again on
// every sign-in/sign-out — a cheap merge-write on each, see userService.
export function subscribeToAuthState(callback: (user: User | null) => void): () => void {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (user) => {
    callback(user);
    if (user) {
      upsertUserProfile(user).catch((err) => {
        console.error('[firebase] Failed to save user profile:', err);
      });
    }
  });
}

// Must be called once on mount (before/alongside subscribeToAuthState) to
// pick up the result of a signInWithGoogle() redirect that just came back.
// A no-op (resolves immediately) if the page wasn't loaded as part of a
// redirect return.
export async function completeRedirectSignIn(): Promise<void> {
  if (!auth) return;
  try {
    await getRedirectResult(auth);
  } catch (err) {
    console.error('[firebase] Redirect sign-in failed:', err);
  }
}

export function signInWithGoogle(): Promise<void> {
  if (!auth) return Promise.reject(new Error('Firebase is not configured'));
  return signInWithRedirect(auth, googleProvider);
}

export async function signOutUser(): Promise<void> {
  if (!auth) return;
  await firebaseSignOut(auth);
}
