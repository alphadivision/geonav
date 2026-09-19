import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

// Single source of truth for Firebase setup — every other file under
// src/lib/firebase/* imports `auth`/`db` from here rather than touching
// firebase/app directly, so there is exactly one place that knows about the
// config/env vars. Add src/lib/firebase/subscriptionService.ts alongside
// authService.ts/userService.ts/routesService.ts when Stripe subscription
// data needs its own Firestore collection later — same pattern, same `db`.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
};

// The project ships with placeholder values (see .env) until real ones are
// pasted in from the Firebase Console — detect that case explicitly so the
// UI can show a clean "not configured yet" state instead of Firebase
// throwing on a malformed/placeholder API key.
export const isFirebaseConfigured =
  !!firebaseConfig.apiKey &&
  !!firebaseConfig.projectId &&
  !!firebaseConfig.appId &&
  !firebaseConfig.apiKey.toLowerCase().includes('dummy') &&
  !firebaseConfig.projectId.toLowerCase().includes('dummy');

// Only actually initialize when configured — unlike Supabase's createClient,
// Firebase's SDK can throw synchronously on a clearly-invalid config, so
// `auth`/`db` are nullable and every consumer must check isFirebaseConfigured
// (or just null-check auth/db) before use rather than assuming they exist.
let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

if (isFirebaseConfigured) {
  app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  authInstance = getAuth(app);
  // browserLocalPersistence is already getAuth()'s default, but set it
  // explicitly so the signed-in session survives page refreshes/reopening
  // the app (required — see authService.ts for the popup-based Google
  // sign-in flow). Fired and forgotten at module init, well before any
  // user-triggered sign-in call has a chance to race it.
  setPersistence(authInstance, browserLocalPersistence).catch((err) => {
    console.error('[firebase-auth] setPersistence failed:', err);
  });
  dbInstance = getFirestore(app);
}

export const firebaseApp = app;
export const auth = authInstance;
export const db = dbInstance;
