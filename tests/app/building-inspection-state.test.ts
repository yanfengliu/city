import { describe, expect, it } from 'vitest';
import { BuildingInspectionState } from '../../src/app/building-inspection-state';
import type { BuildingDetail, WorkerToClient } from '../../src/protocol/messages';

type Reply = Extract<WorkerToClient, { type: 'buildingDetail' }>;

function detail(entity = 4, generation = 1): BuildingDetail {
  return {
    kind: 'waterPump',
    entity,
    generation,
    x: 3,
    y: 3,
    w: 1,
    h: 1,
    tick: 120,
    capacity: 300,
    cost: 500,
    upkeep: 10,
    bridgeRadius: 5,
    city: { supply: 300, demand: 12 },
  };
}

function reply(overrides: Partial<Reply> = {}): Reply {
  return {
    type: 'buildingDetail',
    id: 1,
    entity: 4,
    generation: 1,
    detail: detail(),
    ...overrides,
  };
}

describe('BuildingInspectionState', () => {
  it('correlates the reply to its own request and exposes the accepted detail', () => {
    const state = new BuildingInspectionState();
    const request = state.requestDirect({ id: 4, generation: 1 });
    expect(request).toEqual({ type: 'inspectBuilding', id: 1, entity: 4, generation: 1 });

    const result = state.acceptReply(reply({ id: request.id }), 130);

    expect(result.kind).toBe('accepted');
    expect(state.detail).not.toBeNull();
    expect(state.detailTick).toBe(130);
    expect(state.selected).toEqual({ id: 4, generation: 1 });
  });

  it('ignores the answer to a request a newer click already replaced', () => {
    const state = new BuildingInspectionState();
    const first = state.requestDirect({ id: 4, generation: 1 });
    const second = state.requestDirect({ id: 9, generation: 2 });

    const stale = state.acceptReply(reply({ id: first.id }), 130);

    expect(stale.kind).toBe('ignored');
    expect(state.detail).toBeNull();

    const fresh = state.acceptReply(
      reply({ id: second.id, entity: 9, generation: 2, detail: detail(9, 2) }),
      131,
    );
    expect(fresh.kind).toBe('accepted');
  });

  it('rejects a reply whose envelope and detail disagree about which building it is', () => {
    const state = new BuildingInspectionState();
    const request = state.requestDirect({ id: 4, generation: 1 });

    const result = state.acceptReply(
      reply({ id: request.id, detail: detail(4, 2) }),
      130,
    );

    expect(result).toMatchObject({ kind: 'failed' });
    expect(result.kind === 'failed' && result.error).toMatch(
      /envelope and detail do not identify the same building/,
    );
  });

  it('rejects a reply about a recycled entity id at a different incarnation', () => {
    const state = new BuildingInspectionState();
    const request = state.requestDirect({ id: 4, generation: 1 });

    const result = state.acceptReply(
      reply({ id: request.id, generation: 5, detail: detail(4, 5) }),
      130,
    );

    expect(result).toMatchObject({ kind: 'failed' });
    expect(result.kind === 'failed' && result.error).toMatch(
      /expected building 4 generation 1, received building 4 generation 5/,
    );
  });

  it('surfaces the worker-s own explanation when there is no detail', () => {
    const state = new BuildingInspectionState();
    const request = state.requestDirect({ id: 4, generation: 1 });

    const result = state.acceptReply(
      reply({ id: request.id, detail: null, error: 'building 4 generation 1 is no longer alive' }),
      130,
    );

    expect(result).toEqual({
      kind: 'failed',
      mode: 'direct',
      error: 'building 4 generation 1 is no longer alive',
    });
  });

  it('refreshes only while something is selected, and never after a clear', () => {
    const state = new BuildingInspectionState();
    expect(state.requestRefresh()).toBeNull();

    const request = state.requestDirect({ id: 4, generation: 1 });
    state.acceptReply(reply({ id: request.id }), 130);
    const refresh = state.requestRefresh();
    expect(refresh).toMatchObject({ entity: 4, generation: 1 });
    expect(state.pendingMode).toBe('refresh');

    state.clear();
    expect(state.requestRefresh()).toBeNull();
    expect(state.detail).toBeNull();
    // A reply for the cleared request must not resurrect the panel.
    expect(state.acceptReply(reply({ id: refresh!.id }), 131).kind).toBe('ignored');
  });

  it('refuses a malformed selection instead of asking the worker about it', () => {
    const state = new BuildingInspectionState();
    expect(() => state.requestDirect({ id: -1, generation: 0 })).toThrow(/non-negative/);
    expect(() => state.requestDirect({ id: 2, generation: 1.5 })).toThrow(/non-negative/);
  });
});
