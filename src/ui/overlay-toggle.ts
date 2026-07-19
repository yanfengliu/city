/**
 * Overlay selection is a toggle, not a radio group: pressing the active
 * overlay's button puts the map back to its normal colours, so leaving an
 * overlay costs the same one click as entering it and never requires hunting
 * for the None button.
 *
 * Kept as pure data + one pure function so it is testable without a DOM; the
 * HUD owns the buttons themselves.
 */

/** Map overlay selection; field names mirror the protocol OverlayFieldName literals. */
export type OverlayName =
  | 'none'
  | 'pollution'
  | 'noise'
  | 'landValue'
  | 'traffic'
  | 'power'
  | 'water'
  | 'fireCoverage'
  | 'policeCoverage'
  | 'healthCoverage'
  | 'educationCoverage';

/** Every selectable overlay, in HUD button order. */
export const OVERLAY_IDS: readonly OverlayName[] = [
  'none',
  'pollution',
  'noise',
  'landValue',
  'traffic',
  'power',
  'water',
  'fireCoverage',
  'policeCoverage',
  'healthCoverage',
  'educationCoverage',
];

/**
 * Which overlay a click on `clicked` should select, given what is active now.
 * Pressing the active overlay clears it; 'none' is inert (it is already the
 * cleared state, so it can never toggle back into an overlay).
 */
export function nextOverlay(clicked: OverlayName, active: OverlayName): OverlayName {
  if (clicked === 'none') return 'none';
  return clicked === active ? 'none' : clicked;
}
