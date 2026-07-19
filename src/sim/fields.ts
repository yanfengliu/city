import { Layer, type LayerState } from 'civ-engine';
import { GRID_HEIGHT, GRID_WIDTH } from './constants/map';
import {
  FIELD_DECAY_MIN,
  FIELD_MAX,
  LAND_VALUE_BASE,
  LAND_VALUE_BLOCK_SIZE,
  LAND_VALUE_COVERAGE_WEIGHT,
  LAND_VALUE_NOISE_WEIGHT,
  LAND_VALUE_POLLUTION_WEIGHT,
  LAND_VALUE_TREE_BONUS,
  LAND_VALUE_TREE_RADIUS,
  LAND_VALUE_WATER_BONUS,
  LAND_VALUE_WATER_RADIUS,
  NOISE_BLOCK_SIZE,
  NOISE_DECAY,
  NOISE_PER_COMMERCIAL_LEVEL,
  NOISE_PER_CONGESTION_BUCKET,
  NOISE_ROAD_BASE,
  POLLUTION_BLOCK_SIZE,
  POLLUTION_DECAY,
  POLLUTION_FALLOFF_RADIUS_BLOCKS,
  POLLUTION_PER_INDUSTRIAL_LEVEL,
} from './constants/fields';
import { COVERAGE_BLOCK_SIZE, SERVICE_TYPES } from './constants/services';
import { COAL_PLANT_POLLUTION } from './constants/utilities';
import { taxDemandPenaltyOf, taxPenaltyOf } from './economy';
import { cellIndex } from './grid';
import type { TerrainData } from './terrain';
import type { CitySim, ScoreInputs } from './city';
import type { CityWorld, FieldName, ServiceType } from './types';

/**
 * All field layers plus static per-block terrain masks. Layers are NOT
 * serialized by world.serialize(); each mirrors into a component on the
 * singleton mirror entity (see readFieldMirrors / the *Mirror components).
 */
export interface CityFields {
  pollution: Layer<number>;
  noise: Layer<number>;
  landValue: Layer<number>;
  coverage: Record<ServiceType, Layer<number>>;
  /** 1 per land-value block with water within LAND_VALUE_WATER_RADIUS (static). */
  nearWaterBlocks: Uint8Array;
}

function numberLayer(blockSize: number, defaultValue: number): Layer<number> {
  return new Layer<number>({
    worldWidth: GRID_WIDTH,
    worldHeight: GRID_HEIGHT,
    blockSize,
    defaultValue,
  });
}

/**
 * Water proximity per land-value block, precomputed once from terrain:
 * 1 when any water cell lies within LAND_VALUE_WATER_RADIUS (Chebyshev) of
 * the block's bounds.
 */
function computeNearWaterBlocks(terrain: TerrainData): Uint8Array {
  const width = Math.ceil(GRID_WIDTH / LAND_VALUE_BLOCK_SIZE);
  const height = Math.ceil(GRID_HEIGHT / LAND_VALUE_BLOCK_SIZE);
  const mask = new Uint8Array(width * height);
  for (let by = 0; by < height; by++) {
    for (let bx = 0; bx < width; bx++) {
      const x0 = Math.max(0, bx * LAND_VALUE_BLOCK_SIZE - LAND_VALUE_WATER_RADIUS);
      const x1 = Math.min(
        GRID_WIDTH - 1,
        bx * LAND_VALUE_BLOCK_SIZE + LAND_VALUE_BLOCK_SIZE - 1 + LAND_VALUE_WATER_RADIUS,
      );
      const y0 = Math.max(0, by * LAND_VALUE_BLOCK_SIZE - LAND_VALUE_WATER_RADIUS);
      const y1 = Math.min(
        GRID_HEIGHT - 1,
        by * LAND_VALUE_BLOCK_SIZE + LAND_VALUE_BLOCK_SIZE - 1 + LAND_VALUE_WATER_RADIUS,
      );
      outer: for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (terrain.water[cellIndex(x, y)] === 1) {
            mask[by * width + bx] = 1;
            break outer;
          }
        }
      }
    }
  }
  return mask;
}

