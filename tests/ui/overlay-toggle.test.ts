import { describe, expect, it } from 'vitest';
import { OVERLAY_BUTTON_IDS } from '../../src/ui/hud';
import { OVERLAY_IDS, nextOverlay } from '../../src/ui/overlay-toggle';

/**
 * An overlay button is a toggle, not a radio: pressing the active one returns
 * the map to its normal colours instead of doing nothing. Pure decision logic
 * so it is testable without a DOM (the HUD builds real elements).
 */
describe('nextOverlay', () => {
  it('activates an overlay that is not the current one', () => {
    expect(nextOverlay('power', 'none')).toBe('power');
    expect(nextOverlay('water', 'power')).toBe('water');
    expect(nextOverlay('fireCoverage', 'pollution')).toBe('fireCoverage');
  });

  it('clears the overlay when its own button is pressed again', () => {
    expect(nextOverlay('power', 'power')).toBe('none');
    expect(nextOverlay('traffic', 'traffic')).toBe('none');
    expect(nextOverlay('educationCoverage', 'educationCoverage')).toBe('none');
  });

  it('leaves None inert rather than toggling it into something', () => {
    // Pressing None while nothing is active must stay off, not re-enter an overlay.
    expect(nextOverlay('none', 'none')).toBe('none');
    expect(nextOverlay('none', 'power')).toBe('none');
  });

  it('round-trips every overlay: press once to enter, again to leave', () => {
    for (const id of OVERLAY_IDS) {
      if (id === 'none') continue;
      const entered = nextOverlay(id, 'none');
      expect(entered).toBe(id);
      expect(nextOverlay(id, entered)).toBe('none');
    }
  });

  it('covers exactly the overlays the HUD renders buttons for', () => {
    // Two lists exist (ids here, labels/tooltips in the HUD). Pin them together
    // so adding an overlay to one without the other fails loudly instead of
    // leaving a button the toggle logic has never been exercised against.
    expect([...OVERLAY_BUTTON_IDS]).toEqual([...OVERLAY_IDS]);
  });
});
