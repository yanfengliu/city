import type { GroundPicker } from '../rendering/picking';
import type { Tools } from './tools';

/**
 * Wires pointer/keyboard events on the canvas to the tool state machine.
 * Primary button starts build drags (MapControls' left-pan is disabled while
 * a build tool is active); right-click or Escape cancels an in-flight drag;
 * middle/right buttons stay free for camera navigation.
 */
export function attachInput(element: HTMLElement, picker: GroundPicker, tools: Tools): void {
  element.addEventListener('pointerdown', (event) => {
    if (event.button === 2 && tools.dragging) {
      tools.cancelDrag();
      return;
    }
    if (event.button !== 0 || !tools.isBuildTool) return;
    const cell = picker.pick(event.clientX, event.clientY);
    if (cell) element.setPointerCapture(event.pointerId);
    tools.pointerDown(cell);
  });

  element.addEventListener('pointermove', (event) => {
    if (!tools.isBuildTool) return;
    // During a drag, clamp so the path stays usable while the pointer roams off-map.
    const cell = tools.dragging
      ? picker.pickClamped(event.clientX, event.clientY)
      : picker.pick(event.clientX, event.clientY);
    tools.pointerMove(cell);
  });

  element.addEventListener('pointerup', (event) => {
    if (event.button !== 0 || !tools.dragging) return;
    tools.pointerUp(picker.pickClamped(event.clientX, event.clientY));
  });

  element.addEventListener('pointerleave', () => {
    if (!tools.dragging) tools.pointerMove(null);
  });

  element.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') tools.cancelDrag();
  });
}
