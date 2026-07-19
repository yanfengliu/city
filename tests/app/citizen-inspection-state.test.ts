import { describe, expect, it, vi } from 'vitest';
import { CitizenInspectionState } from '../../src/app/citizen-inspection-state';
import type {
  CitizenDetail,
  CitizenMemberRef,
  EntityRef,
  WorkerToClient,
} from '../../src/protocol/messages';

type CitizenDetailReply = Extract<WorkerToClient, { type: 'citizenDetail' }>;

const PERSON_A: CitizenMemberRef = { id: 10, generation: 2, memberId: 0 };
const PERSON_B: CitizenMemberRef = { id: 12, generation: 4, memberId: 2 };
const HOME: EntityRef = { id: 30, generation: 6 };

function detailFor(person: CitizenMemberRef): CitizenDetail {
  const members = [
    { id: 0, givenName: 'Ari', age: 36, lifeStage: 'adult' as const, education: 'trade' as const, role: 'jobSeeker' as const },
    { id: 1, givenName: 'Bea', age: 34, lifeStage: 'adult' as const, education: 'university' as const, role: 'caregiver' as const },
    { id: 2, givenName: 'Cal', age: 9, lifeStage: 'child' as const, education: 'primary' as const, role: 'child' as const },
  ];
  const selectedMember = members.find((member) => member.id === person.memberId)!;
  return {
    entity: person.id,
    generation: person.generation,
    profile: {
      version: 1,
      householdName: 'Vale household',
      members,
      primaryWorkerMemberId: 0,
    },
    profileSource: 'stored',
    activeTravellerMemberId: 0,
    activeTraveller: members[0],
    selectedMemberId: person.memberId,
    selectedMember,
    travellerMemberId: 0,
    traveller: members[0],
    lifeEvents: [],
    happiness: 0.75,
    breakdown: { score: 0.75, base: 0.5, raw: 0.75, factors: [] },
    phase: 'home',
    activity: 'rest',
    status: 'Resting at home',
    home: null,
    work: null,
    destination: null,
    activityPlace: null,
    agent: null,
    x: 0,
    y: 0,
    cell: 0,
    waitUntil: 0,
    strandedAt: null,
    commuteCells: null,
  };
}

function reply(
  id: number,
  person: CitizenMemberRef,
  residentContext?: CitizenDetailReply['residentContext'],
): CitizenDetailReply {
  return {
    type: 'citizenDetail',
    id,
    entity: person.id,
    generation: person.generation,
    detail: detailFor(person),
    ...(residentContext ? { residentContext } : {}),
  };
}

function failedReply(id: number, error: string): CitizenDetailReply {
  return {
    type: 'citizenDetail',
    id,
    entity: null,
    generation: null,
    detail: null,
    error,
  };
}

function acceptDirect(
  state: CitizenInspectionState,
  person: CitizenMemberRef = PERSON_A,
  tick = 5,
): void {
  const request = state.requestDirect(person);
  expect(state.acceptReply(reply(request.id, person), tick, () => true).kind).toBe('accepted');
}

function acceptHome(
  state: CitizenInspectionState,
  person: CitizenMemberRef = PERSON_A,
  tick = 5,
): void {
  const request = state.requestHome(HOME);
  const context = { building: HOME, index: 0, total: 6 };
  expect(state.acceptReply(reply(request.id, person, context), tick, () => true).kind).toBe('accepted');
}

describe('CitizenInspectionState request races', () => {
  it('invalidates a late reply when the panel closes', () => {
    const state = new CitizenInspectionState();
    const request = state.requestDirect(PERSON_A);

    state.clear();

    expect(state.acceptReply(reply(request.id, PERSON_A), 8, () => true)).toMatchObject({
      kind: 'ignored',
    });
    expect(state.selected).toBeNull();
    expect(state.detail).toBeNull();
  });

  it('ignores A after selecting B and leaves B pending', () => {
    const state = new CitizenInspectionState();
    const requestA = state.requestDirect(PERSON_A);
    const requestB = state.requestDirect(PERSON_B);

    expect(state.acceptReply(reply(requestA.id, PERSON_A), 8, () => true).kind).toBe('ignored');
    expect(state.selected).toEqual(PERSON_B);
    expect(state.pendingRequestId).toBe(requestB.id);

    expect(state.acceptReply(reply(requestB.id, PERSON_B), 9, () => true).kind).toBe('accepted');
    expect(state.detail?.entity).toBe(PERSON_B.id);
  });

  it('rejects a stale person generation and inconsistent reply detail', () => {
    const staleState = new CitizenInspectionState();
    const staleRequest = staleState.requestDirect(PERSON_A);
    const stale = { ...PERSON_A, generation: PERSON_A.generation + 1 };
    expect(staleState.acceptReply(reply(staleRequest.id, stale), 8, () => true)).toMatchObject({
      kind: 'failed',
      mode: 'direct',
      cleared: true,
    });
    expect(staleState.selected).toBeNull();

    const inconsistentState = new CitizenInspectionState();
    const request = inconsistentState.requestDirect(PERSON_A);
    const inconsistent = reply(request.id, PERSON_A);
    inconsistent.detail = { ...inconsistent.detail!, generation: PERSON_A.generation + 1 };
    expect(inconsistentState.acceptReply(inconsistent, 8, () => true)).toMatchObject({
      kind: 'failed',
      error: expect.stringMatching(/envelope.*detail/i),
    });
  });
});

