export const GRID_WIDTH = 128;
export const GRID_HEIGHT = 128;
export const TPS = 20;
export const TICK_MS = 1000 / TPS;
// The day length lives in the shared civic clock (protocol/city-clock.ts) so
// sun, HUD, and routines can never disagree; re-exported here for sim callers.
export { TICKS_PER_DAY } from '../../protocol/city-clock';
export const BUDGET_INTERVAL_TICKS = 1024;
