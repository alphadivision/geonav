import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth } from './config';
import { upsertUserProfile } from './userService';

export type { User };

// Popup flow (not signInWithRedirect) — switched after confirming in
// production that signInWithRedirect's getRedirectResult() reliably came
// back null here: this project's authDomain (the default
// *.firebaseapp.com one) differs from the app's actual hosting domain, and
// modern browsers' third-party storage restrictions break the redirect
// handoff between those two domains — a known Firebase platform limitation
// with no code-level fix short of a custom authDomain (see
// https://firebase.google.com/docs/auth/web/redirect-best-practices).
// signInWithPopup doesn't need that cross-domain storage relay (it
// communicates via postMessage instead), and resolves/rejects directly in
// the calling code rather than only surfacing state via a page reload.
const googleProvider = new GoogleAuthProvider();

// Subscribes to auth state and keeps the signed-in user's Firestore profile
// up to date. Fires once immediately with the current state, then again on
// every sign-in/sign-out — a cheap merge-write on each, see userService.
// This is the ONE place onAuthStateChanged is registered (see
// NavigationMapClient's mount effect, the only caller) — every other part
// of the app (AccountSection, etc.) receives the resolved user as a prop,
// never subscribes independently.
export function subscribeToAuthState(callback: (user: User | null) => void): () => void {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (user) => {
    callback(user);
    if (user) {
      upsertUserProfile(user).catch((err) => {
        console.error('[firebase-auth] Failed to save user profile:', err);
      });
    }
  });
}

// Resolves once the popup completes; the resulting signed-in user then
// arrives at the UI via the subscribeToAuthState subscription above (fires
// essentially immediately after this resolves), not from this return value
// directly — callers should treat this as "did the sign-in attempt itself
// succeed or fail", not as the source of the user object.
export async function signInWithGoogle(): Promise<void> {
  if (!auth) throw new Error('Firebase is not configured');
  await signInWithPopup(auth, googleProvider);
}

export async function signOutUser(): Promise<void> {
  if (!auth) return;
  await firebaseSignOut(auth);
}
