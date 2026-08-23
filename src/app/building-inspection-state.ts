import type {
  BuildingDetail,
  ClientToWorker,
  EntityRef,
  WorkerToClient,
} from '../protocol/messages';

type InspectBuildingRequest = Extract<ClientToWorker, { type: 'inspectBuilding' }>;
type BuildingDetailReply = Extract<WorkerToClient, { type: 'buildingDetail' }>;

export type BuildingInspectionMode = 'direct' | 'refresh';

export type BuildingInspectionReplyResult =
  | { kind: 'accepted'; mode: BuildingInspectionMode; target: EntityRef; detail: BuildingDetail }
  | { kind: 'failed'; mode: BuildingInspectionMode; error: string }
  | { kind: 'ignored'; reason: string };

function copyEntity(entity: EntityRef): EntityRef {
  return { id: entity.id, generation: entity.generation };
}

function sameEntity(a: EntityRef, b: EntityRef): boolean {
  return a.id === b.id && a.generation === b.generation;
}

function label(ref: EntityRef): string {
  return `building ${ref.id} generation ${ref.generation}`;
}

/**
 * Pure main-thread coordinator for one building inspection panel. Like its
 * citizen counterpart it owns no UI and no worker: callers send the returned
 * request and render whatever it accepts.
 *
 * The generation half of the identity is what makes a stale reply safe. Entity
 * ids are recycled the moment a block is bulldozed and rebuilt, so a reply that
 * arrives after a demolition would otherwise describe the wrong building under
 * the right number.
 */
export class BuildingInspectionState {
  private requestSequence = 0;
  private pending: { id: number; mode: BuildingInspectionMode; target: EntityRef } | null = null;
  private currentTarget: EntityRef | null = null;
  private currentDetail: BuildingDetail | null = null;
  private currentDetailTick: number | null = null;

  get selected(): EntityRef | null {
    return this.currentTarget ? copyEntity(this.currentTarget) : null;
  }

  get detail(): BuildingDetail | null {
    return this.currentDetail;
  }

  get detailTick(): number | null {
    return this.currentDetailTick;
  }

  get pendingMode(): BuildingInspectionMode | null {
    return this.pending?.mode ?? null;
  }

  /** Selects a clicked placement immediately and replaces any request in flight. */
  requestDirect(target: EntityRef): InspectBuildingRequest {
    assertRef(target);
    const selected = copyEntity(target);
    this.currentTarget = selected;
    this.currentDetail = null;
    this.currentDetailTick = null;
    const id = this.nextRequestId();
    this.pending = { id, mode: 'direct', target: selected };
    return this.request(id, selected);
  }

  /** Refreshes the selection while leaving the accepted panel on screen. */
  requestRefresh(): InspectBuildingRequest | null {
    if (!this.currentTarget) return null;
    const target = copyEntity(this.currentTarget);
    const id = this.nextRequestId();
    this.pending = { id, mode: 'refresh', target };
    return this.request(id, target);
  }

  /** Invalidates every in-flight reply and forgets accepted building state. */
  clear(): void {
    this.requestSequence += 1;
    this.pending = null;
    this.currentTarget = null;
    this.currentDetail = null;
    this.currentDetailTick = null;
  }

  /** Applies one reply only when its request and full incarnation still match. */
  acceptReply(reply: BuildingDetailReply, tick: number): BuildingInspectionReplyResult {
    const pending = this.pending;
    if (!pending) {
      return { kind: 'ignored', reason: `Ignored building reply ${reply.id}: no request is pending` };
    }
    if (pending.id !== reply.id) {
      return {
        kind: 'ignored',
        reason: `Ignored building reply ${reply.id}: request ${pending.id} is newer`,
      };
    }
    this.pending = null;

    if (!reply.detail) {
      return {
        kind: 'failed',
        mode: pending.mode,
        error: reply.error ?? `Building inspection ${reply.id} returned no detail or explanation`,
      };
    }
    const replied: EntityRef = { id: reply.entity, generation: reply.generation };
    if (!sameEntity(replied, pending.target)) {
      return {
        kind: 'failed',
        mode: pending.mode,
        error: `Rejected building reply ${reply.id}: expected ${label(pending.target)}, received ${label(replied)}`,
      };
    }
    if (
      reply.detail.entity !== replied.id ||
      reply.detail.generation !== replied.generation
    ) {
      return {
        kind: 'failed',
        mode: pending.mode,
        error: `Rejected building reply ${reply.id}: its envelope and detail do not identify the same building`,
      };
    }

    this.currentTarget = copyEntity(replied);
    this.currentDetail = reply.detail;
    this.currentDetailTick = tick;
    return {
      kind: 'accepted',
      mode: pending.mode,
      target: copyEntity(replied),
      detail: reply.detail,
    };
  }

  private nextRequestId(): number {
    this.requestSequence += 1;
    return this.requestSequence;
  }

  private request(id: number, target: EntityRef): InspectBuildingRequest {
    return { type: 'inspectBuilding', id, entity: target.id, generation: target.generation };
  }
}

function assertRef(ref: EntityRef): void {
  if (!Number.isInteger(ref.id) || ref.id < 0) {
    throw new Error(`building id ${ref.id} must be a non-negative whole number`);
  }
  if (!Number.isInteger(ref.generation) || ref.generation < 0) {
    throw new Error(`building generation ${ref.generation} must be a non-negative whole number`);
  }
}
