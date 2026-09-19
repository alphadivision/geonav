'use client';

import React from 'react';
import { LogOut, Loader2 } from 'lucide-react';
import { isFirebaseConfigured } from '@/lib/firebase/config';
import type { User as FirebaseUser } from '@/lib/firebase/authService';
import type { Translations } from '@/lib/i18n';

export type AuthUiState = 'idle' | 'loading' | 'error';

interface AccountSectionProps {
  t: Translations;
  // Auth state now lives in NavigationMapClient (a single, always-mounted
  // onAuthStateChanged subscription — see its mount effect) rather than
  // here. This section previously ran its own independent subscription,
  // but since it only mounts when the Settings panel is opened, that
  // subscription could miss the moment a Google redirect sign-in actually
  // completed, leaving the UI stuck on "Sign in with Google" until
  // something else happened to remount it. Lifting the subscription to the
  // top level (always mounted, matches every other setting in this panel)
  // fixes that: by the time this component ever renders, `user` already
  // reflects the real, current Firebase auth state.
  user: FirebaseUser | null;
  authStatus: AuthUiState;
  onSignIn: () => void;
  onSignOut: () => void;
}

// Plain multi-color "G" mark — kept as inline SVG since no icon set already
// in the project (lucide-react, heroicons) includes a brand-accurate Google
// glyph, and pulling in a whole icon pack for one icon would work against
// the "keep it lightweight" requirement.
function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.6H1.26A12 12 0 0 0 0 12c0 1.94.46 3.77 1.26 5.4l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.76c1.77 0 3.35.61 4.6 1.8l3.45-3.45C17.95 1.19 15.23 0 12 0 7.31 0 3.26 2.69 1.26 6.6l4.01 3.11C6.22 6.87 8.87 4.76 12 4.76Z" />
    </svg>
  );
}

export default function AccountSection({ t, user, authStatus, onSignIn, onSignOut }: AccountSectionProps) {
  const avatarUrl = user?.photoURL ?? undefined;
  const displayName = user?.displayName ?? user?.email ?? undefined;

  return (
    <div className="px-4 py-3 border-b border-white/10">
      <div className="text-xs text-muted-foreground mb-2">{t.account}</div>

      {user ? (
        <div>
          <div className="flex items-center gap-2.5">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0 object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-bold flex-shrink-0">
                {displayName?.charAt(0).toUpperCase() ?? '?'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{displayName}</p>
              <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>

          {/* Plan / Premium placeholder — no Stripe wiring yet, just the
              spot where subscription status + upgrade will live. */}
          <div className="mt-3 pt-3 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{t.accountPlan}</span>
              <span className="text-xs font-semibold text-foreground">{t.accountPlanFree}</span>
            </div>
            <button
              type="button"
              className="w-full py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow-sm hover:bg-primary/90 active:scale-[0.98] transition-all"
            >
              {t.buyPremium}
            </button>
          </div>

          <button
            onClick={onSignOut}
            className="w-full mt-2 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors active:scale-95"
            aria-label={t.signOut}
            title={t.signOut}
          >
            <LogOut size={14} />
            {t.signOut}
          </button>
        </div>
      ) : (
        <div>
          <button
            onClick={onSignIn}
            disabled={authStatus === 'loading'}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white text-[#1f1f1f] text-xs font-semibold shadow-sm hover:bg-white/90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:active:scale-100"
          >
            {authStatus === 'loading' ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <GoogleIcon size={16} />
            )}
            {authStatus === 'loading' ? t.authLoading : t.signInWithGoogle}
          </button>
          {authStatus === 'error' && (
            <p className="text-[10px] text-danger mt-1.5 text-center">
              {isFirebaseConfigured ? t.authError : t.authNotConfigured}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
