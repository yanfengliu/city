import type { TickDiff } from 'civ-engine';

export interface RenderComponentRemovals {
  buildings: number[];
  structures: number[];
}

/**
 * Projects removals by render component, never by generic entity destruction.
 * civ-engine may destroy and recycle an id in one tick; ComponentStore then
 * coalesces remove+set to an upsert-only diff for the replacement component.
 */
export function projectRenderComponentRemovals(
  diff: Pick<TickDiff, 'components'>,
): RenderComponentRemovals {
  return {
    buildings: [...(diff.components.building?.removed ?? [])],
    structures: [...(diff.components.structure?.removed ?? [])],
  };
}
