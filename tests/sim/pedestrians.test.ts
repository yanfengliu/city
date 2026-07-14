import { describe, expect, it } from 'vitest';
import { refreshOccupancy } from '../../src/sim/buildings';
import { createCitySim, rebuildDerived, type CitySim } from '../../src/sim/city';
import { BUDGET_INTERVAL_TICKS } from '../../src/sim/constants/map';
import { cellIndex } from '../../src/sim/grid';
import { buildingAccessCell, findRoadCellPath } from '../../src/sim/traffic/pathing';
import type { BudgetReport, CitizenComponent, ZoneType } from '../../src/sim/types';
import { findLandBlock } from './helpers';

interface BuildingOptions {
  x: number;
  y: number;
  zone: ZoneType;
  residents?: number;
  jobsFilled?: number;
  abandoned?: boolean;
  powered?: boolean;
  watered?: boolean;
}

interface TownOptions {
  seed?: number;
  nextActivity?: 'work' | 'shop';
  shop?: Partial<Pick<BuildingOptions, 'jobsFilled' | 'abandoned' | 'powered' | 'watered'>>;
}

interface PurposefulTown {
  sim: CitySim;
  home: number;
  commercial: number;
  industrial: number;
  citizen: number;
  streetY: number;
}

function seedBuilding(sim: CitySim, options: BuildingOptions): number {
  let entity = -1;
  sim.world.runMaintenance(() => {
    entity = sim.world.createEntity();
    sim.world.setPosition(entity, { x: options.x, y: options.y });
    sim.world.addComponent(entity, 'building', {
      zone: options.zone,
      level: 1,
      w: 1,
      h: 1,
      residents: options.residents ?? 0,
      jobsFilled: options.jobsFilled ?? 0,
      abandoned: options.abandoned ?? false,
      upEvals: 0,
      badEvals: 0,
      badUtilityEvals: 0,
      recoverEvals: 0,
      powered: options.powered ?? true,
      watered: options.watered ?? true,
    });
  });
  return entity;
}

function seedCitizen(
  sim: CitySim,
  home: number,
  work: number,
  nextActivity: 'work' | 'shop',
): number {
  let entity = -1;
  sim.world.runMaintenance(() => {
    const homePosition = sim.world.getComponent(home, 'position');
    if (!homePosition) throw new Error('seed home has no position');
    entity = sim.world.createEntity();
    sim.world.setPosition(entity, { ...homePosition });
    const citizen: CitizenComponent = {
      home,
      work,
      phase: 'home',
      waitUntil: 0,
      nextActivity,
      shop: null,
      shopGen: null,
    };
    sim.world.addComponent(entity, 'citizen', citizen);
  });
  return entity;
}

/**
 * One straight, all-land street with every building connected through a
 * different interior cell of the same compressed road edge. This deliberately
 * catches the old access-node behavior that mapped every mid-edge building to
 * edge.a and treated its trip as an instant teleport.
 */
function purposefulTown(options: TownOptions = {}): PurposefulTown {
  const sim = createCitySim({ seed: options.seed ?? 7 });
  const base = findLandBlock(sim, 18, 5);
  const streetY = base.y + 2;
  expect(
    sim.world.submit('placeRoad', {
      ax: base.x,
      ay: streetY,
      bx: base.x + 17,
      by: streetY,
    }),
  ).toBe(true);
  sim.world.step();

  const buildingY = streetY + 1;
  const home = seedBuilding(sim, {
    x: base.x + 1,
    y: buildingY,
    zone: 'R',
    residents: 1,
  });
  const commercial = seedBuilding(sim, {
    x: base.x + 8,
    y: buildingY,
    zone: 'C',
    jobsFilled: options.shop?.jobsFilled ?? 1,
    abandoned: options.shop?.abandoned,
    powered: options.shop?.powered,
    watered: options.shop?.watered,
  });
  const industrial = seedBuilding(sim, {
    x: base.x + 15,
    y: buildingY,
    zone: 'I',
    jobsFilled: 1,
  });
  refreshOccupancy(sim);
  const citizen = seedCitizen(sim, home, industrial, options.nextActivity ?? 'work');
  return { sim, home, commercial, industrial, citizen, streetY };
}

function citizenOf(sim: CitySim, id: number): CitizenComponent {
  const citizen = sim.world.getComponent(id, 'citizen');
  if (!citizen) throw new Error(`missing citizen ${id}`);
  return citizen;
}

