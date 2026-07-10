import { describe, expect, it } from 'vitest';
import type { TickDiff } from 'civ-engine';
import { projectRenderComponentRemovals } from '../../src/worker/diff-projection';

function diffWith(
  components: TickDiff['components'],
  destroyed: number[] = [],
): TickDiff {
  return {
    tick: 1,
    entities: { created: [], destroyed },
    components,
    resources: {},
    state: { set: {}, removed: [] },
    tags: [],
    metadata: [],
  };
}

describe('worker render diff projection', () => {
  it('does not remove an upsert-only component when its entity id was recycled', () => {
    const diff = diffWith(
      {
        structure: {
          set: [[7, { type: 'fireStation' }]],
          removed: [],
        },
      },
      [7],
    );

    expect(projectRenderComponentRemovals(diff)).toEqual({ buildings: [], structures: [] });
  });

  it('forwards only component removals to their matching render streams', () => {
    const diff = diffWith({
      building: { set: [], removed: [3] },
      structure: { set: [], removed: [4] },
      citizen: { set: [], removed: [5] },
    });

    expect(projectRenderComponentRemovals(diff)).toEqual({
      buildings: [3],
      structures: [4],
    });
  });
});
