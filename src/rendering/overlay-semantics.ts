/**
 * One colour language for every overlay (docs/design/vision.md pillar 3:
 * readable). Whatever the player is inspecting, a colour means the same thing:
 *
 *   grey    nothing to report here — unaffected, or outside the system
 *   blue    the network — deep for the infrastructure itself (plant, lines,
 *           poles, pumps, pipes, or the service building), and a pale wash
 *           for its bare reach, where a new building would connect
 *   green   what the network delivers: a building it actually serves
 *   yellow  under-served — the building is missing something but coping
 *   red     failing — on the edge of abandonment, or already abandoned
 *
 * So one glance separates cause (blue) from effect (green) from trouble
 * (yellow/red). Coverage overlays (fire, police, health, education) stop at
 * blue/green/grey: missing coverage costs land value but never abandons a
 * building, so painting it red would lie about the stakes.
 */

export type OverlayStatus =
  | 'neutral'
  | 'reach'
  | 'provided'
  | 'source'
  | 'warn'
  | 'severe';

/** RGBA (0-255) per status. Alpha carries the shade ordering within a family. */
export const OVERLAY_STATUS_RGBA: Record<OverlayStatus, readonly [number, number, number, number]> = {
  // Achromatic, so unaffected ground stays the greyscale the world already is.
  neutral: [182, 182, 182, 30],
  // The network's bare reach: a pale wash of the infrastructure's own blue, so
  // "you could connect here" never gets mistaken for "this is served".
  reach: [140, 180, 236, 52],
  // A building the network actually reached — solid, saturated green.
  provided: [64, 176, 88, 140],
  // The infrastructure itself — deep blue, the darkest thing on the map.
  source: [30, 84, 176, 225],
  warn: [240, 196, 62, 175],
  severe: [214, 62, 48, 225],
};

/** Opaque CSS colour for a status — legend swatches, so the key cannot drift. */
export function overlayStatusCss(status: OverlayStatus): string {
  const [r, g, b] = OVERLAY_STATUS_RGBA[status];
  return `rgb(${r}, ${g}, ${b})`;
}

/** Fields whose value is a nuisance (more is worse) versus a benefit. */
export type OverlayFieldKind =
  | 'pollution'
  | 'noise'
  | 'landValue'
  | 'fireCoverage'
  | 'policeCoverage'
  | 'healthCoverage'
  | 'educationCoverage'
  | 'parkCoverage';

/** Normalised value at which a nuisance stops being a nuisance and starts being a problem. */
export const FIELD_WARN_AT = 0.15;
/** Normalised value at which a nuisance becomes severe. */
export const FIELD_SEVERE_AT = 0.65;
/** Land value at or below this reads as failing; at or above the warn line it reads as healthy. */
export const LAND_VALUE_SEVERE_AT = 0.2;
export const LAND_VALUE_OK_AT = 0.5;

const COVERAGE_FIELDS: ReadonlySet<OverlayFieldKind> = new Set([
  'fireCoverage',
  'policeCoverage',
  'healthCoverage',
  'educationCoverage',
  'parkCoverage',
]);

/**
 * Status for a normalised (0-1) field sample. Nuisance fields climb
 * neutral → warn → severe; land value runs the other way; coverage is binary
 * and never alarms.
 */
export function fieldStatus(field: OverlayFieldKind, value: number): OverlayStatus {
  const v = Math.min(Math.max(value, 0), 1);
  if (COVERAGE_FIELDS.has(field)) return v > 0 ? 'provided' : 'neutral';
  if (field === 'landValue') {
    if (v <= LAND_VALUE_SEVERE_AT) return 'severe';
    if (v < LAND_VALUE_OK_AT) return 'warn';
    return 'provided';
  }
  if (v < FIELD_WARN_AT) return 'neutral';
  return v >= FIELD_SEVERE_AT ? 'severe' : 'warn';
}

/**
 * How strongly to draw a field cell within its status band, in 0-1. Keeps a
 * light haze visibly lighter than a choking one without leaving the band's
 * colour — the status decides the hue, this decides the weight.
 */
export function fieldStatusIntensity(field: OverlayFieldKind, value: number): number {
  const v = Math.min(Math.max(value, 0), 1);
  // Coverage and land value are graded states, not intensities — full weight.
  if (COVERAGE_FIELDS.has(field) || field === 'landValue') return 1;
  if (v < FIELD_WARN_AT) return 1;
  const band =
    v >= FIELD_SEVERE_AT
      ? (v - FIELD_SEVERE_AT) / (1 - FIELD_SEVERE_AT)
      : (v - FIELD_WARN_AT) / (FIELD_SEVERE_AT - FIELD_WARN_AT);
  // Never fully transparent: a cell in a band is always at least 70% weight.
  return 0.7 + 0.3 * Math.min(Math.max(band, 0), 1);
}

/** The per-building facts an overlay needs to grade a utility. */
export interface UtilityBuildingState {
  powered: boolean;
  watered: boolean;
  abandoned: boolean;
  /** 0-1 progress toward utility abandonment (see BuildingView.utilityDistress). */
  utilityDistress: number;
}

/** Distress at or above this paints red rather than yellow. */
export const UTILITY_SEVERE_AT = 0.5;

/**
 * Grades one building for the power or water overlay. Only the utility being
 * inspected counts, so a watered-but-unpowered building is a problem on the
 * power overlay and healthy on the water one.
 */
export function utilityStatus(
  mode: 'power' | 'water',
  building: UtilityBuildingState,
): OverlayStatus {
  if (building.abandoned) return 'severe';
  const ok = mode === 'power' ? building.powered : building.watered;
  if (ok) return 'provided';
  return building.utilityDistress >= UTILITY_SEVERE_AT ? 'severe' : 'warn';
}
