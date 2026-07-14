import { describe, expect, it } from 'vitest';
import { createCitySim } from '../../src/sim/city';
import { cellIndex } from '../../src/sim/grid';
import { findLandBlock } from './helpers';

describe('zone painting', () => {
  it('preserves existing zones while filling eligible empty cells in the same drag', () => {
    const sim = createCitySim({ seed: 7, highwayEnabled: false });
    const base = findLandBlock(sim, 4, 3);
    const roadY = base.y + 2;

    expect(
      sim.world.submit('placeRoad', {
        ax: base.x,
        ay: roadY,
        bx: base.x + 3,
        by: roadY,
      }),
    ).toBe(true);
    sim.world.step();

    expect(
      sim.world.submit('zone', {
        zone: 'R',
        ax: base.x,
        ay: base.y + 1,
        bx: base.x,
        by: base.y + 1,
      }),
    ).toBe(true);
    sim.world.step();

    expect(
      sim.world.submit('zone', {
        zone: 'C',
        ax: base.x,
        ay: base.y + 1,
        bx: base.x + 1,
        by: base.y + 1,
      }),
    ).toBe(true);
    sim.world.step();

    expect(sim.zoneCells.get(cellIndex(base.x, base.y + 1))).toBe('R');
    expect(sim.zoneCells.get(cellIndex(base.x + 1, base.y + 1))).toBe('C');
  });

  it('rejects repainting a selection that contains no unzoned eligible cells', () => {
    const sim = createCitySim({ seed: 7, highwayEnabled: false });
    const base = findLandBlock(sim, 2, 3);
    const roadY = base.y + 2;
    const zoneY = base.y + 1;

    expect(
      sim.world.submit('placeRoad', {
        ax: base.x,
        ay: roadY,
        bx: base.x + 1,
        by: roadY,
      }),
    ).toBe(true);
    sim.world.step();
    expect(
      sim.world.submit('zone', {
        zone: 'I',
        ax: base.x,
        ay: zoneY,
        bx: base.x,
        by: zoneY,
      }),
    ).toBe(true);
    sim.world.step();

    expect(
      sim.world.submit('zone', {
        zone: 'R',
        ax: base.x,
        ay: zoneY,
        bx: base.x,
        by: zoneY,
      }),
    ).toBe(false);
    expect(sim.zoneCells.get(cellIndex(base.x, zoneY))).toBe('I');

    expect(
      sim.world.submit('dezone', {
        ax: base.x,
        ay: zoneY,
        bx: base.x,
        by: zoneY,
      }),
    ).toBe(true);
    sim.world.step();
    expect(
      sim.world.submit('zone', {
        zone: 'R',
        ax: base.x,
        ay: zoneY,
        bx: base.x,
        by: zoneY,
      }),
    ).toBe(true);
    sim.world.step();
    expect(sim.zoneCells.get(cellIndex(base.x, zoneY))).toBe('R');
  });
});