export function createCityFields(terrain: TerrainData): CityFields {
  return {
    pollution: numberLayer(POLLUTION_BLOCK_SIZE, 0),
    noise: numberLayer(NOISE_BLOCK_SIZE, 0),
    landValue: numberLayer(LAND_VALUE_BLOCK_SIZE, LAND_VALUE_BASE),
    coverage: {
      fireStation: numberLayer(COVERAGE_BLOCK_SIZE, 0),
      police: numberLayer(COVERAGE_BLOCK_SIZE, 0),
      clinic: numberLayer(COVERAGE_BLOCK_SIZE, 0),
      school: numberLayer(COVERAGE_BLOCK_SIZE, 0),
      park: numberLayer(COVERAGE_BLOCK_SIZE, 0),
    },
    nearWaterBlocks: computeNearWaterBlocks(terrain),
  };
}

/** Snapshot of every coverage layer for the coverageMirror component. */
export function coverageMirrorState(
  fields: CityFields,
): Record<ServiceType, LayerState<number>> {
  return {
    fireStation: fields.coverage.fireStation.getState(),
    police: fields.coverage.police.getState(),
    clinic: fields.coverage.clinic.getState(),
    school: fields.coverage.school.getState(),
    park: fields.coverage.park.getState(),
  };
}

/** Restores every field layer from the mirror entity after snapshot load. */
export function readFieldMirrors(sim: CitySim): void {
  const w = sim.world;
  const mirror = w.getState('mirrorEntity') as number | undefined;
  if (mirror === undefined) return;
  const pollution = w.getComponent(mirror, 'pollutionMirror');
  if (pollution) sim.fields.pollution = Layer.fromState(pollution);
  const noise = w.getComponent(mirror, 'noiseMirror');
  if (noise) sim.fields.noise = Layer.fromState(noise);
  const landValue = w.getComponent(mirror, 'landValueMirror');
  if (landValue) sim.fields.landValue = Layer.fromState(landValue);
  const coverage = w.getComponent(mirror, 'coverageMirror');
  if (coverage) {
    for (const service of SERVICE_TYPES) {
      // A city saved before this service existed simply has no key for it, and
      // Layer.fromState(undefined) throws — which would make every older save
      // unloadable the moment a service is appended. Leave the freshly built
      // empty layer in place instead: no such service was ever built, so empty
      // is the truth, and the next structure change rewrites the whole mirror.
      const state = coverage[service];
      if (state) sim.fields.coverage[service] = Layer.fromState(state);
    }
  }
}

/**
 * Real phase-4 desirability inputs. Utilities stay neutral here — city.ts
 * overlays component-backed powered/watered when utilitiesEnabled. Taxes are
 * always real (they apply regardless of fieldsEnabled).
 */
export function fieldScoreInputs(sim: CitySim): ScoreInputs {
  return {
    landValueAt: (x, y) => sim.fields.landValue.getAt(x, y),
    coverageCount: (x, y) => coverageCountAt(sim, x, y),
    powered: () => true,
    watered: () => true,
    educated: (x, y) => sim.fields.coverage.school.getAt(x, y) > 0,
    taxPenalty: (zone) => taxPenaltyOf(sim.world, zone),
    taxDemandPenalty: (zone) => taxDemandPenaltyOf(sim.world, zone),
  };
}

/** How many services cover the given cell (0..SERVICE_TYPES.length). */
export function coverageCountAt(sim: CitySim, x: number, y: number): number {
  let count = 0;
  for (const service of SERVICE_TYPES) count += sim.fields.coverage[service].getAt(x, y);
  return count;
}

const MIRROR_COMPONENT = {
  pollution: 'pollutionMirror',
  noise: 'noiseMirror',
  landValue: 'landValueMirror',
} as const;

/** Persists the layer and announces the change — only when something changed. */
function commitField(sim: CitySim, w: CityWorld, field: FieldName, changed: boolean): void {
  if (!changed) return;
  const mirror = w.getState('mirrorEntity') as number;
  w.setComponent(mirror, MIRROR_COMPONENT[field], sim.fields[field].getState());
  w.emit('fieldChanged', { field });
}

/** Applies multiplicative decay to every non-zero cell, dropping near-zero dust. */
function decayedCells(layer: Layer<number>, decay: number): Map<number, number> {
  const next = new Map<number, number>();
  layer.forEachReadOnly((value, cx, cy) => {
    if (value === 0) return;
    const decayedValue = value * decay;
    if (decayedValue >= FIELD_DECAY_MIN) next.set(cy * layer.width + cx, decayedValue);
  });
  return next;
}

