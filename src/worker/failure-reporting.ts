/**
 * Guards and diagnostics for the two ways the sim can fail loudly instead of
 * silently (AGENTS.md: error messages are a product surface).
 *
 * Both exist because of one browser-reproduced defect: submitting a command
 * name the world has no handler for was answered `accepted: true, "Queued
 * command"` and then permanently halted the simulation on the next drain —
 * with no error on the main thread, because the throw happened inside the
 * worker. The city simply froze while the HUD still read "1x".
 */

import type { TickFailure } from 'civ-engine';

/** Edit distance ≤ this counts as "you probably meant this command". */
const NEAR_MISS_DISTANCE = 3;

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i++) {
    const current = [i];
    for (let j = 1; j < cols; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[cols - 1];
}

/**
 * Why the worker must not submit `name`, or null when it is executable.
 * `known` lets the caller supply the world's registry without this module
 * importing one; `candidates` (when given) powers the did-you-mean hint.
 */
export function unknownCommandRejection(
  name: string,
  known: (name: string) => boolean,
  candidates: readonly string[] = [],
): string | null {
  if (known(name)) return null;
  const lower = name.toLowerCase();
  let best: string | null = null;
  let bestDistance = NEAR_MISS_DISTANCE + 1;
  for (const candidate of candidates) {
    const distance = editDistance(lower, candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  const hint = best !== null && bestDistance <= NEAR_MISS_DISTANCE ? ` — did you mean "${best}"?` : '';
  return (
    `unknown command "${name}"${hint} The simulation has no handler for it, ` +
    'so it was rejected rather than queued.'
  );
}

/**
 * Player-facing text for an engine tick failure. A halted sim must announce
 * itself: the previous behaviour was a frozen city with a HUD still showing
 * its speed, which reads as a rendering hang rather than a dead simulation.
 */
export function simFailureMessage(failure: TickFailure): string {
  const culprit =
    failure.commandType !== null
      ? `command "${failure.commandType}"`
      : failure.systemName !== null
        ? `system "${failure.systemName}"`
        : `the ${failure.phase} phase`;
  const detail = failure.message?.trim() ? `: ${failure.message.trim()}` : '';
  return `The simulation stopped at tick ${failure.tick} while running ${culprit}${detail}`;
}
