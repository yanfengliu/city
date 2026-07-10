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
