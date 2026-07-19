import type {
  CitizenDetail,
  CitizenMemberRef,
  ClientToWorker,
  EntityRef,
  WorkerToClient,
} from '../protocol/messages';

export type PersonRef = CitizenMemberRef;
export type CitizenInspectionMode = 'direct' | 'refresh' | 'home';

type InspectCitizenRequest = Extract<ClientToWorker, { type: 'inspectCitizen' }>;
type InspectHomeRequest = Extract<ClientToWorker, { type: 'inspectHomeResident' }>;
type CitizenDetailReply = Extract<WorkerToClient, { type: 'citizenDetail' }>;
export type ResidentContext = NonNullable<CitizenDetailReply['residentContext']>;

type PendingRequest =
  | { id: number; mode: 'direct' | 'refresh'; person: PersonRef }
  | { id: number; mode: 'home'; building: EntityRef };

export type CitizenInspectionReplyResult =
  | {
      kind: 'accepted';
      mode: CitizenInspectionMode;
      person: PersonRef;
      detail: CitizenDetail;
      residentContext: ResidentContext | null;
    }
  | { kind: 'failed'; mode: CitizenInspectionMode; error: string; cleared: boolean }
  | { kind: 'ignored'; reason: string };

function copyPerson(person: PersonRef): PersonRef {
  return { id: person.id, generation: person.generation, memberId: person.memberId };
}

function copyEntity(entity: EntityRef): EntityRef {
  return { id: entity.id, generation: entity.generation };
}

function copyResidentContext(context: ResidentContext): ResidentContext {
  return {
    building: copyEntity(context.building),
    index: context.index,
    total: context.total,
  };
}

function sameEntity(a: EntityRef, b: EntityRef): boolean {
  return a.id === b.id && a.generation === b.generation;
}

function samePerson(a: PersonRef, b: PersonRef): boolean {
  return sameEntity(a, b) && a.memberId === b.memberId;
}

function personLabel(person: PersonRef): string {
  return `citizen ${person.id} generation ${person.generation} member ${person.memberId}`;
}

function assertRef(label: string, ref: EntityRef, memberId?: number): void {
  if (!Number.isInteger(ref.id) || ref.id < 0) {
    throw new Error(`${label} id ${ref.id} must be a non-negative whole number`);
  }
  if (!Number.isInteger(ref.generation) || ref.generation < 0) {
    throw new Error(`${label} generation ${ref.generation} must be a non-negative whole number`);
  }
  if (memberId !== undefined && (!Number.isInteger(memberId) || memberId < 0)) {
    throw new Error(`${label} member ${memberId} must be a non-negative whole number`);
  }
}

/**
 * Pure main-thread coordinator for one citizen inspection panel. It owns no UI
 * or worker: callers send the returned requests and render accepted state.
 */
export class CitizenInspectionState {
  private requestSequence = 0;
  private pending: PendingRequest | null = null;
  private currentPerson: PersonRef | null = null;
  private currentDetail: CitizenDetail | null = null;
  private currentResidentContext: ResidentContext | null = null;
  private currentDetailTick: number | null = null;

  get selected(): PersonRef | null {
    return this.currentPerson ? copyPerson(this.currentPerson) : null;
  }

  get detail(): CitizenDetail | null {
    return this.currentDetail;
  }

  get residentContext(): ResidentContext | null {
    return this.currentResidentContext
      ? copyResidentContext(this.currentResidentContext)
      : null;
  }

  get detailTick(): number | null {
    return this.currentDetailTick;
  }

  get pendingMode(): CitizenInspectionMode | null {
    return this.pending?.mode ?? null;
  }

  get pendingRequestId(): number | null {
    return this.pending?.id ?? null;
  }

  /** Reconciles a home-cycle label against the latest streamed building occupancy. */
  reconcileResidentTotal(total: number | null): boolean {
    const context = this.currentResidentContext;
    if (!context) return false;
    if (total === null || total === 0) {
      this.currentResidentContext = null;
      return true;
    }
    if (!Number.isInteger(total) || total < 1) {
      throw new Error(`resident total ${total} must be null or a positive whole number`);
    }
    const index = Math.min(context.index, total - 1);
    if (context.total === total && context.index === index) return false;
    this.currentResidentContext = { ...context, index, total };
    return true;
  }

  /** Selects a clicked walker immediately and replaces any request in flight. */
  requestDirect(person: PersonRef): InspectCitizenRequest {
    assertRef('citizen', person, person.memberId);
    const selected = copyPerson(person);
    this.currentPerson = selected;
    this.currentDetail = null;
    this.currentResidentContext = null;
    this.currentDetailTick = null;
    const id = this.nextRequestId();
    this.pending = { id, mode: 'direct', person: selected };
    return this.personRequest(id, selected);
  }

  /** Refreshes the selected person while leaving their accepted panel visible. */
  requestRefresh(): InspectCitizenRequest | null {
    if (!this.currentPerson) return null;
    const person = copyPerson(this.currentPerson);
    const id = this.nextRequestId();
    this.pending = { id, mode: 'refresh', person };
    return this.personRequest(id, person);
  }

