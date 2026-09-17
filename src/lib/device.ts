// Device/browser capability detection — used to adapt map rendering cost for
// constrained in-car browsers without affecting normal desktop/mobile users.

/**
 * Detects Tesla's in-car browser (QtWebEngine-based "QtCarBrowser"). This is
 * the same heuristic used elsewhere for Tesla detection: matching the actual
 * browser engine token is more reliable than matching "Tesla" alone, since
 * not all vehicle firmware versions include it in the UA string.
 */
export function isTeslaBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('qtcarbrowser') || ua.includes('tesla');
}
