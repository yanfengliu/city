import type { CitySim } from '../src/sim/city.js';
import type { SessionRecorder } from 'civ-engine';

export interface PerformanceCityCounts {
  readonly tick: number;
  readonly buildingCount: number;
  readonly vehicles: number;
  readonly pedestrians: number;
  readonly completedShoppingTrips: number;
  readonly populationPeople: number;
}

export function setupPerformanceCity(sim: CitySim): void;
export function runPerformancePhase(
  sim: CitySim,
  options: {
    readonly recorder?: SessionRecorder | null;
    readonly ticks: number;
    readonly now?: () => number;
    readonly setup?: (sim: CitySim) => void;
  },
): number;
export function cityCounts(sim: CitySim): PerformanceCityCounts;
