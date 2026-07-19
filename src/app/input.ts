import type { GroundPicker } from '../rendering/picking';
import type { PersonSelection, Tools } from './tools';

/** Max pointer travel (px, squared) for a press to still count as a select click. */
const CLICK_SLOP_SQ = 36;
/** Stationary-pointer rechecks stay responsive without raycasting every render frame. */
export const PERSON_HOVER_REFRESH_MS = 100;

export interface InputController {
  /** Clears the cached pointer identity as well as the visible hover state. */
  clearPersonHover(): void;
  /** Rechecks the last in-canvas pointer after walkers or the camera move. */
  refreshPersonHover(): void;
}

/**
 * Wires pointer/keyboard events on the canvas to the tool state machine.
 * Primary button starts build drags (MapControls' left-pan is disabled while
 * a build tool is active) or, with the select tool, inspects the clicked cell
 * (ignoring drags, which pan the camera); right-click or Escape cancels an
 * in-flight drag; middle/right buttons stay free for camera navigation.
 */
export function attachInput(
  element: HTMLElement,
  picker: GroundPicker,
  tools: Tools,
  /** Citizen entity under the pointer, or null — hit-tested before the ground. */
  pickPerson?: (clientX: number, clientY: number) => PersonSelection | null,
  /** Called only when the hovered citizen identity changes. */
  onPersonHover?: (citizen: PersonSelection | null) => void,
  now: () => number = () => performance.now(),
): InputController {
  let clickStart: { x: number; y: number } | null = null;
  let hoveredPerson: PersonSelection | null = null;
  let lastPointer: { x: number; y: number } | null = null;
  let lastStationaryRefreshAt = Number.NEGATIVE_INFINITY;

  const setHoveredPerson = (citizen: PersonSelection | null): void => {
    if (
      citizen?.id === hoveredPerson?.id &&
      citizen?.generation === hoveredPerson?.generation &&
      citizen?.memberId === hoveredPerson?.memberId
    ) return;
    hoveredPerson = citizen;
    element.style.cursor = citizen === null ? '' : 'pointer';
    onPersonHover?.(citizen);
  };

  const pickHoveredPerson = (): void => {
    if (!lastPointer || tools.isBuildTool) return;
    setHoveredPerson(pickPerson?.(lastPointer.x, lastPointer.y) ?? null);
  };

  element.addEventListener('pointerdown', (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (event.button === 2 && tools.dragging) {
      tools.cancelDrag();
      return;
    }
    if (event.button !== 0) return;
    if (tools.isBuildTool) {
      const cell = picker.pick(event.clientX, event.clientY);
      if (cell) {
        // Best-effort: synthetic pointers (automated playtests) have no
        // active pointer id and would throw, aborting the drag.
        try {
          element.setPointerCapture(event.pointerId);
        } catch {
          /* capture is an optional nicety */
        }
      }
      tools.pointerDown(cell);
    } else {
      clickStart = { x: event.clientX, y: event.clientY };
    }
  });

  element.addEventListener('pointermove', (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (!tools.isBuildTool) {
      pickHoveredPerson();
      return;
    }
    setHoveredPerson(null);
    // During a drag, clamp so the selection stays usable while the pointer roams off-map.
    const cell = tools.dragging
      ? picker.pickClamped(event.clientX, event.clientY)
      : picker.pick(event.clientX, event.clientY);
    tools.pointerMove(cell);
  });

  element.addEventListener('pointerup', (event) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    if (event.button !== 0) return;
    if (tools.dragging) {
      tools.pointerUp(picker.pickClamped(event.clientX, event.clientY));
      return;
    }
    if (clickStart) {
      const dx = event.clientX - clickStart.x;
      const dy = event.clientY - clickStart.y;
      if (dx * dx + dy * dy <= CLICK_SLOP_SQ) {
        // A person standing on a cell is what the player meant to click, so
        // the crowd is hit-tested before the ground under it.
        const person = pickPerson?.(event.clientX, event.clientY) ?? null;
        if (person !== null) tools.selectPerson(person);
        else tools.select(picker.pick(event.clientX, event.clientY));
      }
      clickStart = null;
    }
  });

  element.addEventListener('pointerleave', () => {
    lastPointer = null;
    setHoveredPerson(null);
    if (!tools.dragging) tools.pointerMove(null);
  });

  element.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') tools.cancelDrag();
  });

  return {
    clearPersonHover: () => {
      lastStationaryRefreshAt = Number.NEGATIVE_INFINITY;
      setHoveredPerson(null);
    },
    refreshPersonHover: () => {
      if (!lastPointer || tools.isBuildTool) return;
      const timestamp = now();
      if (timestamp - lastStationaryRefreshAt < PERSON_HOVER_REFRESH_MS) return;
      lastStationaryRefreshAt = timestamp;
      pickHoveredPerson();
    },
  };
}
