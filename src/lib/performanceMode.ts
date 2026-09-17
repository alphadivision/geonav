import { isTeslaBrowser } from './device';

export type PerformanceMode = 'normal' | 'lite';

const OVERRIDE_KEY = 'teslanav_perf_mode_override';

/**
 * Resolves the active performance mode. Tesla's in-car browser (detected via
 * isTeslaBrowser()) defaults to 'lite'; everything else defaults to 'normal'.
 *
 * A manual localStorage override always wins over detection — this is the
 * "clean internal/manual performance-mode architecture" fallback: even if
 * Tesla detection ever proves unreliable on some firmware, lite mode can
 * still be enabled/disabled without any code changes, by setting
 * localStorage['teslanav_perf_mode_override'] to 'lite' or 'normal'.
 */
export function getPerformanceMode(): PerformanceMode {
  if (typeof window === 'undefined') return 'normal';
  try {
    const override = window.localStorage.getItem(OVERRIDE_KEY);
    if (override === 'lite' || override === 'normal') return override;
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through to detection
  }
  return isTeslaBrowser() ? 'lite' : 'normal';
}

/** Sets `data-perf-mode` on <html> so CSS (e.g. glass-blur intensity) can react. */
export function applyPerformanceModeToDocument(mode: PerformanceMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-perf-mode', mode);
}
