import { describe, expect, it } from 'vitest';
import { createCityWorld } from '../../src/sim/world-factory';
import { GRID_HEIGHT, GRID_WIDTH } from '../../src/sim/constants/map';

describe('createCityWorld', () => {
  it('creates a steppable world at the configured grid size', () => {
    const world = createCityWorld({ seed: 42 });
    expect(world.grid.width).toBe(GRID_WIDTH);
    expect(world.grid.height).toBe(GRID_HEIGHT);
    for (let i = 0; i < 10; i++) world.step();
    expect(world.tick).toBe(10);
  });

  it('is deterministic for the same seed', () => {
    const a = createCityWorld({ seed: 7 });
    const b = createCityWorld({ seed: 7 });
    for (let i = 0; i < 25; i++) {
      a.step();
      b.step();
    }
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
  });
});
