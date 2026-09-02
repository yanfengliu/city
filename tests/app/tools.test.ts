import { describe, expect, it, vi } from 'vitest';
import { TOOL_GROUPS, Tools, type ToolHost } from '../../src/app/tools';
import { SERVICE_RADIUS } from '../../src/sim/constants/services';

function host(overrides: Partial<ToolHost> = {}): ToolHost {
  return {
    gridWidth: 8,
    gridHeight: 8,
    isWater: () => false,
    hasRoad: () => false,
    hasBuilding: () => false,
    hasStructure: () => false,
    hasUtilityFootprint: () => false,
    hasPowerLine: () => false,
    hasPipe: () => false,
    hasZone: () => false,
    submitRoad: vi.fn(),
    submitBulldozeRect: vi.fn(),
    submitZone: vi.fn(),
    submitDezone: vi.fn(),
    submitPlaceService: vi.fn(),
    submitPlacePlant: vi.fn(),
    submitPlacePump: vi.fn(),
    submitPowerLine: vi.fn(),
    submitPipe: vi.fn(),
    inspect: vi.fn(),
    inspectPerson: vi.fn(),
    showGhost: vi.fn(),
    clearGhost: vi.fn(),
    showRadius: vi.fn(),
    notify: vi.fn(),
    onToolChanged: vi.fn(),
    ...overrides,
  };
}

describe('special-building placement ghosts', () => {
  it('allows a special building over a growable and still blocks other special structures', () => {
    const submitPlacePlant = vi.fn();
    const growableHost = host({ hasBuilding: () => true, submitPlacePlant });
    const tools = new Tools(growableHost);
    tools.setTool('wind');

    expect(tools.footprintProblem([{ x: 2, y: 2 }])).toBeNull();
    tools.pointerDown({ x: 2, y: 2 });
    expect(submitPlacePlant).toHaveBeenCalledWith('wind', { x: 2, y: 2 });

    const serviceBlocked = new Tools(host({ hasStructure: () => true }));
    serviceBlocked.setTool('wind');
    expect(serviceBlocked.footprintProblem([{ x: 2, y: 2 }])).toMatch(/bulldoze first/i);

    const utilityBlocked = new Tools(host({ hasUtilityFootprint: () => true }));
    utilityBlocked.setTool('wind');
    expect(utilityBlocked.footprintProblem([{ x: 2, y: 2 }])).toMatch(/bulldoze first/i);
  });
});

describe('select tool', () => {
  it('advertises both building and pedestrian inspection', () => {
    const select = TOOL_GROUPS.flat().find((tool) => tool.id === 'select');
    expect(select?.title).toMatch(/buildings or pedestrians/i);
  });

  it('preserves household generation and member when inspecting a pedestrian', () => {
    const inspectPerson = vi.fn();
    const tools = new Tools(host({ inspectPerson }));
    const person = { id: 44, generation: 9, memberId: 2 };

    tools.selectPerson(person);

    expect(inspectPerson).toHaveBeenCalledWith(person);
  });
});

describe('garden tool', () => {
  it('advertises shortcut M and submits a community-garden service stamp', () => {
    const garden = TOOL_GROUPS.flat().find((tool) => tool.id === 'garden');
    expect(garden).toMatchObject({ key: 'm' });
    expect(garden?.label).toMatch(/garden/i);

    const submitPlaceService = vi.fn();
    const showRadius = vi.fn();
    const tools = new Tools(
      host({
        hasRoad: (index) => index === 2 + 4 * 8,
        submitPlaceService,
        showRadius,
      }),
    );
    tools.setTool('garden');
    tools.pointerDown({ x: 2, y: 2 });

    expect(submitPlaceService).toHaveBeenCalledWith('garden', { x: 2, y: 2 });
    const radius = SERVICE_RADIUS.garden;
    expect(showRadius).toHaveBeenCalledWith(2 - radius, 2 - radius, 2 + radius, 2 + radius);
  });
});

