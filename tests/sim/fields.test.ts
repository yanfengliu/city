import { describe, expect, it } from 'vitest';
import { createCitySim, rebuildDerived, type CitySim } from '../../src/sim/city';
import {
  LAND_VALUE_BASE,
  LAND_VALUE_WATER_BONUS,
} from '../../src/sim/constants/fields';
import { buildDistrict, findLandBlock } from './helpers';
import type { ZoneType } from '../../src/sim/types';

function zoneAnchors(sim: CitySim, zone: ZoneType): Array<{ x: number; y: number }> {
  const anchors: Array<{ x: number; y: number }> = [];
  for (const id of [...sim.world.query('building', 'position')].sort((a, b) => a - b)) {
    const building = sim.world.getComponent(id, 'building');
    const position = sim.world.getComponent(id, 'position');
    if (building && position && !building.abandoned && building.zone === zone) {
      anchors.push({ x: position.x, y: position.y });
    }
  }
  return anchors;
}

describe('fields (phase 4)', () => {
  it('industry raises pollution, drags neighboring land value down, and decays after bulldozing', () => {
    const sim = createCitySim({ seed: 7, fieldsEnabled: true });
    const base = findLandBlock(sim, 18, 26);
    buildDistrict(sim, 'R', base);
    buildDistrict(sim, 'I', { x: base.x, y: base.y + 8 });
    for (let i = 0; i < 600; i++) sim.world.step();

    const anchors = zoneAnchors(sim, 'I');
    expect(anchors.length).toBeGreaterThan(0);
    let peak = anchors[0];
    for (const anchor of anchors) {
      if (
        sim.fields.pollution.getAt(anchor.x, anchor.y) >
        sim.fields.pollution.getAt(peak.x, peak.y)
      ) {
        peak = anchor;
      }
    }
    expect(sim.fields.pollution.getAt(peak.x, peak.y)).toBeGreaterThan(0);
    // The polluted cluster's land value falls below the neutral baseline.
    expect(sim.scoreInputs.landValueAt(peak.x, peak.y)).toBeLessThan(LAND_VALUE_BASE);

    // Bulldoze the whole industrial district (buildings + its road spine).
    expect(
      sim.world.submit('bulldozeRect', {
        ax: base.x,
        ay: base.y + 8,
        bx: base.x + 17,
        by: base.y + 15,
      }),
    ).toBe(true);
    sim.world.step();
    const before = sim.fields.pollution.getAt(peak.x, peak.y);
    expect(before).toBeGreaterThan(0);
    for (let i = 0; i < 240; i++) sim.world.step();
    expect(sim.fields.pollution.getAt(peak.x, peak.y)).toBeLessThan(before);
  });

  it('values land near water above inland land on an empty map', () => {
    const sim = createCitySim({ seed: 7, fieldsEnabled: true });
    // Past the first landValue recompute (interval 16, offset 12 → tick 13).
    for (let i = 0; i < 32; i++) sim.world.step();

    const layer = sim.fields.landValue;
    const mask = sim.fields.nearWaterBlocks;
    let waterBlock = -1;
    let inlandBlock = -1;
    for (let b = 0; b < mask.length; b++) {
      if (mask[b] === 1 && waterBlock < 0) waterBlock = b;
      if (mask[b] === 0 && inlandBlock < 0) inlandBlock = b;
    }
    expect(waterBlock).toBeGreaterThanOrEqual(0);
    expect(inlandBlock).toBeGreaterThanOrEqual(0);

    const valueOf = (b: number) => layer.getCell(b % layer.width, Math.floor(b / layer.width));
    expect(valueOf(waterBlock)).toBeGreaterThanOrEqual(LAND_VALUE_BASE + LAND_VALUE_WATER_BONUS);
    expect(valueOf(waterBlock)).toBeGreaterThan(valueOf(inlandBlock));
  });

  it('levels residential up to 2 near services; school coverage educates the cell', () => {
    const sim = createCitySim({ seed: 7, fieldsEnabled: true });
    const base = findLandBlock(sim, 18, 8);
    buildDistrict(sim, 'R', base);
    // Four services on the top zone row, each 2x2 touching the road below.
    expect(sim.world.submit('placeService', { service: 'fireStation', x: base.x, y: base.y })).toBe(true);
    expect(sim.world.submit('placeService', { service: 'police', x: base.x + 2, y: base.y })).toBe(true);
    expect(sim.world.submit('placeService', { service: 'clinic', x: base.x + 4, y: base.y })).toBe(true);
    expect(sim.world.submit('placeService', { service: 'school', x: base.x + 6, y: base.y })).toBe(true);
    sim.world.step();

    for (let i = 0; i < 800; i++) sim.world.step();

    let maxLevel = 0;
    let anchor: { x: number; y: number } | null = null;
    for (const id of [...sim.world.query('building', 'position')].sort((a, b) => a - b)) {
      const building = sim.world.getComponent(id, 'building');
      const position = sim.world.getComponent(id, 'position');
      if (!building || !position || building.abandoned || building.zone !== 'R') continue;
      if (building.level > maxLevel) {
        maxLevel = building.level;
        anchor = position;
      }
    }
    expect(maxLevel).toBeGreaterThanOrEqual(2);
    expect(anchor).not.toBeNull();
    if (anchor) {
      // All four services cover the district; school coverage gates level 3.
      expect(sim.scoreInputs.coverageCount(anchor.x, anchor.y)).toBe(4);
      expect(sim.scoreInputs.educated(anchor.x, anchor.y)).toBe(true);
    }
  });

  it('restores field layers via rebuildDerived and replays identically', () => {
    const sim = createCitySim({ seed: 7, fieldsEnabled: true });
    const base = findLandBlock(sim, 18, 26);
    buildDistrict(sim, 'R', base);
    buildDistrict(sim, 'I', { x: base.x, y: base.y + 8 });
    expect(sim.world.submit('placeService', { service: 'school', x: base.x, y: base.y })).toBe(true);
    for (let i = 0; i < 600; i++) sim.world.step();
    expect(sim.fields.pollution.getState().cells.length).toBeGreaterThan(0);

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed: 7, fieldsEnabled: true });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);

    expect(JSON.stringify(restored.fields.pollution.getState())).toBe(
      JSON.stringify(sim.fields.pollution.getState()),
    );
    expect(JSON.stringify(restored.fields.noise.getState())).toBe(
      JSON.stringify(sim.fields.noise.getState()),
    );
    expect(JSON.stringify(restored.fields.landValue.getState())).toBe(
      JSON.stringify(sim.fields.landValue.getState()),
    );
    expect(JSON.stringify(restored.fields.coverage.school.getState())).toBe(
      JSON.stringify(sim.fields.coverage.school.getState()),
    );

    for (let i = 0; i < 200; i++) {
      sim.world.step();
      restored.world.step();
    }
    expect(JSON.stringify(restored.world.serialize())).toBe(JSON.stringify(sim.world.serialize()));
  });

  it('is deterministic with fields and services enabled', () => {
    const run = () => {
      const sim = createCitySim({ seed: 11, fieldsEnabled: true });
      const base = findLandBlock(sim, 18, 26);
      buildDistrict(sim, 'R', base);
      buildDistrict(sim, 'I', { x: base.x, y: base.y + 8 });
      expect(
        sim.world.submit('placeService', { service: 'fireStation', x: base.x, y: base.y }),
      ).toBe(true);
      for (let i = 0; i < 600; i++) sim.world.step();
      return JSON.stringify(sim.world.serialize());
    };
    expect(run()).toBe(run());
  });
});