function walkerFor(sim: CitySim, citizen: number) {
  for (const id of [...sim.world.query('pedestrianPath', 'pedestrian')].sort((a, b) => a - b)) {
    const path = sim.world.getComponent(id, 'pedestrianPath');
    const motion = sim.world.getComponent(id, 'pedestrian');
    if (path?.citizen === citizen && motion) return { id, path, motion };
  }
  return null;
}

function stateCount(sim: CitySim, key: 'pendingRetailVisits' | 'completedShoppingTrips'): number {
  return (sim.world.getState(key) as number | undefined) ?? 0;
}

function stepUntil(sim: CitySim, predicate: () => boolean, maxTicks: number): void {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    sim.world.step();
  }
  expect(predicate(), `condition not reached within ${maxTicks} ticks`).toBe(true);
}

function recycleBuildingAs(
  sim: CitySim,
  building: number,
  zone: ZoneType,
): { generation: number; replacement: number } {
  const position = sim.world.getComponent(building, 'position');
  if (!position) throw new Error(`missing building position ${building}`);
  sim.world.runMaintenance(() => sim.world.destroyEntity(building));
  const replacement = seedBuilding(sim, { ...position, zone });
  refreshOccupancy(sim);
  return { generation: sim.world.getEntityGeneration(replacement), replacement };
}

function nextBudgetReport(sim: CitySim): BudgetReport {
  let captured: BudgetReport | undefined;
  const listener = (report: BudgetReport): void => {
    captured = report;
  };
  sim.world.on('budget', listener);
  try {
    stepUntil(sim, () => captured !== undefined, BUDGET_INTERVAL_TICKS + 1);
    return captured!;
  } finally {
    sim.world.off('budget', listener);
  }
}

