import type { ClientToWorker, WorkerToClient } from '../protocol/messages';
import { buildingDetail, buildingDetailProblem } from '../sim/building-detail';
import type { CitySim } from '../sim/city';
import { identityProblem } from './entity-identity';

type InspectBuildingRequest = Extract<ClientToWorker, { type: 'inspectBuilding' }>;
type BuildingDetailResponse = Extract<WorkerToClient, { type: 'buildingDetail' }>;

/**
 * Generation-guarded on-demand query for one placed building, service, plant,
 * or pump. Always replies so the client settles, and a null detail always says
 * why — a stale click on a demolished block must not read as an empty panel.
 */
export function inspectBuildingResponse(
  sim: CitySim,
  request: InspectBuildingRequest,
): BuildingDetailResponse {
  const identityError = identityProblem(
    sim.world,
    'building',
    request.entity,
    request.generation,
  );
  const detail = identityError ? null : buildingDetail(sim, request.entity);
  const error = detail
    ? undefined
    : (identityError ?? buildingDetailProblem(sim, request.entity) ??
      `entity ${request.entity} has no building detail at tick ${sim.world.tick}`);
  return {
    type: 'buildingDetail',
    id: request.id,
    entity: request.entity,
    generation: request.generation,
    detail,
    ...(error === undefined ? {} : { error }),
  };
}