describe('CitizenInspectionState residential drill-down', () => {
  it('requires the exact requested building incarnation and a live-building check', () => {
    const state = new CitizenInspectionState();
    acceptDirect(state);

    const wrongGenerationRequest = state.requestHome(HOME);
    const wrongHome = { ...HOME, generation: HOME.generation + 1 };
    const wrongResult = state.acceptReply(
      reply(wrongGenerationRequest.id, PERSON_B, {
        building: wrongHome,
        index: 1,
        total: 6,
      }),
      10,
      () => true,
    );
    expect(wrongResult).toMatchObject({ kind: 'failed', mode: 'home', cleared: false });
    expect(state.selected).toEqual(PERSON_A);

    const staleRequest = state.requestHome(HOME);
    const liveCheck = vi.fn(() => false);
    const staleResult = state.acceptReply(
      reply(staleRequest.id, PERSON_B, { building: HOME, index: 1, total: 6 }),
      11,
      liveCheck,
    );
    expect(staleResult).toMatchObject({
      kind: 'failed',
      error: expect.stringMatching(/no longer live/i),
    });
    expect(liveCheck).toHaveBeenCalledWith(HOME);
    expect(state.selected).toEqual(PERSON_A);

    const acceptedRequest = state.requestHome(HOME);
    expect(
      state.acceptReply(
        reply(acceptedRequest.id, PERSON_B, { building: HOME, index: 1, total: 6 }),
        12,
        (building) => building.id === HOME.id && building.generation === HOME.generation,
      ),
    ).toMatchObject({ kind: 'accepted', person: PERSON_B });
  });

  it('preserves resident context when a live person refresh is accepted', () => {
    const state = new CitizenInspectionState();
    acceptHome(state, PERSON_A, 20);
    const contextBefore = state.residentContext;
    const request = state.requestRefresh();

    expect(request).not.toBeNull();
    expect(state.acceptReply(reply(request!.id, PERSON_A), 24, () => true).kind).toBe('accepted');
    expect(state.residentContext).toEqual(contextBefore);
    expect(state.detailTick).toBe(24);
  });

  it('includes the complete citizen incarnation and member in the next-person home cursor', () => {
    const state = new CitizenInspectionState();
    acceptHome(state, PERSON_B);

    expect(state.requestHome(HOME)).toMatchObject({
      type: 'inspectHomeResident',
      building: HOME.id,
      buildingGeneration: HOME.generation,
      afterCitizen: PERSON_B.id,
      afterCitizenGeneration: PERSON_B.generation,
      afterMemberId: PERSON_B.memberId,
    });
  });

  it('preserves the current person and detail when a home request fails', () => {
    const state = new CitizenInspectionState();
    acceptDirect(state, PERSON_A, 7);
    const detailBefore = state.detail;
    const request = state.requestHome(HOME);

    expect(
      state.acceptReply(failedReply(request.id, 'home 30 has no residents'), 8, () => true),
    ).toEqual({
      kind: 'failed',
      mode: 'home',
      error: 'home 30 has no residents',
      cleared: false,
    });
    expect(state.selected).toEqual(PERSON_A);
    expect(state.detail).toBe(detailBefore);
    expect(state.detailTick).toBe(7);
  });

  it('reconciles the visible resident position with streamed home occupancy', () => {
    const state = new CitizenInspectionState();
    acceptHome(state, PERSON_A, 20);

    expect(state.reconcileResidentTotal(9)).toBe(true);
    expect(state.residentContext).toMatchObject({ index: 0, total: 9 });
    expect(state.reconcileResidentTotal(9)).toBe(false);
    expect(state.reconcileResidentTotal(null)).toBe(true);
    expect(state.residentContext).toBeNull();
  });
});

describe('CitizenInspectionState failure policy', () => {
  it('clears selection after failed direct and refresh requests', () => {
    const directState = new CitizenInspectionState();
    const direct = directState.requestDirect(PERSON_A);
    expect(
      directState.acceptReply(failedReply(direct.id, 'citizen is stale'), 2, () => true),
    ).toMatchObject({ kind: 'failed', mode: 'direct', cleared: true });
    expect(directState.selected).toBeNull();

    const refreshState = new CitizenInspectionState();
    acceptHome(refreshState, PERSON_A, 3);
    const refresh = refreshState.requestRefresh();
    expect(
      refreshState.acceptReply(failedReply(refresh!.id, 'citizen was demolished'), 4, () => true),
    ).toMatchObject({ kind: 'failed', mode: 'refresh', cleared: true });
    expect(refreshState.selected).toBeNull();
    expect(refreshState.detail).toBeNull();
    expect(refreshState.residentContext).toBeNull();
    expect(refreshState.detailTick).toBeNull();
  });
});