function addToBlock(
  next: Map<number, number>,
  layer: Layer<number>,
  bx: number,
  by: number,
  amount: number,
): void {
  if (bx < 0 || by < 0 || bx >= layer.width || by >= layer.height) return;
  const i = by * layer.width + bx;
  next.set(i, (next.get(i) ?? 0) + amount);
}

/**
 * Writes the accumulated values back into the layer (clamped to [0, FIELD_MAX])
 * and clears cells that fell back to default. Returns whether anything changed.
 */
function reconcileField(layer: Layer<number>, next: Map<number, number>): boolean {
  let changed = false;
  const stale: Array<[number, number]> = [];
  layer.forEachReadOnly((value, cx, cy) => {
    if (value !== 0 && !next.has(cy * layer.width + cx)) stale.push([cx, cy]);
  });
  for (const [cx, cy] of stale) {
    layer.clear(cx, cy);
    changed = true;
  }
  for (const [i, raw] of next) {
    const cx = i % layer.width;
    const cy = Math.floor(i / layer.width);
    const value = Math.min(FIELD_MAX, raw);
    if (layer.getCell(cx, cy) !== value) {
      layer.setCell(cx, cy, value);
      changed = true;
    }
  }
  return changed;
}

/** Adds `amount` at the anchor block with radial linear falloff (Euclidean, in blocks). */
function emitRadial(
  next: Map<number, number>,
  layer: Layer<number>,
  bx: number,
  by: number,
  amount: number,
): void {
  const radius = POLLUTION_FALLOFF_RADIUS_BLOCKS;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const factor = 1 - Math.sqrt(dx * dx + dy * dy) / radius;
      if (factor <= 0) continue;
      addToBlock(next, layer, bx + dx, by + dy, amount * factor);
    }
  }
}

/**
 * Pollution recompute: decay, then every non-abandoned industrial building
 * emits at its anchor block with radial linear falloff (Euclidean, in blocks —
 * full strength at distance 0, zero at the falloff radius); coal plants emit
 * COAL_PLANT_POLLUTION at their anchor block with the same falloff.
 */
export function pollutionSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    const layer = sim.fields.pollution;
    const next = decayedCells(layer, POLLUTION_DECAY);
    // Sorted iteration: float accumulation order is part of determinism.
    for (const id of [...w.query('building', 'position')].sort((a, b) => a - b)) {
      const building = w.getComponent(id, 'building');
      const position = w.getComponent(id, 'position');
      if (!building || !position || building.zone !== 'I' || building.abandoned) continue;
      emitRadial(
        next,
        layer,
        Math.floor(position.x / POLLUTION_BLOCK_SIZE),
        Math.floor(position.y / POLLUTION_BLOCK_SIZE),
        POLLUTION_PER_INDUSTRIAL_LEVEL * building.level,
      );
    }
    for (const id of [...w.query('powerPlant', 'position')].sort((a, b) => a - b)) {
      const plant = w.getComponent(id, 'powerPlant');
      const position = w.getComponent(id, 'position');
      if (!plant || !position || plant.kind !== 'coal') continue;
      emitRadial(
        next,
        layer,
        Math.floor(position.x / POLLUTION_BLOCK_SIZE),
        Math.floor(position.y / POLLUTION_BLOCK_SIZE),
        COAL_PLANT_POLLUTION,
      );
    }
    commitField(sim, w, 'pollution', reconcileField(layer, next));
  };
}

/**
 * Noise recompute: decay, then every road cell emits by congestion bucket
 * (node cells count as bucket 0) and every non-abandoned commercial building
 * emits at its anchor block.
 */
export function noiseSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    const layer = sim.fields.noise;
    const next = decayedCells(layer, NOISE_DECAY);
    for (const cell of [...sim.roadCells].sort((a, b) => a - b)) {
      const edge = sim.roadGraph.cellToEdge.get(cell);
      const bucket = edge !== undefined ? (sim.edgeBuckets.get(edge) ?? 0) : 0;
      const x = cell % GRID_WIDTH;
      const y = Math.floor(cell / GRID_WIDTH);
      addToBlock(
        next,
        layer,
        Math.floor(x / NOISE_BLOCK_SIZE),
        Math.floor(y / NOISE_BLOCK_SIZE),
        NOISE_ROAD_BASE + NOISE_PER_CONGESTION_BUCKET * bucket,
      );
    }
    for (const id of [...w.query('building', 'position')].sort((a, b) => a - b)) {
      const building = w.getComponent(id, 'building');
      const position = w.getComponent(id, 'position');
      if (!building || !position || building.zone !== 'C' || building.abandoned) continue;
      addToBlock(
        next,
        layer,
        Math.floor(position.x / NOISE_BLOCK_SIZE),
        Math.floor(position.y / NOISE_BLOCK_SIZE),
        NOISE_PER_COMMERCIAL_LEVEL * building.level,
      );
    }
    commitField(sim, w, 'noise', reconcileField(layer, next));
  };
}

