import type { CityWorld } from '../sim/types';

/**
 * Why an on-demand query cannot trust the identity it was handed, in words
 * that name the entity and what is actually wrong with it. Shared by every
 * inspect query so a stale click reads the same everywhere.
 */
export function identityProblem(
  world: CityWorld,
  kind: string,
  entity: number,
  generation: number,
): string | null {
  if (!Number.isInteger(entity) || entity < 0) {
    return `${kind} ${entity} is not an entity id — pass a whole non-negative number`;
  }
  if (!Number.isInteger(generation) || generation < 0) {
    return `${kind} ${entity} generation ${generation} is invalid — pass its non-negative ECS generation`;
  }
  if (!world.isAlive(entity)) {
    return `${kind} ${entity} generation ${generation} is no longer alive`;
  }
  const actual = world.getEntityGeneration(entity);
  return actual === generation
    ? null
    : `${kind} ${entity} generation ${generation} is stale — its current generation is ${actual}`;
}
