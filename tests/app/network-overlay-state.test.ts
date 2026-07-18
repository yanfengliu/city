import { describe, expect, it } from 'vitest';
import {
  computeNetworkOverlayState,
  networkOverlayInputsChanged,
} from '../../src/app/network-overlay-state';
import type { BuildingView, StructureView } from '../../src/protocol/messages';
import { cellIndex } from '../../src/sim/grid';

const WIDTH = 40;
const HEIGHT = 8;
const Y = 3;

function building(
  id: number,
  x: number,
  options: Partial<BuildingView> = {},
): BuildingView {
  return {
    id,
    x,
    y: Y,
    w: 1,
    h: 1,
    kind: 'rci',
    zone: 'R',
    level: 1,
    abandoned: false,
    residents: 0,
    jobsFilled: 0,
    powered: false,
    watered: false,
    utilityDistress: 0,
    ...options,
  };
}

function service(id: number, x: number): StructureView {
  return { id, x, y: Y, w: 2, h: 2, kind: 'service', service: 'fireStation' };
}

describe('network overlay state', () => {
  it('mirrors live-building and service conduction to a fixpoint during brownouts', () => {
    const brownout = building(1, 10);
    const abandoned = building(2, 21, { abandoned: true });
    const disconnected = building(3, 30);
    const infrastructure = new Set([cellIndex(5, Y, WIDTH)]);

    const state = computeNetworkOverlayState({
      mode: 'power',
      infrastructure,
      buildings: [brownout, abandoned, disconnected],
      structures: [service(4, 15)],
      gridWidth: WIDTH,
      gridHeight: HEIGHT,
      radius: 5,
    });

    // Infrastructure reaches the brownout at x=10; that live growable still
    // conducts to the service at x=15, whose 2-wide footprint reaches x=21.
    expect(state.reach.has(cellIndex(21, Y, WIDTH))).toBe(true);
    expect(state.warn.has(cellIndex(10, Y, WIDTH))).toBe(true);
    expect(state.warn.has(cellIndex(30, Y, WIDTH))).toBe(true);

    // The abandoned x=21 building and disconnected island do not extend reach.
    expect(state.reach.has(cellIndex(26, Y, WIDTH))).toBe(false);
    expect(state.reach.has(cellIndex(35, Y, WIDTH))).toBe(false);
    expect(state.warn.has(cellIndex(21, Y, WIDTH))).toBe(false);
  });

  it('uses the selected utility flag for supplied/problem coloring', () => {
    const view = building(1, 5, { powered: true, watered: false });
    const infrastructure = new Set([cellIndex(5, Y, WIDTH)]);
    const water = computeNetworkOverlayState({
      mode: 'water',
      infrastructure,
      buildings: [view],
      structures: [],
      gridWidth: WIDTH,
      gridHeight: HEIGHT,
      radius: 5,
    });

    expect(water.supplied.size).toBe(0);
    expect(water.warn.has(cellIndex(5, Y, WIDTH))).toBe(true);
  });

  it('escalates a long-starved building from warn to severe', () => {
    const infrastructure = new Set([cellIndex(5, Y, WIDTH)]);
    const grade = (utilityDistress: number, abandoned = false) =>
      computeNetworkOverlayState({
        mode: 'power',
        infrastructure,
        buildings: [building(1, 5, { powered: false, utilityDistress, abandoned })],
        structures: [],
        gridWidth: WIDTH,
        gridHeight: HEIGHT,
        radius: 5,
      });
    const cell = cellIndex(5, Y, WIDTH);

    // Freshly unpowered: a warning, not yet a crisis.
    expect(grade(0.1).warn.has(cell)).toBe(true);
    expect(grade(0.1).severe.has(cell)).toBe(false);

    // Starved most of the way to abandonment: red.
    expect(grade(0.8).severe.has(cell)).toBe(true);
    expect(grade(0.8).warn.has(cell)).toBe(false);

    // Already abandoned buildings never extend reach, so they are not graded.
    expect(grade(1, true).warn.has(cell)).toBe(false);
  });

  it('refreshes for every worker payload that changes the overlay closure', () => {
    expect(networkOverlayInputsChanged('buildings')).toBe(true);
    expect(networkOverlayInputsChanged('structures')).toBe(true);
    expect(networkOverlayInputsChanged('networks')).toBe(true);
    expect(networkOverlayInputsChanged('roads')).toBe(false);
  });

  it('shows planning reach around a source-less conductor without marking supply', () => {
    const isolatedLine = cellIndex(30, Y, WIDTH);
    const nearby = building(5, 35);
    const state = computeNetworkOverlayState({
      mode: 'power',
      infrastructure: new Set([isolatedLine]),
      buildings: [nearby],
      structures: [],
      gridWidth: WIDTH,
      gridHeight: HEIGHT,
      radius: 5,
    });

    expect(state.reach.has(cellIndex(35, Y, WIDTH))).toBe(true);
    expect(state.warn.has(cellIndex(35, Y, WIDTH))).toBe(true);
    expect(state.supplied.size).toBe(0);
  });
});
