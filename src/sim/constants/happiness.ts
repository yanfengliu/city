import { FIELD_MAX, LAND_VALUE_BASE } from './fields';

/**
 * Every number a household's mood depends on. `happiness.ts` only combines
 * them, so retuning quality of life happens here (AGENTS.md: no magic numbers).
 *
 * The model is deliberately additive around a neutral base: each factor reads
 * one piece of state the simulation already maintains and contributes a signed
 * share of the 0..1 score, so a UI panel can list exactly what helped and hurt.
 */

/**
 * Cadence. A system runs on tick T when `(T - 1) % interval === offset`, so
 * this lands on T ≡ 20 (mod 32). Interval-8 systems occupy all eight residues
 * mod 8, so avoiding every system is impossible (game-design.md § cadences);
 * residue 20 shares its tick with move-in alone — growth (T≡2 mod 4), trips
 * (3 mod 8), employment (5 mod 8), pollution (1 mod 8), noise (7 mod 8), power
 * (0 mod 8), water (2 mod 8), level (6 mod 16), land value (13 mod 16), demand
 * (15 mod 32), congestion (13 mod 64) and budget all fall elsewhere.
 */
export const HAPPINESS_INTERVAL = 32;
export const HAPPINESS_INTERVAL_OFFSET = 19;
/**
 * Households re-evaluated per run, rotated through by a cursor exactly as the
 * trip system does. A COUNT, never a wall-clock budget (AGENTS.md § traps).
 */
export const HAPPINESS_PER_RUN = 128;
/**
 * Scores are rounded to 1/HAPPINESS_SCALE before storage so land-value jitter
 * a player could never perceive does not churn a component diff every run.
 */
export const HAPPINESS_SCALE = 1000;

/** Neutral score: where a household starts and what a legacy save reads as. */
export const HAPPINESS_BASE = 0.5;

/** Power at home — the flag the power flood-fill maintains on the building. */
export const HAPPINESS_POWERED = 0.08;
export const HAPPINESS_UNPOWERED = -0.22;
/** Running water at home — the water flood-fill's flag on the same building. */
export const HAPPINESS_WATERED = 0.08;
export const HAPPINESS_UNWATERED = -0.22;

/**
 * Per civic need (fire/police/health/education/green space) whose coverage
 * reaches home. Park and garden satisfy the same need, so overlapping them
 * cannot masquerade as two essential services.
 */
export const HAPPINESS_PER_COVERED_SERVICE = 0.05;

/** Land value that reads as ordinary — the field's own base, so a fresh block is neutral. */
export const HAPPINESS_LAND_VALUE_NEUTRAL = LAND_VALUE_BASE;
/** Swing of the land-value contribution across the field's full 0..FIELD_MAX range. */
export const HAPPINESS_LAND_VALUE_WEIGHT = 0.25;
export const HAPPINESS_LAND_VALUE_RANGE = FIELD_MAX;

/** Holding a job at all, versus the employment system never finding one. */
export const HAPPINESS_EMPLOYED = 0.1;
export const HAPPINESS_UNEMPLOYED = -0.15;

/** Manhattan home→work distance in cells that costs nothing. */
export const HAPPINESS_COMMUTE_FREE_CELLS = 12;
/** Distance at which the commute penalty reaches its full value. */
export const HAPPINESS_COMMUTE_FULL_CELLS = 60;
export const HAPPINESS_COMMUTE_MAX = -0.15;

/** A trip that could not be routed (the per-citizen face of `disconnectedTrips`). */
export const HAPPINESS_STRANDED = -0.12;
/** How long such a failure keeps stinging — one budget interval, ~51s at 1x. */
export const HAPPINESS_STRANDED_MEMORY_TICKS = 1024;

/** Per percentage point of home-zone tax above the neutral rate. */
export const HAPPINESS_TAX_PER_POINT = -0.015;

/** The home building is gone — nothing else about the household can be read. */
export const HAPPINESS_NO_HOME = -0.4;
