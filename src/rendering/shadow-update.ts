/**
 * Minimum simulated-day movement before a static sun shadow is refreshed.
 * With 4,096 ticks/day this is four ticks: about 5 updates/s at 1x and 20/s
 * at 4x, while caster changes still invalidate immediately.
 */
export const SHADOW_DAY_FRACTION_STEP = 1 / 1024;

function normalizeFraction(value: number): number {
  return ((value % 1) + 1) % 1;
}

/** Tracks when the cached directional-light shadow map needs another render. */
export class ShadowMapUpdatePolicy {
  private dirty = true;
  private lastFraction: number | null = null;

  constructor(private readonly minFractionDelta = SHADOW_DAY_FRACTION_STEP) {
    if (!(minFractionDelta > 0 && minFractionDelta <= 0.5)) {
      throw new RangeError('shadow update step must be in (0, 0.5]');
    }
  }

  /** Marks a changed tree/building/structure/bridge caster for the next frame. */
  invalidate(): void {
    this.dirty = true;
  }

  /** Returns true exactly when the renderer should refresh its shadow map. */
  consume(fraction: number, active: boolean): boolean {
    if (!active) return false;
    const normalized = normalizeFraction(fraction);
    const directDelta = this.lastFraction === null ? 1 : Math.abs(normalized - this.lastFraction);
    const wrappedDelta = Math.min(directDelta, 1 - directDelta);
    if (!this.dirty && wrappedDelta + Number.EPSILON < this.minFractionDelta) return false;
    this.dirty = false;
    this.lastFraction = normalized;
    return true;
  }
}

interface ShadowMapRefreshState {
  needsUpdate: boolean;
}

/** Rebuilds cached GPU shadow state after WebGL has recreated its resources. */
export function refreshShadowsAfterContextRestore(
  target: EventTarget,
  policy: ShadowMapUpdatePolicy,
  shadowMap: ShadowMapRefreshState,
): void {
  target.addEventListener('webglcontextrestored', () => {
    policy.invalidate();
    shadowMap.needsUpdate = true;
  });
}
