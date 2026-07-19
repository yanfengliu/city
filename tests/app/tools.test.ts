import { describe, expect, it, vi } from 'vitest';
import { Tools, type ToolHost } from '../../src/app/tools';

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
