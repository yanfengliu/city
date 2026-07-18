/**
 * Junction traffic-signal timing — one pure function shared by the sim (cars
 * hold at red stop lines) and the renderer (fixture faces light to match), so
 * the two can never disagree and no signal state crosses the worker boundary.
 *
 * The timing constants live here rather than in `sim/constants` because they
 * are part of this shared contract: the renderer may import protocol modules
 * but never sim ones (`docs/architecture/architecture.md`).
 */

/** Ticks of green per axis (20 TPS → 2.4 s). */
export const SIGNAL_GREEN_TICKS = 48;
/** All-red clearance between greens (junction empties before cross flow). */
export const SIGNAL_CLEARANCE_TICKS = 8;
export const SIGNAL_CYCLE_TICKS = 2 * (SIGNAL_GREEN_TICKS + SIGNAL_CLEARANCE_TICKS);

export type SignalPhase = 'ns' | 'ew' | 'all-red';

/**
 * Phase of the junction at `nodeCell` on `tick`. Per-node offsets (a Knuth
 * multiplicative hash of the cell index) stagger cycles across town so
 * traffic doesn't pulse in city-wide lockstep. Deterministic: integer math
 * only, identical in worker and renderer.
 */
export function signalPhase(tick: number, nodeCell: number): SignalPhase {
  const offset = (Math.imul(nodeCell, 2654435761) >>> 0) % SIGNAL_CYCLE_TICKS;
  const local = (tick + offset) % SIGNAL_CYCLE_TICKS;
  if (local < SIGNAL_GREEN_TICKS) return 'ns';
  if (local < SIGNAL_GREEN_TICKS + SIGNAL_CLEARANCE_TICKS) return 'all-red';
  if (local < 2 * SIGNAL_GREEN_TICKS + SIGNAL_CLEARANCE_TICKS) return 'ew';
  return 'all-red';
}
