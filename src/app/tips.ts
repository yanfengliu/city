import { GRID_HEIGHT, GRID_WIDTH } from '../sim/constants/map';
import { HIGHWAY_CELLS, HIGHWAY_CELL_SET } from '../sim/constants/highway';
import type { Advisory } from '../ui/advisor';

/** Live client-mirror facts the tip checklists read. */
export interface TipContext {
  /** Road cells the player has drawn (excludes the seeded highway). */
  playerRoadCells: number;
  /** A player road cell is 4-adjacent to the highway — the city is linked out. */
  connectedToHighway: boolean;
  zonedCells: number;
  buildings: number;
  hasPlant: boolean;
  hasPump: boolean;
  unpowered: number;
  unwatered: number;
  /** First affected building, for the fly-to target on power/water tips. */
  firstUnpowered?: { x: number; y: number };
  firstUnwatered?: { x: number; y: number };
}

/** True once any non-highway road cell touches the highway (the outside link). */
export function isConnectedToHighway(roadCells: ReadonlySet<number>): boolean {
  for (const h of HIGHWAY_CELLS) {
    const x = h % GRID_WIDTH;
    const y = Math.floor(h / GRID_WIDTH);
    const neighbors = [
      x > 0 ? h - 1 : -1,
      x < GRID_WIDTH - 1 ? h + 1 : -1,
      y > 0 ? h - GRID_WIDTH : -1,
      y < GRID_HEIGHT - 1 ? h + GRID_WIDTH : -1,
    ];
    for (const n of neighbors) {
      if (n >= 0 && roadCells.has(n) && !HIGHWAY_CELL_SET.has(n)) return true;
    }
  }
  return false;
}

/**
 * The guided onboarding/utility tips, in priority order. Each is a checklist
 * whose completion is exactly its hide condition, so a tip stays (expanded, no
 * dismiss) until every requirement is checked off, then drops out on its own —
 * satisfying "all requirements met before it collapses". Until the city is
 * linked to the highway, only the founding tip shows (mirrors the old
 * draw-your-first-road gate).
 */
export function activeTips(ctx: TipContext): Advisory[] {
  if (!ctx.connectedToHighway) {
    return [
      {
        id: 'firstRoad',
        text: '🛣 Found your city — link a road to the highway gateway at the top of the map.',
        steps: [
          { text: 'Pick the Road tool and drag on grass to lay a street.', done: ctx.playerRoadCells >= 1 },
          { text: 'Extend it to touch the highway at the north edge.', done: ctx.connectedToHighway },
        ],
      },
    ];
  }

  const tips: Advisory[] = [];
  if (ctx.buildings === 0) {
    tips.push({
      id: 'firstZones',
      text: '🏘 Zone R, C and I within 2 cells of a road.',
      steps: [
        { text: 'Paint a Residential, Commercial or Industrial zone by a road.', done: ctx.zonedCells >= 1 },
        { text: 'Wait for your first building to grow on its own.', done: ctx.buildings >= 1 },
      ],
    });
  }
  if (ctx.buildings > 0 && (!ctx.hasPlant || ctx.unpowered > 0)) {
    tips.push({
      id: 'power',
      text: '⚡ Power your city — buildings go dark without it.',
      target: ctx.firstUnpowered,
      steps: [
        { text: 'Place a Coal or Wind plant on empty ground.', done: ctx.hasPlant },
        { text: 'Drag Lines until no building lacks power.', done: ctx.hasPlant && ctx.unpowered === 0 },
      ],
    });
  }
  if (ctx.buildings > 0 && (!ctx.hasPump || ctx.unwatered > 0)) {
    tips.push({
      id: 'water',
      text: '💧 Supply water — dry buildings are abandoned.',
      target: ctx.firstUnwatered,
      steps: [
        { text: 'Place a Pump on land right next to water.', done: ctx.hasPump },
        { text: 'Drag Pipes until no building lacks water.', done: ctx.hasPump && ctx.unwatered === 0 },
      ],
    });
  }
  return tips;
}