describe('purposeful pedestrians', () => {
  it('routes exact access cells along one long edge instead of teleporting between its node endpoints', () => {
    const { sim, home, industrial, streetY } = purposefulTown();
    const homeAccess = buildingAccessCell(sim, home);
    const workAccess = buildingAccessCell(sim, industrial);

    expect(homeAccess).not.toBeNull();
    expect(workAccess).not.toBeNull();
    expect(homeAccess).toBe(cellIndex(sim.world.getComponent(home, 'position')!.x, streetY));
    expect(workAccess).toBe(cellIndex(sim.world.getComponent(industrial, 'position')!.x, streetY));
    expect(sim.roadGraph.cellToEdge.get(homeAccess!)).toBe(sim.roadGraph.cellToEdge.get(workAccess!));

    const path = findRoadCellPath(sim, home, industrial);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(2);
    expect(path![0]).toBe(homeAccess);
    expect(path![path!.length - 1]).toBe(workAccess);
    expect(path!.length).toBe(Math.abs((workAccess! % sim.terrain.width) - (homeAccess! % sim.terrain.width)) + 1);
    expect(path!.every((cell) => sim.roadCells.has(cell))).toBe(true);
  });

  it('walks an employed resident to work and through a complete commercial shopping round trip', () => {
    const { sim, citizen, commercial, industrial } = purposefulTown();
    let sawWalkingToWork = false;
    let sawWalkingToShop = false;
    let sawWalkingHomeFromShop = false;
    let completedRoundTrip = false;

    for (let i = 0; i < 6_000; i++) {
      const data = citizenOf(sim, citizen);
      const walker = walkerFor(sim, citizen);
      if (data.phase === 'toWork' && walker) sawWalkingToWork = true;
      if (data.phase === 'toShop' && walker) {
        sawWalkingToShop = true;
        expect(data.shop).toBe(commercial);
        expect(data.shopGen).toBe(sim.world.getEntityGeneration(commercial));
      }
      if (
        data.phase === 'toHome' &&
        walker &&
        stateCount(sim, 'completedShoppingTrips') > 0
      ) {
        sawWalkingHomeFromShop = true;
      }
      if (
        sawWalkingToWork &&
        sawWalkingToShop &&
        sawWalkingHomeFromShop &&
        stateCount(sim, 'completedShoppingTrips') > 0 &&
        data.phase === 'home' &&
        data.nextActivity === 'work' &&
        !walker
      ) {
        completedRoundTrip = true;
        break;
      }
      sim.world.step();
    }

    expect(sawWalkingToWork).toBe(true);
    expect(sawWalkingToShop).toBe(true);
    expect(sawWalkingHomeFromShop).toBe(true);
    expect(completedRoundTrip).toBe(true);
    expect(citizenOf(sim, citizen).home).not.toBe(industrial);
    expect(sim.world.getComponent(citizenOf(sim, citizen).home, 'building')?.zone).toBe('R');
    expect(sim.world.getComponent(citizenOf(sim, citizen).work!, 'building')?.zone).toBe('I');
    expect(sim.world.getComponent(commercial, 'building')?.zone).toBe('C');
  });

  it('labels a commercial employee separately from an industrial employee and a shopper', () => {
    const { sim, citizen, commercial } = purposefulTown();
    sim.world.runMaintenance(() => {
      sim.world.patchComponent(citizen, 'citizen', (data) => {
        data.work = commercial;
        data.nextActivity = 'work';
      });
    });

    stepUntil(sim, () => walkerFor(sim, citizen) !== null, 64);
    expect(walkerFor(sim, citizen)?.path.purpose).toBe('commercial-work');
    expect(citizenOf(sim, citizen).phase).toBe('toWork');
  });

  it('selects only staffed, live, powered, and watered commercial destinations', () => {
    const invalidShops: Array<{ label: string; shop: TownOptions['shop'] }> = [
      { label: 'unstaffed', shop: { jobsFilled: 0 } },
      { label: 'abandoned', shop: { jobsFilled: 1, abandoned: true } },
      { label: 'unpowered', shop: { jobsFilled: 1, powered: false } },
      { label: 'unwatered', shop: { jobsFilled: 1, watered: false } },
    ];

    for (const scenario of invalidShops) {
      const { sim, citizen } = purposefulTown({ nextActivity: 'shop', shop: scenario.shop });
      let selectedInvalidShop = false;
      for (let i = 0; i < 24; i++) {
        const data = citizenOf(sim, citizen);
        if (data.phase === 'toShop' || data.phase === 'atShop' || data.shop !== null) {
          selectedInvalidShop = true;
        }
        sim.world.step();
      }
      expect(selectedInvalidShop, scenario.label).toBe(false);
      expect(stateCount(sim, 'pendingRetailVisits'), scenario.label).toBe(0);
      expect(stateCount(sim, 'completedShoppingTrips'), scenario.label).toBe(0);
    }

    const { sim, citizen, commercial } = purposefulTown({ nextActivity: 'shop' });
    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'toShop', 64);
    expect(citizenOf(sim, citizen).shop).toBe(commercial);
    expect(citizenOf(sim, citizen).shopGen).toBe(sim.world.getEntityGeneration(commercial));
  });

  it('records a retail visit only when the shopper reaches the commercial building', () => {
    const { sim, citizen, commercial } = purposefulTown({ nextActivity: 'shop' });
    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'toShop', 64);

    expect(stateCount(sim, 'pendingRetailVisits')).toBe(0);
    expect(stateCount(sim, 'completedShoppingTrips')).toBe(0);
    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'atShop', 1_000);

    expect(citizenOf(sim, citizen).shop).toBe(commercial);
    expect(stateCount(sim, 'pendingRetailVisits')).toBe(1);
    expect(stateCount(sim, 'completedShoppingTrips')).toBe(1);
    expect(walkerFor(sim, citizen)).toBeNull();
  });

  it('does not credit a shop entity id recycled during the outbound walk', () => {
    const { sim, citizen, commercial } = purposefulTown({ nextActivity: 'shop' });
    stepUntil(
      sim,
      () => citizenOf(sim, citizen).phase === 'toShop' && walkerFor(sim, citizen) !== null,
      64,
    );
    const selectedGeneration = citizenOf(sim, citizen).shopGen;

    const recycled = recycleBuildingAs(sim, commercial, 'R');
    expect(recycled.replacement).toBe(commercial);
    expect(recycled.generation).not.toBe(selectedGeneration);
    stepUntil(sim, () => walkerFor(sim, citizen) === null, 1_000);

    expect(citizenOf(sim, citizen).phase).toBe('home');
    expect(citizenOf(sim, citizen).nextActivity).toBe('shop');
    expect(citizenOf(sim, citizen).shop).toBeNull();
    expect(stateCount(sim, 'pendingRetailVisits')).toBe(0);
    expect(stateCount(sim, 'completedShoppingTrips')).toBe(0);
    expect(nextBudgetReport(sim).retailIncome).toBe(0);
  });

  it('does not use a recycled shop id as the origin of the return leg', () => {
    const { sim, citizen, commercial } = purposefulTown({ nextActivity: 'shop' });
    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'atShop', 1_000);
    const selectedGeneration = citizenOf(sim, citizen).shopGen;
    expect(stateCount(sim, 'completedShoppingTrips')).toBe(1);

    const recycled = recycleBuildingAs(sim, commercial, 'R');
    expect(recycled.replacement).toBe(commercial);
    expect(recycled.generation).not.toBe(selectedGeneration);
    stepUntil(sim, () => citizenOf(sim, citizen).phase === 'home', 1_000);

    expect(walkerFor(sim, citizen)).toBeNull();
    expect(citizenOf(sim, citizen).nextActivity).toBe('work');
    expect(citizenOf(sim, citizen).shop).toBeNull();
    expect(stateCount(sim, 'pendingRetailVisits')).toBe(1);
    expect(stateCount(sim, 'completedShoppingTrips')).toBe(1);
  });

  it('cancels a severed walking route without creating a retail visit', () => {
    const { sim, citizen } = purposefulTown({ nextActivity: 'shop' });
    stepUntil(
      sim,
      () =>
        citizenOf(sim, citizen).phase === 'toShop' &&
        walkerFor(sim, citizen) !== null,
      64,
    );

    const walker = walkerFor(sim, citizen)!;
    const cutIndex = Math.floor(walker.path.cells.length / 2);
    expect(cutIndex).toBeGreaterThan(walker.motion.segmentIndex);
    const cut = walker.path.cells[cutIndex];
    const disconnectedBefore =
      (sim.world.getState('disconnectedTrips') as number | undefined) ?? 0;
    expect(
      sim.world.submit('bulldozeRoad', {
        ax: cut % sim.terrain.width,
        ay: Math.floor(cut / sim.terrain.width),
        bx: cut % sim.terrain.width,
        by: Math.floor(cut / sim.terrain.width),
      }),
    ).toBe(true);
    sim.world.step();

    expect(walkerFor(sim, citizen)).toBeNull();
    expect(citizenOf(sim, citizen).phase).toBe('home');
    expect(citizenOf(sim, citizen).nextActivity).toBe('shop');
    expect(stateCount(sim, 'pendingRetailVisits')).toBe(0);
    expect(stateCount(sim, 'completedShoppingTrips')).toBe(0);
    expect(sim.world.getState('disconnectedTrips')).toBe(disconnectedBefore + 1);
  });

  it('repeats the work-shopping simulation deterministically', { timeout: 30_000 }, () => {
    const run = (): { snapshot: string; completed: number } => {
      const { sim } = purposefulTown({ seed: 19 });
      for (let i = 0; i < 2_000; i++) sim.world.step();
      return {
        snapshot: JSON.stringify(sim.world.serialize()),
        completed: stateCount(sim, 'completedShoppingTrips'),
      };
    };

    const first = run();
    const second = run();
    expect(first.completed).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it('converges after save/load from the middle of a walking trip', () => {
    const seed = 23;
    const { sim, citizen } = purposefulTown({ seed, nextActivity: 'shop' });
    stepUntil(
      sim,
      () =>
        citizenOf(sim, citizen).phase === 'toShop' &&
        walkerFor(sim, citizen) !== null,
      64,
    );
    sim.world.step();

    const activeWalker = walkerFor(sim, citizen);
    expect(activeWalker).not.toBeNull();

    const snapshot = JSON.parse(JSON.stringify(sim.world.serialize()));
    const restored = createCitySim({ seed });
    restored.world.applySnapshot(snapshot);
    rebuildDerived(restored);

    expect(restored.world.getComponent(activeWalker!.id, 'pedestrianPath')).toEqual(
      activeWalker!.path,
    );
    expect(restored.world.getComponent(activeWalker!.id, 'pedestrian')).toEqual(
      activeWalker!.motion,
    );
    for (let i = 0; i < 800; i++) {
      sim.world.step();
      restored.world.step();
    }
    expect(JSON.stringify(restored.world.serialize())).toBe(JSON.stringify(sim.world.serialize()));
  });
});