  /**
   * Requests the next person at a home. When already cycling that exact home,
   * the cursor contains both halves of the person identity.
   */
  requestHome(building: EntityRef): InspectHomeRequest {
    assertRef('residential building', building);
    const home = copyEntity(building);
    const id = this.nextRequestId();
    this.pending = { id, mode: 'home', building: home };
    const continuesCurrentHome =
      this.currentPerson !== null &&
      this.currentResidentContext !== null &&
      sameEntity(this.currentResidentContext.building, home);
    return {
      type: 'inspectHomeResident',
      id,
      building: home.id,
      buildingGeneration: home.generation,
      ...(continuesCurrentHome
        ? {
            afterCitizen: this.currentPerson!.id,
            afterCitizenGeneration: this.currentPerson!.generation,
            afterMemberId: this.currentPerson!.memberId,
          }
        : {}),
    };
  }

  /** Invalidates every in-flight reply and forgets accepted citizen state. */
  clear(): void {
    this.requestSequence += 1;
    this.pending = null;
    this.clearAccepted();
  }

  /**
   * Applies one worker reply only when its request and full entity incarnation
   * still match. Home replies additionally require a live building lookup.
   */
  acceptReply(
    reply: CitizenDetailReply,
    tick: number,
    isLiveBuilding: (building: EntityRef) => boolean,
  ): CitizenInspectionReplyResult {
    const pending = this.pending;
    if (!pending) {
      return { kind: 'ignored', reason: `Ignored citizen reply ${reply.id}: no request is pending` };
    }
    if (pending.id !== reply.id) {
      return {
        kind: 'ignored',
        reason: `Ignored citizen reply ${reply.id}: request ${pending.id} is newer`,
      };
    }
    this.pending = null;

    const responseProblem = this.responseProblem(reply, pending, isLiveBuilding);
    if (responseProblem) return this.failPending(pending, responseProblem);

    const detail = reply.detail!;
    const person: PersonRef = {
      id: reply.entity!,
      generation: reply.generation!,
      memberId: detail.selectedMemberId,
    };
    this.currentPerson = person;
    this.currentDetail = detail;
    this.currentDetailTick = tick;
    if (pending.mode === 'home') {
      this.currentResidentContext = copyResidentContext(reply.residentContext!);
    } else if (pending.mode === 'direct') {
      this.currentResidentContext = null;
    }

    return {
      kind: 'accepted',
      mode: pending.mode,
      person: copyPerson(person),
      detail,
      residentContext: this.residentContext,
    };
  }

  private nextRequestId(): number {
    this.requestSequence += 1;
    return this.requestSequence;
  }

  private personRequest(id: number, person: PersonRef): InspectCitizenRequest {
    return {
      type: 'inspectCitizen',
      id,
      entity: person.id,
      generation: person.generation,
      memberId: person.memberId,
    };
  }

  private responseProblem(
    reply: CitizenDetailReply,
    pending: PendingRequest,
    isLiveBuilding: (building: EntityRef) => boolean,
  ): string | null {
    if (!reply.detail || reply.entity === null || reply.generation === null) {
      return reply.error ?? `Citizen inspection ${reply.id} returned no person or explanation`;
    }
    const person: PersonRef = {
      id: reply.entity,
      generation: reply.generation,
      memberId: reply.detail.selectedMemberId,
    };
    if (
      reply.detail.entity !== person.id ||
      reply.detail.generation !== person.generation ||
      reply.detail.selectedMember.id !== person.memberId
    ) {
      return `Rejected citizen reply ${reply.id}: its envelope, detail, and selected member do not identify the same person`;
    }
    if (pending.mode !== 'home') {
      return samePerson(person, pending.person)
        ? null
        : `Rejected citizen reply ${reply.id}: expected ${personLabel(pending.person)}, received ${personLabel(person)}`;
    }

    const context = reply.residentContext;
    if (!context || !sameEntity(context.building, pending.building)) {
      return `Rejected resident reply ${reply.id}: expected home ${pending.building.id} generation ${pending.building.generation}`;
    }
    if (
      !Number.isInteger(context.index) ||
      !Number.isInteger(context.total) ||
      context.index < 0 ||
      context.total < 1 ||
      context.index >= context.total
    ) {
      return `Rejected resident reply ${reply.id}: resident index ${context.index} is invalid for total ${context.total}`;
    }
    if (!isLiveBuilding(pending.building)) {
      return `Rejected resident reply ${reply.id}: home ${pending.building.id} generation ${pending.building.generation} is no longer live`;
    }
    return null;
  }

  private failPending(pending: PendingRequest, error: string): CitizenInspectionReplyResult {
    const cleared = pending.mode !== 'home';
    if (cleared) this.clearAccepted();
    return { kind: 'failed', mode: pending.mode, error, cleared };
  }

  private clearAccepted(): void {
    this.currentPerson = null;
    this.currentDetail = null;
    this.currentResidentContext = null;
    this.currentDetailTick = null;
  }
}
