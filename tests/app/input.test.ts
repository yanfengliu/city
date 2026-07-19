import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GroundPicker } from '../../src/rendering/picking';
import { attachInput, PERSON_HOVER_REFRESH_MS } from '../../src/app/input';
import type { PersonSelection, Tools } from '../../src/app/tools';

interface InputHarness {
  element: HTMLElement;
  picker: GroundPicker;
  tools: Tools;
  fire(type: string, event?: Record<string, unknown>): void;
}

function harness(): InputHarness {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const element = {
    style: { cursor: '' },
    addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => {
      listeners.set(type, listener);
    },
    setPointerCapture: vi.fn(),
  } as unknown as HTMLElement;
  const picker = {
    pick: vi.fn(() => null),
    pickClamped: vi.fn(() => null),
  } as unknown as GroundPicker;
  const tools = {
    isBuildTool: false,
    dragging: false,
    cancelDrag: vi.fn(),
    pointerDown: vi.fn(),
    pointerMove: vi.fn(),
    pointerUp: vi.fn(),
    select: vi.fn(),
    selectPerson: vi.fn(),
  } as unknown as Tools;
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  return {
    element,
    picker,
    tools,
    fire: (type, event = {}) => listeners.get(type)?.(event),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('pedestrian pointer input', () => {
  it('forwards the complete picked person identity on a select click', () => {
    const input = harness();
    const person: PersonSelection = { id: 18, generation: 6, memberId: 1 };
    attachInput(input.element, input.picker, input.tools, () => person);

    input.fire('pointerdown', { button: 0, clientX: 40, clientY: 50 });
    input.fire('pointerup', { button: 0, clientX: 42, clientY: 51 });

    expect(input.tools.selectPerson).toHaveBeenCalledWith(person);
    expect(input.tools.select).not.toHaveBeenCalled();
  });

  it('shows a pointer cursor and emits only stable hover-identity changes', () => {
    const input = harness();
    const first: PersonSelection = { id: 12, generation: 4, memberId: 2 };
    let picked: PersonSelection | null = first;
    const pickPerson = vi.fn((_x: number, _y: number) => picked);
    const onHover = vi.fn();
    attachInput(input.element, input.picker, input.tools, pickPerson, onHover);

    input.fire('pointermove', { clientX: 20, clientY: 30 });
    expect(pickPerson).toHaveBeenCalledWith(20, 30);
    expect(input.element.style.cursor).toBe('pointer');
    expect(onHover).toHaveBeenLastCalledWith(first);

    picked = { ...first };
    input.fire('pointermove', { clientX: 21, clientY: 31 });
    expect(onHover).toHaveBeenCalledTimes(1);

    picked = { ...first, memberId: 1 };
    input.fire('pointermove', { clientX: 22, clientY: 32 });
    expect(onHover).toHaveBeenLastCalledWith(picked);
    picked = { ...first, generation: 5 };
    input.fire('pointermove', { clientX: 23, clientY: 33 });
    expect(onHover).toHaveBeenLastCalledWith(picked);

    picked = null;
    input.fire('pointermove', { clientX: 24, clientY: 34 });
    expect(input.element.style.cursor).toBe('');
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('clears person hover on pointer leave and when a build tool takes over', () => {
    const input = harness();
    const person: PersonSelection = { id: 7, generation: 3, memberId: 0 };
    const pickPerson = vi.fn(() => person);
    const onHover = vi.fn();
    attachInput(input.element, input.picker, input.tools, pickPerson, onHover);

    input.fire('pointermove', { clientX: 5, clientY: 6 });
    input.fire('pointerleave');
    expect(input.element.style.cursor).toBe('');
    expect(onHover).toHaveBeenLastCalledWith(null);

    input.fire('pointermove', { clientX: 5, clientY: 6 });
    (input.tools as unknown as { isBuildTool: boolean }).isBuildTool = true;
    input.fire('pointermove', { clientX: 8, clientY: 9 });
    expect(input.element.style.cursor).toBe('');
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(input.picker.pick).toHaveBeenCalledWith(8, 9);
  });

  it('resets the cached hover identity across keyboard tool changes', () => {
    const input = harness();
    const person: PersonSelection = { id: 7, generation: 3, memberId: 0 };
    const onHover = vi.fn();
    const controller = attachInput(input.element, input.picker, input.tools, () => person, onHover);

    input.fire('pointermove', { clientX: 5, clientY: 6 });
    controller.clearPersonHover();
    expect(input.element.style.cursor).toBe('');
    expect(onHover).toHaveBeenLastCalledWith(null);

    input.fire('pointermove', { clientX: 6, clientY: 7 });
    expect(input.element.style.cursor).toBe('pointer');
    expect(onHover).toHaveBeenLastCalledWith(person);
    expect(onHover).toHaveBeenCalledTimes(3);
  });

  it('throttles stationary-pointer repicks as walkers or the camera move', () => {
    const input = harness();
    const first: PersonSelection = { id: 7, generation: 3, memberId: 0 };
    const second: PersonSelection = { id: 8, generation: 1, memberId: 2 };
    let picked: PersonSelection | null = first;
    let now = 1_000;
    const pickPerson = vi.fn(() => picked);
    const onHover = vi.fn();
    const controller = attachInput(
      input.element,
      input.picker,
      input.tools,
      pickPerson,
      onHover,
      () => now,
    );

    input.fire('pointermove', { clientX: 20, clientY: 30 });
    picked = second;
    controller.refreshPersonHover();
    expect(onHover).toHaveBeenLastCalledWith(second);

    picked = null;
    now += PERSON_HOVER_REFRESH_MS - 1;
    controller.refreshPersonHover();
    expect(onHover).toHaveBeenLastCalledWith(second);

    now += 1;
    controller.refreshPersonHover();
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(input.element.style.cursor).toBe('');
  });
});