/** Mean of a finer field over one land-value block. */
function averageOverBlock(layer: Layer<number>, bx: number, by: number): number {
  const x0 = bx * LAND_VALUE_BLOCK_SIZE;
  const y0 = by * LAND_VALUE_BLOCK_SIZE;
  let total = 0;
  let samples = 0;
  for (let y = y0; y < y0 + LAND_VALUE_BLOCK_SIZE && y < GRID_HEIGHT; y += layer.blockSize) {
    for (let x = x0; x < x0 + LAND_VALUE_BLOCK_SIZE && x < GRID_WIDTH; x += layer.blockSize) {
      total += layer.getAt(x, y);
      samples++;
    }
  }
  return samples > 0 ? total / samples : 0;
}

/**
 * Whether a footprint has paved over this cell. A park has not: it occupies its
 * cells the way every structure does, but it is parkland — laying one over
 * wooded ground must not read as "the park bulldozed the trees". It grants no
 * new trees either; it simply leaves the ones that were there standing.
 */
function paved(sim: CitySim, cell: number): boolean {
  const owner = sim.occupiedCells.get(cell);
  if (owner === undefined) return false;
  return sim.world.getComponent(owner, 'structure')?.type !== 'park';
}

/**
 * Live tree proximity: the initial tree mask minus cells roads or footprints
 * have paved (buildings and service structures both live in occupiedCells;
 * `paved` exempts parks).
 */
function nearLiveTrees(sim: CitySim, bx: number, by: number): boolean {
  const x0 = Math.max(0, bx * LAND_VALUE_BLOCK_SIZE - LAND_VALUE_TREE_RADIUS);
  const x1 = Math.min(
    GRID_WIDTH - 1,
    bx * LAND_VALUE_BLOCK_SIZE + LAND_VALUE_BLOCK_SIZE - 1 + LAND_VALUE_TREE_RADIUS,
  );
  const y0 = Math.max(0, by * LAND_VALUE_BLOCK_SIZE - LAND_VALUE_TREE_RADIUS);
  const y1 = Math.min(
    GRID_HEIGHT - 1,
    by * LAND_VALUE_BLOCK_SIZE + LAND_VALUE_BLOCK_SIZE - 1 + LAND_VALUE_TREE_RADIUS,
  );
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = cellIndex(x, y);
      if (sim.terrain.trees[i] === 1 && !sim.roadCells.has(i) && !paved(sim, i)) return true;
    }
  }
  return false;
}

/** Land value recompute over every block from water, coverage, trees, pollution, noise. */
export function landValueSystem(sim: CitySim): (w: CityWorld) => void {
  return (w) => {
    const layer = sim.fields.landValue;
    let changed = false;
    for (let by = 0; by < layer.height; by++) {
      for (let bx = 0; bx < layer.width; bx++) {
        let coverage = 0;
        for (const service of SERVICE_TYPES) {
          coverage += sim.fields.coverage[service].getAt(
            bx * LAND_VALUE_BLOCK_SIZE,
            by * LAND_VALUE_BLOCK_SIZE,
          );
        }
        const raw =
          LAND_VALUE_BASE +
          LAND_VALUE_WATER_BONUS * sim.fields.nearWaterBlocks[by * layer.width + bx] +
          LAND_VALUE_COVERAGE_WEIGHT * coverage +
          LAND_VALUE_TREE_BONUS * (nearLiveTrees(sim, bx, by) ? 1 : 0) -
          LAND_VALUE_POLLUTION_WEIGHT * averageOverBlock(sim.fields.pollution, bx, by) -
          LAND_VALUE_NOISE_WEIGHT * averageOverBlock(sim.fields.noise, bx, by);
        const value = Math.min(FIELD_MAX, Math.max(0, raw));
        if (layer.getCell(bx, by) !== value) {
          layer.setCell(bx, by, value);
          changed = true;
        }
      }
    }
    commitField(sim, w, 'landValue', changed);
  };
}