describe('zone painting ghosts', () => {
  it('marks existing zones blocked while leaving empty nearby cells paintable', () => {
    const showGhost = vi.fn();
    const zoned = 2 + 2 * 8;
    const road = 2 + 3 * 8;
    const tools = new Tools(
      host({
        hasZone: (index) => index === zoned,
        hasRoad: (index) => index === road,
        showGhost,
      }),
    );
    tools.setTool('zoneC');

    tools.pointerDown({ x: 2, y: 2 });
    tools.pointerMove({ x: 3, y: 2 });

    expect(showGhost).toHaveBeenLastCalledWith(
      [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
      [false, true],
      'C',
    );
  });

  it('marks zoning under a grown building blocked for the dezone tool', () => {
    const showGhost = vi.fn();
    const tools = new Tools(
      host({
        hasZone: () => true,
        hasBuilding: () => true,
        showGhost,
      }),
    );
    tools.setTool('dezone');

    tools.pointerMove({ x: 2, y: 2 });

    expect(showGhost).toHaveBeenLastCalledWith([{ x: 2, y: 2 }], [false]);
  });
});

/**
 * A cleared drag ghost is not evidence of what the player attempted. The tool
 * clears its visual preview synchronously on pointer-up while the command is
 * still queued for the worker, so a harness that observes afterwards sees
 * neither what was previewed nor whether it was accepted — "pointer events were
 * dispatched" becomes indistinguishable from success, and from a rejection.
 *
 * Retain a bounded SEMANTIC record of the action before clearing presentation
 * state, and return a correlated submission result for every command, with
 * monotonic ids so an older rejection cannot attach itself to a newer drag of
 * the same name. Cancellation and pointer-leave have to clear that record too,
 * or the next observation reads a stale one.
 *
 * And when a client preview mirrors a sim validator, test BOTH layers against
 * the same edge case: here each had independently encoded the same obsolete
 * rule, so they agreed with each other and disagreed with the game.
 */
describe('utility line ghosts', () => {
  it('retains an observable valid pipe preview across water and submits the drag', () => {
    const showGhost = vi.fn();
    const submitPipe = vi.fn();
    const tools = new Tools(
      host({
        isWater: (x, y) => x === 2 && y === 1,
        showGhost,
        submitPipe,
      }),
    );
    tools.setTool('pipe');

    tools.pointerDown({ x: 1, y: 1 });
    tools.pointerMove({ x: 3, y: 1 });

    expect(showGhost).toHaveBeenLastCalledWith(
      [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 3, y: 1 },
      ],
      true,
    );

    tools.pointerUp({ x: 3, y: 1 });

    expect(submitPipe).toHaveBeenCalledWith({ x: 1, y: 1 }, { x: 3, y: 1 });
    expect(tools.pipePreview).toEqual({
      active: false,
      submitted: true,
      from: { x: 1, y: 1 },
      to: { x: 3, y: 1 },
      selectedCellCount: 3,
      newCellCount: 3,
      waterCellCount: 1,
      valid: true,
      rejectionReason: null,
    });
  });

  it('keeps power lines blocked over water and explains an all-existing pipe run', () => {
    const lineGhost = vi.fn();
    const lineTools = new Tools(
      host({
        isWater: (x, y) => x === 2 && y === 1,
        showGhost: lineGhost,
      }),
    );
    lineTools.setTool('powerLine');
    lineTools.pointerDown({ x: 1, y: 1 });
    lineTools.pointerMove({ x: 3, y: 1 });
    expect(lineGhost).toHaveBeenLastCalledWith(expect.any(Array), false);

    const pipeTools = new Tools(host({ hasPipe: () => true }));
    pipeTools.setTool('pipe');
    pipeTools.pointerDown({ x: 1, y: 1 });
    pipeTools.pointerUp({ x: 3, y: 1 });
    expect(pipeTools.pipePreview).toMatchObject({
      submitted: true,
      newCellCount: 0,
      valid: false,
      rejectionReason: 'All selected cells already have pipes',
    });
  });

  it('clears an active semantic pipe preview when the drag is cancelled', () => {
    const tools = new Tools(host());
    tools.setTool('pipe');
    tools.pointerDown({ x: 1, y: 1 });
    tools.pointerMove({ x: 3, y: 1 });
    expect(tools.pipePreview).toMatchObject({ active: true, submitted: false });

    tools.cancelDrag();

    expect(tools.dragging).toBe(false);
    expect(tools.pipePreview).toBeNull();
  });

  it('clears an idle pipe hover preview when the pointer leaves the map', () => {
    const tools = new Tools(host());
    tools.setTool('pipe');
    tools.pointerMove({ x: 2, y: 2 });
    expect(tools.pipePreview).toMatchObject({ active: false, submitted: false });

    tools.pointerMove(null);

    expect(tools.pipePreview).toBeNull();
  });
});

describe('escape backs out one level at a time', () => {
  it('returns a build tool to select, leaving nothing selected mid-air', () => {
    const toolHost = host();
    const tools = new Tools(toolHost);
    tools.setTool('zoneR');

    tools.escape();

    expect(tools.activeTool).toBe('select');
    expect(tools.isBuildTool).toBe(false);
    expect(toolHost.onToolChanged).toHaveBeenLastCalledWith('select');
  });

  it('cancels an in-flight drag first and keeps the tool for the next attempt', () => {
    const toolHost = host();
    const tools = new Tools(toolHost);
    tools.setTool('zoneR');
    tools.pointerDown({ x: 1, y: 1 });
    tools.pointerMove({ x: 4, y: 4 });
    expect(tools.dragging).toBe(true);

    tools.escape();

    expect(tools.dragging).toBe(false);
    expect(tools.activeTool).toBe('zoneR');
    expect(toolHost.submitZone).not.toHaveBeenCalled();

    tools.escape();

    expect(tools.activeTool).toBe('select');
  });

  it('every build tool escapes back to select', () => {
    for (const group of TOOL_GROUPS) {
      for (const tool of group) {
        if (tool.id === 'select') continue;
        const tools = new Tools(host());
        tools.setTool(tool.id);
        tools.escape();
        expect(tools.activeTool).toBe('select');
      }
    }
  });

  it('closes an open inspector once the tool is already select', () => {
    const toolHost = host();
    const tools = new Tools(toolHost);

    tools.escape();

    expect(tools.activeTool).toBe('select');
    expect(toolHost.inspect).toHaveBeenCalledWith(null);
  });
});
