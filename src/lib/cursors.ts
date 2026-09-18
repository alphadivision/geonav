// Selectable vehicle/navigation cursor options — a small config list rather
// than a hardcoded single image, so adding another cursor later is just one
// more entry (+ one label translation key), not a code change anywhere else.
// Shared between MapCanvas.tsx (renders the marker) and MapControlsPanel.tsx
// (the Settings selector), so both stay in sync automatically.

export type CursorId = 'default' | 'arrow3d';

export interface CursorOption {
  id: CursorId;
  /** Public path to the PNG asset (transparent background expected). */
  assetUrl: string;
  /** On-screen size in px at the marker's natural scale. */
  displaySize: number;
}

// id: 'default' — the original, already-shipped cursor. Keeping its exact
// asset/size here (not just inline in MapCanvas) is what guarantees existing
// users see zero visual change: this is also DEFAULT_CURSOR_ID below.
export const CURSOR_OPTIONS: CursorOption[] = [
  { id: 'default', assetUrl: '/markers/arrow.png', displaySize: 40 },
  { id: 'arrow3d', assetUrl: '/markers/arrow-3d-red.png', displaySize: 44 },
];

export const DEFAULT_CURSOR_ID: CursorId = 'default';

export function getCursorOption(id: CursorId): CursorOption {
  return CURSOR_OPTIONS.find((option) => option.id === id) ?? CURSOR_OPTIONS[0];
}

export function isCursorId(value: string | null): value is CursorId {
  return value === 'default' || value === 'arrow3d';
}
