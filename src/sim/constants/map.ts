export const GRID_WIDTH = 128;
export const GRID_HEIGHT = 128;
export const TPS = 20;
export const TICK_MS = 1000 / TPS;
// One full day == one sun rotation (see scene.setDayFraction). At 20 TPS this
// is ~205 s of real time per day/night cycle at 1× — a relaxed rotation that
// still advances the day counter meaningfully. Budget runs on its own interval.
export const TICKS_PER_DAY = 4096;
export const BUDGET_INTERVAL_TICKS = 1024;
