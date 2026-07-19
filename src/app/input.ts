import type { GroundPicker } from '../rendering/picking';
import type { Tools } from './tools';

/** Max pointer travel (px, squared) for a press to still count as a select click. */
const CLICK_SLOP_SQ = 36;

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
  pickPerson?: (clientX: number, clientY: number) => number | null,
): void {
  let clickStart: { x: number; y: number } | null = null;

  element.addEventListener('pointerdown', (event) => {
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
    if (!tools.isBuildTool) return;
    // During a drag, clamp so the selection stays usable while the pointer roams off-map.
    const cell = tools.dragging
      ? picker.pickClamped(event.clientX, event.clientY)
      : picker.pick(event.clientX, event.clientY);
    tools.pointerMove(cell);
  });

  element.addEventListener('pointerup', (event) => {
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
    if (!tools.dragging) tools.pointerMove(null);
  });

  element.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') tools.cancelDrag();
  });
}
