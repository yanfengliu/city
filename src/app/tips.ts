import { GRID_HEIGHT, GRID_WIDTH } from '../sim/constants/map';
import { HIGHWAY_CELLS, HIGHWAY_CELL_SET, HIGHWAY_COLUMN } from '../sim/constants/highway';
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
  /** Installed capacity is below total load — the fix is another plant/pump, not
   * more lines/pipes. Lets the power/water tip name the real bottleneck. */
  powerOverCapacity: boolean;
  waterOverCapacity: boolean;
  /** Placed service buildings, and whether any is a school (gates level 3). */
  structureCount: number;
  hasSchool: boolean;
  /** First affected building, for the fly-to target on power/water tips. */
  firstUnpowered?: { x: number; y: number };
  firstUnwatered?: { x: number; y: number };
}

/** A building reduced to what the utility tips read. */
export interface UtilityBuildingView {
  id: number;
  x: number;
  y: number;
  powered: boolean;
  watered: boolean;
}

/**
 * Utility-tip inputs derived from EVERY building — abandoned ones included. A
 * building that went dark or dry and then abandoned still needs power/water to
 * recover, so it must keep the power/water tip alive (and keep `utilitiesSettled`
 * false). Counting only live buildings makes a mass-abandoned city read as
 * "fully powered+watered", which hides the actual fix and wrongly surfaces the
 * services/level-up tip at the worst moment. The flood-fill keeps `powered`/
 * `watered` current on abandoned buildings, so their flags are trustworthy here.
 * The fly-to target is the lowest-id affected building (deterministic).
 */
export function utilityTipFacts(buildings: readonly UtilityBuildingView[]): {
  unpowered: number;
  unwatered: number;
  firstUnpowered?: { x: number; y: number };
  firstUnwatered?: { x: number; y: number };
} {
  let unpowered = 0;
  let unwatered = 0;
  let firstUnpowered: UtilityBuildingView | undefined;
  let firstUnwatered: UtilityBuildingView | undefined;
  for (const b of buildings) {
    if (!b.powered) {
      unpowered++;
      if (!firstUnpowered || b.id < firstUnpowered.id) firstUnpowered = b;
    }
    if (!b.watered) {
      unwatered++;
      if (!firstUnwatered || b.id < firstUnwatered.id) firstUnwatered = b;
    }
  }
  return {
    unpowered,
    unwatered,
    firstUnpowered: firstUnpowered && { x: firstUnpowered.x, y: firstUnpowered.y },
    firstUnwatered: firstUnwatered && { x: firstUnwatered.x, y: firstUnwatered.y },
  };
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
        target: { x: HIGHWAY_COLUMN, y: 5 },
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
  // Surface the utility tips from ZONING time, not just once buildings exist:
  // buildings start a 60s utility-grace clock the moment they grow, so a player
  // who only learns about power/water then is already racing it. Prompting at
  // zoning lets them pre-wire so the first buildings grow already-served.
  const zonedOrBuilt = ctx.buildings > 0 || ctx.zonedCells > 0;
  if (zonedOrBuilt && (!ctx.hasPlant || ctx.unpowered > 0)) {
    tips.push({
      id: 'power',
      text: '⚡ Power your city — buildings go dark without it.',
      target: ctx.firstUnpowered,
      steps: [
        { text: 'Place a Coal or Wind plant — it powers buildings within 2 cells of it.', done: ctx.hasPlant },
        {
          // Once a plant exists but buildings stay dark, name the real fix: if
          // the network is over capacity, more lines won't help — add a plant.
          text:
            ctx.hasPlant && ctx.powerOverCapacity
              ? 'Add another plant — your buildings need more power than you generate.'
              : 'Drag Lines to carry power to any buildings farther than that.',
          done: ctx.hasPlant && ctx.unpowered === 0,
        },
      ],
    });
  }
  if (zonedOrBuilt && (!ctx.hasPump || ctx.unwatered > 0)) {
    tips.push({
      id: 'water',
      text: '💧 Supply water — dry buildings are abandoned.',
      target: ctx.firstUnwatered,
      steps: [
        { text: 'Place a Pump beside water — it supplies buildings within 2 cells of it.', done: ctx.hasPump },
        {
          text:
            ctx.hasPump && ctx.waterOverCapacity
              ? 'Add another pump — your buildings need more water than you supply.'
              : 'Drag Pipes to carry water to any buildings farther than that.',
          done: ctx.hasPump && ctx.unwatered === 0,
        },
      ],
    });
  }
  // Once the city is stably powered and watered, teach the growth lever:
  // services raise land value, and buildings only level up when it's high.
  const utilitiesSettled =
    ctx.hasPlant && ctx.unpowered === 0 && ctx.hasPump && ctx.unwatered === 0;
  if (ctx.buildings > 0 && utilitiesSettled && (ctx.structureCount === 0 || !ctx.hasSchool)) {
    tips.push({
      id: 'services',
      text: '🏛 Grow up, not just out — services raise land value so buildings can level up.',
      steps: [
        { text: 'Place a Fire, Police, or Clinic beside a road.', done: ctx.structureCount >= 1 },
        { text: 'Add a School — it lets buildings reach level 3.', done: ctx.hasSchool },
      ],
    });
  }
  return tips;
}
