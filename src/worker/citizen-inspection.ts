import type { ClientToWorker, WorkerToClient } from '../protocol/messages';
import { citizenDetail, citizenDetailProblem } from '../sim/citizen-detail';
import { profileForCitizen } from '../sim/citizen-profile';
import type { CitySim } from '../sim/city';
import type { CityWorld } from '../sim/types';

type InspectCitizenRequest = Extract<ClientToWorker, { type: 'inspectCitizen' }>;
type InspectHomeResidentRequest = Extract<ClientToWorker, { type: 'inspectHomeResident' }>;
type CitizenDetailResponse = Extract<WorkerToClient, { type: 'citizenDetail' }>;

function identityProblem(
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

/** Generation-guarded on-demand query for a known household identity. */
export function inspectCitizenResponse(
  sim: CitySim,
  request: InspectCitizenRequest,
): CitizenDetailResponse {
  const identityError = identityProblem(
    sim.world,
    'citizen',
    request.entity,
    request.generation,
  );
  const detail = identityError
    ? null
    : citizenDetail(sim, request.entity, request.memberId);
  const error = detail
    ? undefined
    : (identityError ?? citizenDetailProblem(sim, request.entity, request.memberId) ??
      `entity ${request.entity} has no citizen detail at tick ${sim.world.tick}`);
  return {
    type: 'citizenDetail',
    id: request.id,
    entity: request.entity,
    generation: request.generation,
    detail,
    ...(error === undefined ? {} : { error }),
  };
}

/**
 * Finds one person at a residential building in canonical household/member
 * order. The optional cursor advances with wraparound, letting the panel cycle
 * residents without streaming every citizen id in normal building diffs.
 */
export function inspectHomeResidentResponse(
  sim: CitySim,
  request: InspectHomeResidentRequest,
): CitizenDetailResponse {
  const { world } = sim;
  const identityError = identityProblem(
    world,
    'building',
    request.building,
    request.buildingGeneration,
  );
  if (identityError) return failedResidentResponse(request, identityError);

  const building = world.getComponent(request.building, 'building');
  if (!building) {
    return failedResidentResponse(
      request,
      `entity ${request.building} is not a building, so it has no households to inspect`,
    );
  }
  if (building.zone !== 'R') {
    return failedResidentResponse(
      request,
      `building ${request.building} is ${building.zone}, not residential — inspect a residential home`,
    );
  }

  const residents = [...world.query('citizen')]
    .filter((id) => world.getComponent(id, 'citizen')?.home === request.building)
    .sort((a, b) => a - b);
  if (residents.length === 0) {
    return failedResidentResponse(
      request,
      `residential building ${request.building} has no households living there at tick ${world.tick}`,
    );
  }

  const people = residents.flatMap((entity) => {
    const citizen = world.getComponent(entity, 'citizen');
    if (!citizen) return [];
    return profileForCitizen(sim, entity, citizen).members
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((member) => ({
        entity,
        generation: world.getEntityGeneration(entity),
        memberId: member.id,
      }));
  });
  const cursor = request.afterCitizen === undefined
    ? -1
    : people.findIndex(
        (person) =>
          person.entity === request.afterCitizen &&
          person.generation === request.afterCitizenGeneration &&
          person.memberId === request.afterMemberId,
      );
  const index = (cursor + 1) % people.length;
  const { entity, generation, memberId } = people[index];
  const detail = citizenDetail(sim, entity, memberId);
  if (!detail) {
    return failedResidentResponse(
      request,
      citizenDetailProblem(sim, entity, memberId) ??
        `resident ${entity} member ${memberId} of building ${request.building} has no citizen detail`,
    );
  }
  return {
    type: 'citizenDetail',
    id: request.id,
    entity,
    generation,
    detail,
    residentContext: {
      building: { id: request.building, generation: request.buildingGeneration },
      index,
      total: people.length,
    },
  };
}

function failedResidentResponse(
  request: InspectHomeResidentRequest,
  error: string,
): CitizenDetailResponse {
  return {
    type: 'citizenDetail',
    id: request.id,
    entity: null,
    generation: null,
    detail: null,
    error,
  };
}
